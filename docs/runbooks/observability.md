# Reconciliação e observabilidade

## Inicializar

Siga a [stack local](backend.md) e a [mensageria](messaging.md). No Colima local:

```sh
export DOCKER_CONTEXT=colima-backend-challenge
bun run stack:up
bun run stack:migrate
bun run stack:workers
```

## Reconciliar

Use o ID retornado pela criação de wallet:

```sh
curl -sS -X POST http://127.0.0.1:3000/wallets/WALLET_ID/reconciliation \
  -H 'X-Correlation-Id: reconciliation-example'
```

A resposta contém walletId, storedBalance, calculatedBalance, difference, consistent
e checkedEntries. Valores são strings decimais com duas casas; difference é
armazenado menos calculado. Ledger vazio de wallet com saldo zero é consistente.
Wallet inexistente retorna 404. Divergência retorna 200 com consistent=false,
log reconciliation_divergence e incremento em reconciliations_total{consistent="false"}.
Nenhum dado financeiro é alterado. Investigue ledger/versões e origem da divergência;
não apague lançamentos nem altere saldo para fazer o endpoint ficar verde.

## Health e métricas

```sh
curl -sS http://127.0.0.1:3000/health/live
curl -sS -i http://127.0.0.1:3000/health/ready
curl -sS http://127.0.0.1:3000/metrics
```

Health não exige autenticação. Live mede processo; ready verifica PostgreSQL e as
três filas SQS e retorna 503 se uma dependência falhar. Não valida migrations nem
backlog. /metrics retorna texto Prometheus ou 503 METRICS_UNAVAILABLE se a coleta
falhar. Não retorna zeros para disfarçar indisponibilidade. Não há Prometheus ou
serviço externo de telemetria implantado.

Cada worker tem seu próprio listener interno em 9464. Inspecione sem publicar portas:

```sh
docker compose exec consumer bun -e "console.log(await (await fetch('http://127.0.0.1:9464/metrics')).text())"
docker compose exec publisher bun -e "console.log(await (await fetch('http://127.0.0.1:9464/health/ready')).text())"
docker compose exec reference-worker bun -e "console.log(await (await fetch('http://127.0.0.1:9464/metrics')).text())"
```

Na execução de vários workers no host, use portas diferentes:

```sh
METRICS_PORT=9464 bun run start:consumer
METRICS_PORT=9465 bun run start:publisher
METRICS_PORT=9466 bun run start:references
```

Execute cada comando em um terminal. --once não abre listener. Em containers,
9464 pode ser reutilizada por todos porque cada processo tem rede própria.

## Interpretar métricas

Todos os nomes começam com wagering_. Labels não contêm identidades financeiras.

| Métrica                                 | Significado                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| transactions{status}                    | Gauge global do estado persistido, incluindo OPENING                                   |
| processing_results_total{source,status} | Resultados confirmados e observados, sem replay; referências contam transição terminal |
| duplicates_total{source}                | Replays financeiros observados, HTTP ou SQS                                            |
| retries_total{source}                   | Agendamento SQS/outbox ou tentativa de referência                                      |
| dead_letters_total                      | Encaminhamentos explícitos confirmados pelo consumidor                                 |
| dlq_messages{state}                     | Profundidade aproximada do SQS, incluindo redrive nativo                               |
| lock_conflicts_total{source,code}       | Timeout de lock, deadlock ou serialization failure                                     |
| outbox_pending                          | Quantidade global de eventos não publicados                                            |
| outbox_lag_seconds                      | Idade do mais antigo não publicado; inclui backoff                                     |
| processing_duration_seconds             | Histograma das tentativas, incluindo rollback; polling vazio excluído                  |
| reconciliations_total{consistent}       | Reconciliações concluídas, separando divergências                                      |

Contadores e histogramas são locais e reiniciam junto com o processo. Agregue rates
por instância para volume; não some gauges globais repetidos por API/workers.
Use max para lag/backlog entre targets equivalentes. Status atual não é histórico de
transições. Uma queda entre commit e observação pode perder o contador local; ledger,
recibos e transações são a autoridade para auditoria. DLQ usa contagens aproximadas.

## Logs e diagnóstico

```sh
docker compose logs --tail 100 app consumer publisher reference-worker
```

Eventos úteis: transaction_committed, http_completed, message_retry,
message_dead_lettered, outbox_attempt, reference_attempt, reconciliation_divergence
e processing_failed. Os eventos da instrumentação têm os campos de correlação, com null quando não
aplicáveis; diagnósticos de bootstrap/framework têm seu próprio formato. X-Correlation-Id é devolvido pela API.
Não há dinheiro, body, chave idempotente ou SQL nesses eventos. IDs devem ser IDs,
não campos para transportar segredos.

- ready PostgreSQL down: confira container, porta e credenciais locais.
- ready SQS down: confira LocalStack e provisionamento das três filas.
- ready up e metrics 503: confira migrations e custo/timeout da consulta de coleta.
- outbox lag crescente: confira publisher, disponibilidade da fila e retries.
- lock conflicts crescentes: examine concorrência por wallet e tempo de transações.
- divergência: preserve evidências, investigue sem reparo silencioso.

Probes limitam conexão, aquisição e consultas; limites individuais não são uma SLA
única para toda a requisição. Em erro, apenas estados/códigos sanitizados são expostos.

## Verificação

```sh
bun run check
bun run test:persistence
bun run test:messaging
bun run stack:messaging
bun run stack:smoke
bun run stack:down
```

Testes de mensageria incluem as integrações da T08 em bancos/filas descartáveis.
Um teste cria divergência deliberada somente nesses bancos e restaura o saldo
antes de encerrá-los. Nenhuma proteção é removida do schema da aplicação.
Veja [ADR 0010](../decisions/0010-reconciliation-observability.md) para limites.
