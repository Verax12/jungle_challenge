# T05 — Idempotência e HTTP

```json
{
  "id": "T05",
  "status": "completed",
  "requirements": [
    "REQ-AUTH",
    "REQ-DURABLE-IDEMPOTENCY",
    "REQ-OPENING-INTERNAL",
    "REQ-PAYLOAD-CONFLICT",
    "REQ-REPLAY-ORIGINAL",
    "REQ-WALLET-API",
    "REQ-QUERY-API",
    "REQ-LEDGER-CURSOR",
    "REQ-SUBMIT-API",
    "REQ-IDEMPOTENCY-HEADER",
    "REQ-CANONICAL-HASH",
    "REQ-HTTP-STATUS"
  ],
  "dependsOn": ["T04"],
  "updatedAt": "2026-10-14"
}
```

## Objetivo

Expor criação e consulta de wallets, ledger e transações, com submissão idempotente
persistente e resultado original preservado, conforme seções 2, 7 e 9 do README.

## Requisitos atendidos

Onze requisitos dos metadados verificados no escopo da etapa. OPENING é barrado
no HTTP e na entrada compartilhada; REQ-OPENING-INTERNAL permanece implemented
porque a verificação no consumidor real depende da T07. Autenticação foi omitida,
com extensão e desenho documentados conforme permitido.

## Dependências

T04 em d57b145, Bun 1.4.3, PostgreSQL 17. Branch codex/t05-idempotency-http.

## Limites

Sem reconciliação/readiness (T08), worker de referências (T06), inbox/SQS/publisher
(T07) ou autenticação artesanal. Nenhum push, serviço externo ou worktree.

## Passos

- [x] Revisar requisitos, estado e abrir branch exclusiva.
- [x] Registrar decisões e implementar recibo persistente com hash canônico.
- [x] Implementar contratos HTTP, consultas e paginação estável.
- [x] Documentar autenticação ausente e ponto de extensão.
- [x] Validar replay, conflitos, concorrência, restart, rollback e contratos HTTP.
- [x] Revisar diff, atualizar evidências e concluir com commit.

## Critérios de aceite

- Header obrigatório é a única origem da chave; metadados não entram no hash.
- Replay após movimentos e restart preserva status/saldo originalmente respondidos.
- Payload divergente e identidades cruzadas falham sem alterar o resultado anterior.
- Duplicatas simultâneas têm um único efeito persistente, sem cache em memória.
- GETs retornam contratos monetários em strings; ledger usa cursor opaco por wallet.
- HTTP diferencia inválido, conflito, rejeição, pendência, ausente e falha transitória.
- Schema e migrations preservam os dados da T04; nenhuma garantia futura é declarada pronta.

## Comandos de validação

bun run check; bun run test:persistence; bun run stack:persistence;
bun run stack:up; bun run stack:migrate; bun run stack:smoke; git diff --check.

## Decisões

O [ADR 0007](../../decisions/0007-idempotency-http.md) registra hash SHA-256, recibo
imutável, replay pendente, identidades, paginação e códigos HTTP. Sem backfill inventado para respostas da T04.

## Resultados e limitações

- Implementados recibos persistentes e imutáveis, hash canônico no caso de uso,
  replay e conflito por identidade/payload. Migration 0003 acrescenta o recibo sem
  reescrever migrations anteriores ou inventar respostas para dados legados.
- Implementados POST wallet/transação e GET wallet/ledger/transação por ambas as
  identidades. NestJS conecta sob demanda, fecha recursos no shutdown e mantém
  liveness independente. Nenhuma dependência nova foi necessária.
- Contratos recusam header ausente/duplicado, chave no corpo, campos extras, OPENING
  externo, dinheiro numérico/escala excessiva e cursor inválido. GETs mantêm valores
  monetários em strings e não expõem payloadHash/idempotencyKey.
- Testes de HTTP/PostgreSQL reais passaram no host e em Linux: 102 testes de
  persistência, 695 asserções. Incluem 28 cenários novos de HTTP/idempotência; recibos
  também foram incorporados à verificação de rollback da T04.
- `bun run check` passou no host e em Linux: documentação, arquitetura, lint,
  formatação, tipos, build e 223 testes (45 harness, 47 aplicação, 131 domínio).
  Com os 102 testes de persistência e os 5 de smoke, são 330 testes, sem falhas.
  As três migrations estão aplicadas no banco local, sem pendências; nenhum banco
  descartável dos testes permaneceu após a execução.
- Replays de aplicação, LOSS, rejeição e pendência preservaram saldo/status após
  outros movimentos. Um processo HTTP foi encerrado e outro iniciado, usando o
  mesmo banco descartável; o resultado original foi recuperado pelo processo novo.
- Concorrência sincronizada por locks reais comprovou submissão idêntica com um
  débito e um replay, payloads divergentes na mesma wallet e mesma chave em wallets
  distintas. A perdedora reverte antes da leitura do recibo confirmado.
- Paginação manteve teto estável durante inserção, sem repetir IDs, e rejeitou cursor
  de outra wallet. Recibo recusou UPDATE/DELETE/TRUNCATE e snapshot fabricado. Uma
  conexão PostgreSQL realmente recusada produziu 503 e manteve health disponível.
- Testes isolados de falhas complementam 503 com SQLSTATEs transitórios e 500
  inesperado sem SQL, stack, senha ou payload. Esses testes não são evidência de
  retry, DLQ ou recuperação de workers.
- Bun 1.4.3, PostgreSQL 17, host macOS e containers Linux. Instalação congelada no
  host e nas imagens. Smoke ampliado consulta a API financeira da imagem de produção
  sem gravar dados no banco local. CI remota depende de publicação autorizada.
- Limitações: autenticação/autorização ausentes por decisão explícita; worker T06,
  inbox/publicação T07 e reconciliação/readiness T08 continuam pendentes. Replay de
  PENDING_REFERENCE preserva o aceite inicial; GET será a consulta do estado atual.
  Três processos simultâneos e redelivery permanecem na T09. Dados T04 sem recibo
  retornam conflito; down da migration 0003 remove os recibos e a capacidade de replay.
- README original preservado. Trabalho no checkout existente, sem worktrees ou push.

## Próximo passo

T06 — referências fora de ordem, aguardando seleção do usuário. Abrir nova branch
a partir desta entrega antes de detalhar e implementar worker/backoff/expiração.
