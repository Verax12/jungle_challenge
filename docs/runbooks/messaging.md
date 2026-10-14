# Consumo SQS, inbox e outbox

## Preparar e executar

Siga os pré-requisitos da [stack local](backend.md). No Colima desta máquina:

```sh
export DOCKER_CONTEXT=colima-backend-challenge
bun run stack:up
bun run stack:migrate
bun run stack:workers
docker compose --profile workers ps
```

Os três workers são reference-worker, consumer e publisher. Inicie depois das
migrations. Para duas instâncias de consumidor e publisher:

```sh
docker compose --profile workers up -d --scale consumer=2 --scale publisher=2 consumer publisher
```

Para executar no host com `.env` preparado e dependências locais disponíveis:

```sh
bun run build
bun run start:consumer
```

Em outro terminal, `METRICS_PORT=9465 bun run start:publisher`, para não disputar
a porta operacional 9464 do consumidor. `--once` executa uma rodada, útil para
diagnóstico: `bun run start:consumer --once` ou `bun run start:publisher --once`.
Não reconstrua dist enquanto testes/processos compilados o estiverem usando.

## Enviar uma operação

Crie uma wallet pela [API HTTP](http.md) e salve um arquivo request.json local:

```json
{
  "messageId": "message-example-1",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-10-14T17:00:00.000Z",
  "data": {
    "providerId": "provider-example",
    "externalTransactionId": "bet-example-1",
    "idempotencyKey": "provider-example:bet-example-1",
    "playerId": "SUBSTITUIR_PLAYER_ID",
    "walletId": "SUBSTITUIR_WALLET_ID",
    "roundId": "round-example",
    "gameId": "game-example",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

Substitua IDs, copie o arquivo para LocalStack e envie com awslocal:

```sh
docker compose cp request.json localstack:/tmp/request.json
docker compose exec localstack sh -c 'queue_url=$(awslocal sqs get-queue-url --queue-name wager-transactions.fifo --query QueueUrl --output text); awslocal sqs send-message --queue-url "$queue_url" --message-body file:///tmp/request.json --message-group-id example-wallet --message-deduplication-id delivery-example-1'
```

Para testar deduplicação persistente, repita o mesmo corpo usando outro
message-deduplication-id, como delivery-example-2. Isso permite ao broker entregar
novamente; o PostgreSQL impede um segundo débito. Em produtores, use hash da wallet
como grupo; o grupo do exemplo só é apropriado para a mesma wallet.

Consulte wallet, ledger e transação via HTTP. Publisher envia envelopes para
wager-events.fifo. Consumo manual de eventos (receber altera visibilidade):

```sh
docker compose exec localstack sh -c 'queue_url=$(awslocal sqs get-queue-url --queue-name wager-events.fifo --query QueueUrl --output text); awslocal sqs receive-message --queue-url "$queue_url" --max-number-of-messages 10 --wait-time-seconds 2'
```

Após inspeção, DeleteMessage exige o ReceiptHandle recebido. Não use a fila de eventos
como entrada de comandos. Assinantes devem deduplicar eventId duravelmente junto dos efeitos.

## Erros e recuperação

- Resultado financeiro, rejeição e pendência: inbox confirmada e ack; consulte GET.
- Mensagem inválida/OPENING, conflito ou wallet inexistente: DLQ com corpo original
  e atributo failureCode. Não ficam como inbox processada.
- Infraestrutura transitória: visibilidade 1/2/4/8 s; quinta falha vai à DLQ.
  Redrive nativo cobre mensagens que continuam sem ack após cinco recebimentos.
- DLQ indisponível: origem não é apagada. Queda após envio à DLQ pode duplicar entrega;
  preserve IDs lógicos ao investigar. Retenção da DLQ é 14 dias.
- Publisher: falha mantém outbox pendente, com próximo horário persistido. Sem descarte
  por número de tentativas. Queda após envio pode produzir duplicata com mesmo eventId.
- Reutilizar messageId com outro envelope é conflito. Novo messageId não permite
  mudar payload de uma identidade financeira já confirmada.

```sh
docker compose logs --tail 100 consumer publisher
docker compose exec postgres psql -U wagering -d wagering -c 'select consumer_name,message_id,processed_at from inbox_messages order by received_at desc limit 20'
docker compose exec postgres psql -U wagering -d wagering -c 'select id,event_type,attempts,next_attempt_at,published_at from outbox_messages order by occurred_at desc limit 20'
```

Logs: message_committed, message_retry, message_dead_lettered, outbox_attempt e
falhas operacionais sem payload/SQL. `message_worker_iteration_failed` pode significar
falha no ack após commit: confirme inbox/recibo antes de reenviar. Não apague inbox,
recibos ou outbox para forçar reprocessamento. Falta de tabela/filas: pare workers,
aplique migrations/provisionamento e reinicie. Redrive da DLQ exige revisão da causa.

## Validar e encerrar

```sh
bun run check
bun run test:persistence
bun run test:messaging
bun run stack:messaging
bun run stack:smoke
bun run stack:down
```

Suíte messaging cria bancos e três filas por fixture, com nomes test-UUID, e remove
somente esses recursos. Usa o endpoint local validado pela configuração. Não usa filas
de negócio para injetar falhas. Alguns testes reduzem visibilidade explicitamente
para simular expiração; há teste separado de espera real e verificação dos atrasos.

SIGTERM interrompe novas seleções e aguarda trabalho em andamento; Compose concede
60 s ao consumidor/publisher. Se o processo morrer, locks SQL são liberados e o broker
redelivera após visibilidade. `stack:down` inclui o perfil workers e preserva volumes.

A [decisão 0009](../decisions/0009-sqs-inbox-outbox.md) explica atomicidade, hashes,
trade-offs de rede/locks e limites. Métricas, readiness e reconciliação estão no [guia da T08](observability.md);
a [matriz distribuída](distributed.md) valida três instâncias e 50 reenvios.
