# Matriz de testes obrigatórios

O [README, seção 13](../README.md) define os critérios. Esta tabela liga cada cenário
a testes executáveis; o [plano T09](exec-plans/completed/T09-distributed-recovery.md)
registra comandos, ambiente e resultados históricos. A [T11](audits/T11-readme-audit.md)
reexecutou toda a matriz e encontrou três defeitos em casos adicionais; consulte o
relatório atual antes de interpretar os testes anteriores como aprovação. Comandos de execução estão no
[runbook distribuído](runbooks/distributed.md).

## Unidade

| Critério                                  | Teste e observação                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money, escala, arredondamento e inválidos | [money.test.ts](../tests/domain/money.test.ts): precisão além de Number, centavos, operações, serialização, escala excessiva rejeitada conforme ADR 0004. Não há arredondamento silencioso.    |
| Wallet e operações                        | [wallet-ledger.test.ts](../tests/domain/wallet-ledger.test.ts): abertura, BET, WIN, LOSS sem movimento, REFUND, ROLLBACK, saldo insuficiente, moeda, versões e reconstrução por ledger.        |
| Referências e estados                     | [transactions.test.ts](../tests/domain/transactions.test.ts): regras dos cinco tipos, escopo, referência inválida, moeda, estados e conflito de payload.                                       |
| Idempotency key com payload divergente    | [idempotency.test.ts](../tests/app/idempotency.test.ts): recibo aceito com mesmo hash e conflito com outro hash para a mesma identidade. Persistência/replay HTTP são validados separadamente. |

## Integração real

| Critério                               | Teste e observação                                                                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations e constraints               | [schema.test.ts](../tests/persistence/schema.test.ts), [roundtrip.test.ts](../tests/persistence/roundtrip.test.ts): up/down/up, unicidade, CHECKs, triggers, concorrência SQL e mapeamento monetário.                                         |
| Atomicidade                            | [processing.test.ts](../tests/persistence/processing.test.ts), [consumer.test.ts](../tests/messaging/consumer.test.ts): flush seguido de falha reverte wallet/transação/ledger/recibo/outbox e inbox. T09 acrescenta SIGKILL antes do commit. |
| Inbox/redelivery                       | [consumer.test.ts](../tests/messaging/consumer.test.ts): deduplicação/hash/ack e dois consumidores. T09 acrescenta 50 entregas e crash com expiração real de visibilidade.                                                                    |
| Publishers concorrentes                | [publisher.test.ts](../tests/messaging/publisher.test.ts): locks simultâneos e invisibilidade antes do commit. T09 repete a disputa em processos independentes.                                                                               |
| Retry/DLQ                              | [consumer.test.ts](../tests/messaging/consumer.test.ts): backoff, cinco recebimentos, DLQ, redrive nativo e falha ao enviar à DLQ preservando origem. Publisher testa backoff persistido.                                                     |
| Reinicialização                        | [recovery.test.ts](../tests/messaging/recovery.test.ts), [references.test.ts](../tests/persistence/references.test.ts), T09: novos processos retomam mensagens, eventos e agenda persistida.                                                  |
| Recibo após replay/restart e conflitos | [http.test.ts](../tests/persistence/http.test.ts): HTTP real, hash canônico, identidade, resposta original e processo novo.                                                                                                                   |
| Indisponibilidade operacional          | [observability.test.ts](../tests/messaging/observability.test.ts): PostgreSQL/SQS recusados e sockets sem resposta, métricas e readiness. Não equivale a teste de partição de rede entre hosts.                                               |
| Assinante idempotente                  | [recovery.test.ts](../tests/messaging/recovery.test.ts): duas cópias com o mesmo eventId chegam ao assinante de contrato e geram um efeito SQL. Não depende da deduplicação FIFO.                                                             |

## Concorrência e recuperação da T09

Arquivos: [concurrency.test.ts](../tests/distributed/concurrency.test.ts) e
[recovery.test.ts](../tests/distributed/recovery.test.ts).

| Cenário                                    | Evidência exigida no teste                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mesma aposta 50 vezes, HTTP                | Três APIs vivas, 50 requisições em Promise.allSettled, sessões bloqueadas antes da liberação; uma criação, 49 replays, um débito; replay em API reiniciada. |
| Mesma aposta 50 vezes, SQS                 | Cinquenta envios em paralelo, três consumidores parados na barreira após receive; uma execução, 49 replays, uma inbox e um débito.                          |
| Duas apostas de 80 sobre 100               | Duas APIs na cadeia de locks: PROCESSED e REJECTED/INSUFFICIENT_FUNDS, saldo 20 e um débito.                                                                |
| Wallets distintas                          | Terceira API confirma outra wallet enquanto as duas primeiras continuam bloqueadas; não se presume paralelismo a partir da duração.                         |
| Três instâncias simultâneas                | PIDs de sistema e SQL diferentes, processos vivos e barreiras/locks observados nos testes HTTP e SQS.                                                       |
| Morte antes do commit                      | SIGKILL após flush; nenhum efeito intermediário visível; consumidor novo processa uma vez após expiração da mensagem.                                       |
| Morte depois do commit, antes do ack       | Inbox e eventos confirmados antes de SIGKILL; consumidor novo faz replay, ack e preserva débito único.                                                      |
| Dois publishers e commit antes de publicar | Após morte do consumidor, dois publishers reivindicam linhas diferentes simultaneamente; drenagem entrega todos os IDs persistidos.                         |
| Morte depois de enviar evento              | SIGKILL após send e antes de publishedAt; novo publisher confirma os mesmos IDs. Duplicata fora da janela FIFO é coberta pelo contrato de assinante acima.  |
| REFUND e ROLLBACK antes da referência      | Dois casos: pendência confirmada, SIGTERM e ack, novos consumidor/worker/API, BET tardio, reversão única, GET processado e recibo original preservado.      |

## Invariante final

Cada cenário distribuído confere saldo esperado exato e reconciliação. A fixture
de mensageria, compartilhada com T09, consulta todas as wallets antes da limpeza.
Referências já fazem a mesma consulta em afterEach. T09 acrescenta essa verificação
após cada teste das suítes de processamento e HTTP, incluindo cenários negativos.
O teste deliberado de divergência T08 restaura o estado antes de encerrar a fixture.

Asserções de unidade cobrem apenas modelos em memória. Fixtures de schema testam
inclusive dados inválidos e transações revertidas; não substituem cenários financeiros
através dos casos de uso. Reconciliação usa soma assinada NUMERIC no banco e Money,
sem converter dinheiro para number.

## Casos adicionais T11

- [Ledger e controles de reversão](../tests/audit/ledger-invariants.test.ts):
  OPENING retroativa falha; valor/tipo de reversão com aritmética coerente passam.
- [Parser HTTP](../tests/audit/http-input.test.ts): corpo excessivo e charset
  não suportado retornam 500; esperados 413/415. Duas regressões vermelhas.
- [Métrica FAILED](../tests/audit/observability.test.ts): estado persistido omitido
  do gauge; regressão vermelha.
- [Probes operacionais](../tests/audit/runtime-outage.ts): SQS com retry persistido,
  PostgreSQL com recepção durante pausa e conclusão após retomada, mesmos processos,
  replay observado por métrica, seis IDs recebidos e reconciliação 85.00.

As regressões adicionais têm comando próprio no relatório e não entram no check
original. Não aprovar main apenas porque os 414 casos anteriores passaram.
