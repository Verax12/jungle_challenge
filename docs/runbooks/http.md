# API HTTP e replay idempotente

## Preparação

Use Bun 1.4.3 e a [stack local](backend.md). Nesta máquina:

```sh
colima start backend-challenge --activate=false
export DOCKER_CONTEXT=colima-backend-challenge
bun run stack:up
bun run stack:migrate
```

A API está em http://127.0.0.1:3000. Migrations são explícitas. O banco preserva
wallets, transações e recibos entre reinícios; down sem volumes não os apaga.

Os endpoints de negócio estão abertos, por decisão documentada no
[ADR 0007](../decisions/0007-idempotency-http.md). OpenBusinessAccessGuard delimita
a futura integração OIDC/IdP; não valida tokens e não oferece autorização por usuário.
Health é público e independe desse guard. Não há tabela de credenciais.

## Criar wallet e apostar

```sh
curl -i http://127.0.0.1:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"player-demo","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```

Resposta 201 com id, playerId, balance e version 1. Copie o id e substitua
`WALLET_ID` abaixo. Se player-demo/BRL já existir, a criação retorna 409; use outro
playerId para começar um exemplo novo.

```sh
curl -i http://127.0.0.1:3000/wagering/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-demo:bet-001' \
  -d '{"providerId":"provider-demo","externalTransactionId":"bet-001","playerId":"player-demo","walletId":"WALLET_ID","roundId":"round-001","gameId":"game-demo","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
```

Primeira resposta: 201, PROCESSED, balance 75.00 BRL, walletVersion 2 e
idempotentReplay false. Repita exatamente o mesmo comando: 200, mesmo transactionId,
status e saldo, com idempotentReplay true. Outras movimentações não mudam esse
resultado original. Valores monetários são strings, nunca números JSON.

Mudar o valor mantendo a chave retorna 409/IDEMPOTENCY_CONFLICT. Trocar a chave da
mesma transação externa também é conflito. Header ausente/duplicado, chave no corpo,
campos extras, OPENING externo ou dinheiro inválido retornam 400.

## Consultar e paginar

```sh
curl http://127.0.0.1:3000/wallets/WALLET_ID
curl 'http://127.0.0.1:3000/wallets/WALLET_ID/ledger?limit=50'
curl http://127.0.0.1:3000/wagering/transactions/TRANSACTION_ID
curl http://127.0.0.1:3000/providers/provider-demo/wagering/transactions/bet-001
```

Ledger retorna items e nextCursor. Passe nextCursor sem interpretar seu conteúdo:
`?cursor=CURSOR&limit=50`. Ele é vinculado à wallet e fixa a versão máxima observada
na primeira página; novos lançamentos aparecem ao iniciar outra paginação. Ordenação
é crescente por walletVersion. Limit entre 1 e 100; padrão 50. Ausência de próxima
página é nextCursor null. Cursor opaco não é mecanismo de autenticação/assinatura.

## Resultados e falhas

| HTTP | Situação                                              | Corpo                                     |
| ---- | ----------------------------------------------------- | ----------------------------------------- |
| 201  | Wallet criada ou transação aplicada pela primeira vez | Recurso/resultado                         |
| 200  | Consulta ou replay de transação aplicada              | Recurso/resultado                         |
| 202  | Referência ausente, inclusive replay                  | PENDING_REFERENCE e saldo observado       |
| 400  | Contrato, header, cursor ou valor inválido            | code estável                              |
| 404  | Wallet/transação inexistente                          | WALLET_NOT_FOUND ou TRANSACTION_NOT_FOUND |
| 409  | Identidade/chave conflitante ou wallet duplicada      | code estável                              |
| 422  | Rejeição de negócio, inclusive replay                 | REJECTED e failureCode                    |
| 503  | Falha transitória de infraestrutura                   | INFRASTRUCTURE_TRANSIENT e Retry-After    |
| 500  | Falha inesperada                                      | INTERNAL_ERROR, sem SQL/stack/payload     |

Replay de uma pendência mantém a resposta inicial 202; GET da transação é a fonte do
estado atual. O [worker T06](references.md) resolve essas pendências sem alterar o recibo original. A T07 adiciona
inbox/consumidor/publicação. Readiness e reconciliação HTTP ainda pertencem à T08.

Transações antigas, criadas antes da T05 e sem recibo, não recebem saldo original
inventado: submissão repetida retorna TRANSACTION_IDENTITY_CONFLICT sem efeito extra.
Reverter a migration 0003 remove os recibos e suas garantias de replay; não é uma
operação de negócio. Evite reverter migrations em bancos com dados que deseja manter.

## Verificações

`bun run check` valida código, contratos auxiliares e mapeamento de erros sem banco.
`bun run stack:persistence` executa HTTP e PostgreSQL reais em bancos descartáveis:
replay de aplicação/rejeição/LOSS/pendência, conflitos concorrentes, paginação durante
inserções, recibo imutável, rollback, conexão recusada e troca de processo HTTP.
`bun run stack:smoke` verifica a imagem de produção e PostgreSQL/SQS.
A suíte com três processos simultâneos, redelivery e falhas de workers fica na T09.
