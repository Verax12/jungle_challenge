# ADR 0008 — Reprocessamento de referências

## Estado

Aceito na T06, em 2026-10-14, branch codex/t06-pending-references.

## Contexto

O README exige worker agendado com backoff e espera limitada para referências
externas ausentes. T04/T05 persistem a pendência e seu recibo original; resolver a
pendência deve preservar a identidade, as regras financeiras e o replay original.

## Decisão

- Uma tabela reference_jobs guarda attempts, next_attempt_at, expires_at,
  completed_at e contexto de correlação/causalidade. Agenda, transação pendente,
  recibo e evento inicial são confirmados juntos. Attempts conta tentativas do
  worker confirmadas; a submissão inicial não conta. Não há estado de posse em memória.
- TTL de 24 horas desde createdAt permite desordem e interrupções operacionais sem
  manter referências indefinidamente. Primeira tentativa após 1 s; próximas esperas
  de 2, 4, 8, 16, 32 e 60 s, mantendo teto de 60 s até o TTL. Esse teto limita carga
  a uma tentativa por minuto por pendência antiga e evita até cinco minutos de
  atraso de recuperação. A proposta anterior de teto de cinco minutos não foi adotada.
- Sem limite adicional de tentativas: o TTL limita a espera. Datas são UTC e precisam
  de relógios sincronizados entre hosts. O próximo horário nunca ultrapassa expiresAt.
  A expiração ocorre na primeira execução disponível a partir do prazo; não promete
  execução durante indisponibilidade. Nesse ponto a operação é rejeitada com
  REFERENCE_NOT_FOUND mesmo se a referência tiver chegado depois da última tentativa.
- Claim usa READ COMMITTED e FOR UPDATE OF wallets SKIP LOCKED, por ordem de horário
  devido/ID. Depois bloqueia a agenda e relê transação e saldo. A ordem wallet → agenda
  evita inverter a ordem usada pelo processamento financeiro. Uma wallet ocupada
  fica para outra rodada; wallets livres podem progredir. Claim e efeitos ficam na
  mesma transação SQL, sem lease ou confirmação antecipada.
- FinancialProcessing compartilha aplicação das regras e gravação de eventos entre
  submissão e retryReference. Retomada atualiza a transação existente e acrescenta
  ledger/eventos quando cabíveis; nunca cria outra transação financeira ou recibo.
  Pendência que continua ausente só avança a agenda: não repete o evento PendingReference.
- Referência é consultada pelo provider/ID externo, validando player, wallet, moeda,
  rodada, tipo, valor, estado e reversão anterior. Mantém-se o ADR 0004: referência
  encontrada mas não PROCESSED é rejeitada com REFERENCE_NOT_PROCESSED. Este worker
  espera referências ausentes; não implementa ordenação topológica de cadeias pendentes.
- Expiração gera transação REJECTED e WagerTransactionRejected na mesma transação
  SQL que conclui a agenda. Publicação efetiva pertence à T07. Falhas de infraestrutura
  revertem todos os efeitos, inclusive attempts; o loop registra falha sem SQL/payload
  e tenta outra rodada após 500 ms. Erro persistente exige diagnóstico operacional.
- Worker é processo separado, com polling de 500 ms e lote de até 100 tentativas
  sequenciais por rodada. SIGTERM/SIGINT interrompem novas seleções, aguardam a tentativa
  atual e fecham o ORM. Claim configura lock_timeout de 2 s e statement_timeout de 5 s.
  SIGKILL libera locks pelo PostgreSQL e reverte a transação aberta. Depois do commit,
  a agenda concluída impede nova aplicação.
- Migration 0004 acrescenta agenda sem alterar migrations existentes. Pendências
  anteriores recebem a mesma janela baseada no createdAt original; correlação vem
  do evento PendingReference da outbox, ou do ID da transação quando não há evento.
  Down remove somente a agenda e seu histórico de tentativas; up reconstrói trabalhos
  ainda pendentes, sem estender TTL. Recibos e efeitos financeiros permanecem.
- Replay HTTP continua preservando PENDING_REFERENCE e saldo originais; GET retorna
  o estado atualizado. Worker é iniciado explicitamente depois das migrations.

## Consequências

Locks de wallet evitam dupla aplicação entre workers e HTTP. Não há garantia de
ordem global/fairness sob contenção contínua; TTL é observado quando a wallet pode
ser adquirida. Banco é a autoridade da agenda. Agenda concluída permanece auditável,
com identidade/contexto imutáveis e constraints contra regressão de progresso.

Sem jitter nesta etapa, o escalonamento é determinístico; o polling e SKIP LOCKED
permitem cooperação, mas não substituem planejamento de capacidade. Não há consumidor,
ack ou publisher implementados nesta entrega. Três instâncias completas ficam na T09.

## Verificação

Testes de PostgreSQL real cobrem REFUND/ROLLBACK/WIN antes da referência, escopo,
reversão duplicada, saldo insuficiente, TTL, backoff, recibo preservado, claims
concorrentes, rollback após flush, backfill e reinício. Processos reais recebem SIGTERM
entre tentativas e SIGKILL após flush antes do commit. Cada cenário confere saldo
versus soma do ledger; mocks do loop só comprovam controle de shutdown e política.

## Referências

- [PostgreSQL 17 — SELECT e SKIP LOCKED](https://www.postgresql.org/docs/17/sql-select.html): seleção concorrente de trabalho e limites da visão ao ignorar linhas bloqueadas.
