# Worker de referências fora de ordem

## Iniciar

Use os pré-requisitos da [stack](backend.md). No perfil Colima desta máquina:

```sh
export DOCKER_CONTEXT=colima-backend-challenge
bun run stack:up
bun run stack:migrate
bun run stack:references
docker compose logs --tail 50 reference-worker
```

O worker roda separado do HTTP, no perfil Compose workers. Inicie depois das
migrations; não existe alteração automática de schema. Para parar e voltar:

```sh
docker compose stop reference-worker
bun run stack:references
```

`bun run stack:down` inclui explicitamente o perfil workers, encerra também o worker
e preserva volumes. `docker compose down` sem esse perfil pode deixar o worker ativo. Para duas réplicas:

```sh
docker compose --profile workers up --build -d --scale reference-worker=2 reference-worker
```

No host, com `.env` local preparado conforme o runbook de ambiente:

```sh
bun run build
bun run start:references
```

Para uma rodada de até 100 trabalhos devidos, sem permanecer agendado:

```sh
bun run start:references --once
```

Nenhum trabalho devido é sucesso sem alterações. Uma falha em modo `--once` retorna
código diferente de zero. No modo contínuo há log e nova rodada; SIGTERM/SIGINT
aguardam a tentativa em andamento. Não rode build/check no mesmo checkout enquanto
um teste de subprocesso depende de dist: build recria essa pasta.

## Exercitar via HTTP

Use [os exemplos da API](http.md) para criar uma wallet. Envie REFUND de 25.00 BRL
com referenceExternalTransactionId de uma BET ainda não enviada; mantenha mesmo
provider/player/wallet/moeda/rodada. A resposta será 202/PENDING_REFERENCE.

Envie a BET correspondente com saldo suficiente. O worker aplica o REFUND quando
sua agenda vencer. GET da transação passa a PROCESSED; saldo volta ao anterior à BET
e o ledger tem débito/crédito. Reenviar o REFUND original continua retornando o
aceite inicial com idempotentReplay=true, sem repetir o crédito.

## Agenda e diagnóstico

Política: 1 s inicial, backoff exponencial até 60 s, TTL de 24 h desde o recebimento.
Sem referência válida até o limite, a próxima tentativa rejeita com
REFERENCE_NOT_FOUND. Referência encontrada em estado diferente de PROCESSED é
rejeitada com REFERENCE_NOT_PROCESSED, conforme interpretação documentada no ADR.

Consulta local somente de diagnóstico:

```sh
docker compose exec postgres psql -U wagering -d wagering -c 'select transaction_id, attempts, next_attempt_at, expires_at, completed_at from reference_jobs order by next_attempt_at limit 20'
```

- `reference_attempt`: tentativa confirmada; inclui IDs, correlação, status e contador.
- `reference_attempt_failed`: tentativa revertida; verificar PostgreSQL, migrations
  e constraints. Não representa rejeição financeira; contador não avança.
- `reference_worker_failed`: processo não iniciou ou falhou em modo de rodada única.
- Pendência sem avanço: conferir horário devido, relógios dos hosts, processo ativo,
  migração 0004, conectividade e locks de wallet. Contenção contínua pode adiar o TTL.
- Após queda antes do commit, a agenda anterior permanece disponível. Depois do
  commit, agenda concluída é ignorada pelas próximas seleções.

Não altere status/contadores manualmente para forçar execução. Down da migration
0004 perde histórico da agenda; um novo up reconstrói apenas as pendências, usando
o prazo original. Pare os workers antes de migrations ou rollback.

## Verificação e limites

```sh
bun run check
bun run test:persistence
bun run stack:persistence
```

A suíte references usa bancos descartáveis e relógio injetado para avançar 24 horas
sem esperar esse tempo. Testes de reinício/morte usam processos e PostgreSQL reais.
O fechamento de cada cenário confere saldo reconstruído pelo ledger.

Eventos ficam na outbox; publicação SQS será implementada na T07. Os testes desta
etapa não comprovam ack, redelivery ou publicação. A [decisão 0008](../decisions/0008-pending-references.md)
registra política, locks, limitações de ordenação e recuperação.
