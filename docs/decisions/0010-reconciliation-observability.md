# ADR 0010 — Reconciliação, logs e métricas

## Estado

Aceito na T08, em 2026-10-14, branch codex/t08-reconciliation-observability.

## Contexto

As seções 9 e 12 exigem reconciliação, sinalização de divergências, logs JSON,
métricas mínimas e health público. Invariantes financeiras continuam no PostgreSQL;
observabilidade não substitui auditoria, recibos ou ledger.

## Decisão

- POST /wallets/:walletId/reconciliation retorna 200 com o contrato do README,
  inclusive quando consistent=false; wallet inexistente retorna 404. Diferença é
  storedBalance menos calculatedBalance, podendo ser negativa. POST não altera
  wallet, ledger, recibos ou eventos. Divergência produz log de erro e contador.
- Uma consulta SQL agrega CREDIT menos DEBIT e lê saldo e contagem no mesmo snapshot
  de statement READ COMMITTED. Não há leitura prévia separada nem lock de wallet.
  SQL NUMERIC soma valores exatos; round(...,2) normaliza a representação das colunas
  money_amount, cujo domínio já limita escala a duas casas. Money bigint calcula a
  diferença e serializa strings. Quantidade de lançamentos é um inteiro seguro.
- Logs JSON usam lista explícita de campos, sem body, valores monetários, playerId,
  chave idempotente, hash, SQL, stack ou mensagem bruta de exceção. Os cinco campos
  correlationId/messageId/transactionId/walletId/providerId estão sempre presentes,
  com null quando não aplicáveis ou indisponíveis. IDs são limitados a 256 caracteres.
  API propaga ou gera X-Correlation-Id e o devolve; SQS conserva o ID lógico e o
  contexto até referências e publicação. Falha do destino do log não desfaz negócio.
- Instrumentação financeira é um decorator de adapter, após o commit do caso de uso,
  compartilhado por HTTP/SQS. Domínio e aplicação continuam sem bibliotecas de métricas.
  Erros medidos incluem tentativas com rollback; polling sem item não entra na latência.
  Abertura é medida como operação HTTP; transações OPENING aparecem no gauge persistido.
- Cliente oficial @prometheus-io/client 0.16.1, fixado no lockfile. Ele expõe formato
  Prometheus por pull; não foi instalado servidor, exporter remoto ou dashboard.
  Nenhuma coleta de métricas padrão de máquina ou tracing foi ativada. A dependência
  transitiva de API OpenTelemetry não configura nem envia traces.
- GET /metrics na API e porta METRICS_PORT dos workers (9464 por padrão) expõem
  registries locais. Contadores/histogramas reiniciam por processo e são observações,
  não contabilidade financeira. Uma queda logo após commit pode perder a observação.
  IDs e conteúdo do usuário nunca são labels; source/status/code usam conjuntos finitos.
- Gauges de status atual, outbox pendente e lag vêm de uma consulta PostgreSQL durante
  scrape. Incluem OPENING e mudanças concluídas por qualquer instância. Lag é a idade
  do evento não publicado mais antigo, inclusive quando em backoff, ou zero se vazio.
  DLQ tem gauge aproximado visible/inflight/delayed do SQS, incluindo redrive nativo.
  Counter dead_letters registra apenas encaminhamentos explícitos confirmados pelo
  consumidor; crash entre send/delete/log pode provocar subcontagem ou repetição.
- Conflitos de lock medem SQLSTATE 55P03, 40P01 e 40001; espera bem-sucedida de lock
  não conta como conflito. Retries SQS/outbox contam agendamento, referência conta
  tentativa de agenda. Métricas locais devem ser agregadas por instância; gauges
  globais repetidos entre processos não devem ser somados.
- Readiness público consulta SELECT 1 e URLs/atributos das três filas, retornando
  200 ready ou 503 unavailable com checks por dependência. Liveness retorna 200
  sem acesso a banco/broker. Ready comprova conectividade e filas, não migrations,
  autorização por provedor, ausência de backlog ou corretude financeira.
- Probes usam pool separado limitado a duas conexões, aquisição/conexão/statement
  de 2 s e query de 2,5 s; SQS tem uma tentativa, conexão de 1 s e request de 1,5 s.
  Nenhum resultado saudável é cacheado. Scrapes simultâneos compartilham a coleta
  em andamento. Falha de coleta retorna 503 METRICS_UNAVAILABLE sem expor zeros
  artificiais nem servir snapshot antigo como novo. Endpoints não revelam exceções.
- A inspeção do SDK mostrou que requestTimeout sozinho emite aviso por padrão.
  throwOnRequestTimeout=true passou a valer para probes e para o cliente T07:
  seus limites de 3 s de conexão/5 s por request e três tentativas agora abortam.
  Recursos operacionais fecham no shutdown; --once não abre listener de worker.

## Consequências

Reconciliação pode mudar entre chamadas, mas cada resposta corresponde a um snapshot
coerente. Divergência requer investigação, sem mecanismo automático de reparo.
A injeção de corrupção dos testes desabilita triggers somente em banco descartável;
não é um comando operacional recomendado.

Scrape faz agregações completas, com custo proporcional ao volume; falhará de forma
explícita se ultrapassar o timeout. Um deployment maior precisará dimensionar coleta,
retenção e índices com medições. Prometheus representa contadores/tempos como números;
nenhum dinheiro é exportado. Métricas e health estão abertos no ambiente local.
Em produção, /metrics deve ficar em rede operacional; health deve continuar público.

A biblioteca declara suporte Node; o uso sob Bun 1.4.3 é validado pelos testes do
projeto no host e Linux, sem afirmar suporte upstream de todas as funcionalidades.
Sem serviço de scrape implantado, histórico reside apenas no processo; logs e métricas
não são um armazenamento durável de auditoria. Matriz completa distribuída continua T09.

## Verificação

Testes HTTP com valores de 36 dígitos, diferenças de um centavo positivas/negativas,
ledger vazio, wallet inexistente e transação concorrente aberta. Divergência é
retornada, logada, medida e permanece sem reparo. Métricas são observadas após
HTTP/SQS, replay, rejeição, pendência, retries, DLQ, falha de publicação e timeout real
de lock. Probes usam conexões recusadas e sockets que aceitam conexão sem responder.

## Referências

- [PostgreSQL 17 — isolamento e snapshot de statement](https://www.postgresql.org/docs/17/transaction-iso.html).
- [Cliente oficial Prometheus](https://github.com/prometheus/client_js).
- [Prometheus — nomes e labels](https://prometheus.io/docs/practices/naming/).
