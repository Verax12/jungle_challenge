# ADR 0002 — Escolhas pendentes do backend

## Estado

Proposto. Não constitui requisito adicional nem decisão aceita de implementação.

Atualização T01: ORM (MikroORM) e broker local (LocalStack Community fixado) foram
aceitos no [ADR 0003](0003-backend-foundation.md). As demais propostas continuam pendentes.

Atualização T02: a [ADR 0004](0004-financial-domain.md) escolheu centavos bigint,
sem biblioteca decimal, e suporte explícito a BRL/USD/EUR. Representação SQL e
políticas operacionais continuam pendentes; o backoff do modelo recebe parâmetros.

Atualização T03: o [ADR 0005](0005-schema-persistence.md) aceitou numeric sem
arredondamento, mapeamento MikroORM separado e constraints no PostgreSQL. O lock por
wallet já protege INSERT de ledger; sua aquisição antes da leitura pelo caso de uso
será implementada e validada na T04. TTL, tentativas e mapeamento HTTP seguem propostos.

Atualização T04: o [ADR 0006](0006-transactional-processing.md) aceitou e testou
READ COMMITTED com lock pessimista antes da leitura da wallet. HTTP, TTL e
tentativas permanecem propostas para suas etapas.

Atualização T05: o [ADR 0007](0007-idempotency-http.md) aceita SHA-256 canônico,
recibos, replay e mapeamento HTTP. TTL, backoff e tentativas continuam propostos.

## Contexto

O README fixa parte da stack e deixa escolhas ao candidato. O plano inicial
sugeriu defaults antes de preparar o harness. É necessário preservar essa distinção.

## Propostas a avaliar

| Escolha      | Restrição do README                         | Proposta anterior                                      | Etapa   |
| ------------ | ------------------------------------------- | ------------------------------------------------------ | ------- |
| ORM          | MikroORM preferencial ou TypeORM            | MikroORM                                               | T01/T03 |
| Broker local | SQS via LocalStack ou MiniStack             | LocalStack                                             | T01/T07 |
| Dinheiro     | Exato, sem number; string com duas casas    | Biblioteca decimal e colunas SQL exatas                | T02/T03 |
| Concorrência | Por wallet, múltiplas instâncias            | Lock pessimista por wallet                             | T03/T04 |
| Moeda        | BRL pode reduzir escopo; modelo multi-moeda | BRL na execução inicial                                | T02     |
| Hash         | JSON canônico dos campos de negócio         | SHA-256                                                | T05     |
| HTTP         | Distinguir classes de resultado             | 201/200/202/400/404/409/422/503/500 conforme resultado | T05     |
| Referências  | Backoff e limite/TTL justificado            | 1 s inicial, teto de 5 min, TTL de 24 h                | T06     |
| DLQ          | Limite de tentativas                        | 5 recebimentos                                         | T07     |
| Outbox       | Eventos confirmados não podem se perder     | Fila de eventos separada e retry persistido            | T07     |

Os números e estratégias são sugestões para análise na etapa indicada. Não são
critérios eliminatórios adicionais. Particularmente, decisões de zero monetário,
referências terminais, replay pendente e reversões entre tipos devem ser confrontadas
com o enunciado e documentadas antes da implementação correspondente.

## Consequências

O implementador da etapa deverá registrar uma decisão concreta com justificativa
e testes. Uma atualização deste ADR não autoriza ampliar funcionalidades do produto.

## Verificação

Revisão dos ADRs aceitos contra o README e os testes da etapa correspondente.
