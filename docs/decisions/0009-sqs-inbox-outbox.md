# ADR 0009 — Consumo SQS e publicação da outbox

## Estado

Aceito na T07, em 2026-10-14, branch codex/t07-sqs-inbox-outbox.

## Contexto

O README exige inbox atômica, ack após commit, retries/DLQ e publishers concorrentes.
T06 já confirma efeitos financeiros, recibo e eventos; agora é necessário conectar
o broker preservando essas garantias. FIFO e sua janela de deduplicação são otimizações.

## Decisão

- Manter as filas exigidas wager-transactions.fifo e wager-transactions-dlq.fifo.
  Acrescentar wager-events.fifo como destino dos envelopes da outbox, separado de
  comandos. Provisionamento idempotente configura RedrivePolicy com cinco recebimentos
  e retenção da DLQ de 14 dias. Source/eventos conservam retenção padrão de quatro dias.
  O ambiente continua local, sem credenciais ou serviço AWS externo.
- Envelope de entrada exige messageId, type=WagerTransactionRequested, occurredAt
  ISO UTC e data conforme README, com idempotencyKey em data. correlationId é opcional;
  ausente, usa messageId. CausationId dos eventos é o messageId lógico. O adapter
  reaproveita validações HTTP de campos monetários/identidades, recusa extras e OPENING.
- FinancialProcessing.process é o mesmo caso de uso dos dois canais; recebe contexto
  opcional de inbox. Dentro da mesma unidade SQL, INSERT ON CONFLICT DO NOTHING e
  lock da inbox serializam consumerName/messageId. Hash divergente é conflito permanente.
  Depois executa processamento/replay e marca inbox processada antes do commit.
  Ordem de locks é inbox → wallet. HTTP e referência não adquirem inbox, evitando inversão.
- consumerName fixo wager-transactions-v1. Hash da inbox é SHA-256 do envelope JSON
  canônico completo, incluindo chave e metadados lógicos: reutilizar messageId com
  envelope alterado é erro de protocolo. Chaves JSON reordenadas não mudam o hash.
  Hash da transação financeira continua contendo só negócio, conforme ADR 0007.
- Inbox, recibo, agenda quando pendente, transação, saldo, ledger e outbox confirmam
  juntos. Constraints existentes bastam; não foi necessária nova migration. Se outra
  identidade financeira vence uma corrida, a leitura de replay após rollback também
  inclui a inbox na nova unidade, sem repetir a movimentação.
- DeleteMessage ocorre somente depois do caso de uso confirmar commit. Resultados
  PROCESSED, REJECTED, PENDING_REFERENCE e replay recebem ack. Mensagem malformada,
  conflito, wallet inexistente e SQLSTATE de entrada/integridade/schema permanente
  vão para DLQ. Demais erros recebem retry limitado; não se inventa rejeição financeira.
- Retry via ChangeMessageVisibility: 1, 2, 4, 8 segundos entre os cinco recebimentos
  permitidos (função limitada a 60 s). Na quinta falha transitória, envio explícito à
  DLQ com RETRIES_EXHAUSTED; permanentes vão imediatamente. Redrive do broker cobre
  também quedas em que o consumidor não executa esse tratamento.
- Envio à DLQ precede delete da origem. Corpo original é preservado, com atributos
  failureCode/sourceMessageId. Dedup ID é hash do ID SQS e corpo; falha de envio nunca
  causa delete. Não existe atomicidade entre duas filas: queda depois do envio pode
  redeliverar. Os IDs originais permanecem disponíveis para deduplicação e diagnóstico.
- Consumidor lê uma mensagem por rodada, long polling de 2 s, visibilidade de 30 s,
  renovada a cada 10 s durante processamento. Visibilidade não é lock financeiro.
  SIGTERM aborta polling, devolve visibilidade se ainda não começou a processar e
  conclui trabalho em andamento antes de fechar recursos. Se a infraestrutura impedir
  delete/retorno de visibilidade, o timeout do broker permite retomada. Compose concede 60 s.
- Publisher seleciona outbox confirmada e devida com FOR UPDATE SKIP LOCKED, mantendo
  lock de uma linha durante envio limitado pelo SDK. Não mantém lock de wallet e roda
  em processo/pool separado. Depois do envio marca publishedAt; em erro agenda retry
  persistente de 1 s exponencial até 60 s. Não descarta eventos por limite de tentativas.
- Envio ocorre após o commit financeiro, porém antes do commit de publishedAt: queda
  nesse intervalo pode duplicar publicação. Reenvio usa o mesmo envelope/eventId,
  MessageDeduplicationId=SHA256(eventId) e grupo=SHA256(walletId), com aggregateId como
  fallback. Hash evita restrições de comprimento/caracteres do SQS para IDs do domínio.
- A janela FIFO de cinco minutos não garante idempotência durável do assinante.
  Consumidores de eventos devem registrar eventId/hash e seus efeitos na mesma transação.
  Um teste de contrato usa inbox PostgreSQL e efeito SQL descartável para demonstrar
  isso mesmo com duas entregas do mesmo evento. Não há assinante de negócio adicional
  implementado neste challenge. A fila de saída pode ser consumida por ferramenta externa.
- Dois publishers podem enviar eventos da mesma wallet em ordem diferente da criação,
  apesar do grupo FIFO; o broker ordena chegada. Não prometemos ordenação global de
  eventos. WalletBalanceChanged fornece walletVersion e todos os envelopes têm eventId.
- Workers consumer/publisher são processos separados, iniciados após migrations e
  provisionamento. Rodada --once consome/publica no máximo um item; retry de publicação
  é persistido e retorna falha no CLI. Logs têm IDs/correlação/status, sem body ou SQL.

## Consequências

Locks por inbox/outbox e wallet protegem correção entre instâncias. Manter transação
aberta durante envio é simples e libera posse automaticamente após morte, mas ocupa
conexão pelo tempo de rede. SDK limita conexão a 3 s e requisição a 5 s, com até três
tentativas; a operação completa pode durar mais de uma requisição. Falhas persistentes
exigem diagnóstico; métricas e readiness ficam na T08. Broker tem retenção finita;
operadores/assinantes devem consumir eventos e tratar DLQ dentro desse período.

Rejeição de negócio vai para auditoria financeira e recebe ack; DLQ não é arquivo de
apostas rejeitadas. Redrive exige inspecionar/corrigir a causa; não é automático nesta etapa.
Corrigir conteúdo exige nova identidade lógica de mensagem; mesma identidade financeira
continua sujeita ao hash/recibo existente.

## Verificação

PostgreSQL e LocalStack reais: atomicidade da inbox, replay entre canais, mensagens
em grupos distintos disputando a mesma inbox, backoff, cinco recebimentos, DLQ nativa,
falha ao enviar DLQ, publishers simultâneos e invisibilidade de eventos sem commit.
Processos recebem SIGKILL após commit antes de ack e após envio antes de publishedAt;
outra instância retoma. SIGTERM durante processamento conclui commit/ack. Expiração
T06 produz evento observado no broker. Cada fixture financeira compara saldo e ledger.

## Referências

- [AWS — visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html).
- [AWS — dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).
- [AWS — termos de FIFO e deduplicação](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-key-terms.html).
