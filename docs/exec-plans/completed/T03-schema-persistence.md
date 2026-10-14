# T03 — Schema e persistência

```json
{
  "id": "T03",
  "status": "completed",
  "requirements": [
    "REQ-ORM",
    "REQ-MIGRATIONS",
    "REQ-LEDGER-IMMUTABLE",
    "REQ-SCHEMA-INVARIANTS",
    "REQ-WALLET-UNIQUE",
    "REQ-WALLET-NONNEGATIVE",
    "REQ-LEDGER-UNIQUE",
    "REQ-REVERSAL-UNIQUE"
  ],
  "dependsOn": ["T02"],
  "updatedAt": "2026-10-14"
}
```

## Objetivo

Persistir os modelos da T02 com MikroORM e migrations reversíveis, protegendo
invariantes financeiras no PostgreSQL conforme seções 4–7 do [README](../../../README.md).

## Requisitos atendidos

Sete requisitos dos metadados têm verificação concluída no escopo de schema e
mapeamento. REQ-WALLET-NONNEGATIVE permanece implemented: saldo negativo é rejeitado
no PostgreSQL, mas a proteção contra lost update do caso de uso exige T04/T09.
A atomicidade do fluxo com eventos/inbox continua para T04/T07.

## Dependências

T02 em `8cbf8bc`, Bun 1.4.3, PostgreSQL 17 em Docker. Branch exclusiva
`codex/t03-schema-persistence`, sem worktrees. Migrator na mesma versão do MikroORM.

## Limites

Sem endpoints financeiros, workers, publisher ou caso de uso de processamento.
Testes usam bancos descartáveis próprios; não apagam tabelas do banco de desenvolvimento.
Nenhuma migration é aplicada implicitamente pela inicialização HTTP.

## Passos

- [x] Conferir entrega anterior, abrir branch e registrar regra permanente de branches.
- [x] Documentar representação monetária, mapeamento, constraints e transações.
- [x] Implementar migrations up/down e comandos explícitos.
- [x] Mapear wallet, transação, ledger, inbox/outbox e reidratação.
- [x] Testar round trips, rollback, constraints via SQL e disputas de unicidade.
- [x] Integrar CI/Compose e revisar diff; evidências registradas junto ao commit da etapa.

## Critérios de aceite

- Valores monetários não passam por number, não arredondam silenciosamente e têm limite documentado.
- Migrations sobem, revertem e reaplicam em PostgreSQL real.
- Unicidade, saldo não negativo e ledger imutável são protegidos por schema.
- Estado final de wallet/ledger/transação consistente é conferido no commit.
- Cinco modelos fazem round trip por MikroORM e factories rehydrate.
- Testes não usam mocks como evidência de banco ou concorrência.
- Comandos e limitações permitem retomar a T04 apenas pelo repositório.

## Comandos de validação

`bun run check`, `bun run test:persistence`, `bun run stack:persistence`,
`bun run stack:smoke`, migrations up/status/down em banco descartável,
`git diff --check` e preservação do README.

## Decisões

O [ADR 0005](../../decisions/0005-schema-persistence.md) registra numeric sem typmod
com constraints de escala e faixa, evitando arredondamento de numeric(p,2).
Migrations versionadas são a autoridade do schema; EntitySchema faz o mapeamento
ORM. Triggers diferidas validam o estado final no commit e o ledger encadeado por
wallet/versão. Não foi criado caso de uso financeiro nesta etapa.

## Resultados e limitações

- Bun 1.4.3, PostgreSQL 17 real, host macOS e containers Linux no contexto
  `colima-backend-challenge`. Instalações congeladas funcionaram no host e nas
  imagens de build/produção. A resolução inicial do migrator falhou por um peer
  AJV incorreto; a dependência explícita corrigiu a instalação e está no ADR.
- `bun run check` no host e no container Linux: documentação, arquitetura, lint, formato, tipos e build;
  45 testes do harness, 30 de aplicação/configuração/tipo monetário e 131 de domínio.
- `bun run test:persistence` no host e `bun run stack:persistence` em Linux:
  43 testes e 109 asserções em PostgreSQL real, todos passando em ambos.
  Os cinco modelos fazem round trip, incluindo BRL/USD/EUR, limite monetário,
  referência resolvida e REFUND. CLI compilada e migrator fazem up/status/down/up.
- SQL direto rejeita dinheiro inválido, duplicatas, alteração de ledger, referências
  incompatíveis, estados terminais alterados e divergência wallet/ledger/transação.
  Falha após flush reverte os cinco modelos; constraints diferidas são exercitadas
  no commit. Três disputas de unicidade usam duas conexões com PIDs distintos e
  barreira de início: wallet, lançamento de ledger e reversão da mesma referência.
- `stack:up`, `stack:migrate` e `stack:smoke` passaram; smoke tem quatro testes
  com PostgreSQL/LocalStack reais. A migration inicial foi aplicada ao banco local
  de desenvolvimento. Os testes usam outros bancos descartáveis, preservando-o.
  Consulta final confirmou ausência de bancos temporários e nenhuma migration pendente.
- Workflow inclui migration e persistência; execução remota depende de publicação
  autorizada. Não há evidência de CI remota, três instâncias, 50 duplicatas,
  processamento financeiro HTTP/SQS ou recuperação de workers nesta entrega.
- README original preservado. A próxima etapa deverá adquirir lock da wallet antes
  de ler e calcular dentro de `EntityManager.transactional()`; as constraints não
  substituem a validação de concorrência do caso de uso.

## Próximo passo

T04 fará processamento transacional e concorrência do caso de uso, mediante seleção
do usuário. Criar uma branch nova a partir desta entrega antes de iniciar seu plano.
