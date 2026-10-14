# Migrations e testes de persistência

## Ambiente

Use Bun 1.4.3 e PostgreSQL 17 conforme [stack local](backend.md). O schema de
desenvolvimento é o banco `wagering` por padrão. Migrations são explícitas; iniciar
o servidor HTTP não altera tabelas automaticamente.

## Tudo em containers

Com o perfil Colima existente nesta máquina:

```sh
colima start backend-challenge --activate=false
export DOCKER_CONTEXT=colima-backend-challenge
bun run stack:up
bun run stack:migrate
bun run stack:persistence
bun run stack:smoke
```

`stack:migrate` aplica migrations pendentes no banco configurado pelo Compose.
Executá-lo novamente não recria tabelas nem reaplica versões já registradas.
Para consultar o histórico usando a imagem de produção:

```sh
docker compose run --rm migrate bun dist/composition/migrate.js status
```

## Ferramentas no host

```sh
test -f .env || cp .env.example .env
bun install --frozen-lockfile
docker compose up -d --wait postgres
bun run db:migrate
bun run db:status
bun run test:persistence
```

Esses comandos compilam o código antes de executar. A senha local de exemplo é
pública e exclusiva do desenvolvimento. As migrations e os testes não dependem do SQS.

## Reversão

`bun run db:rollback` reverte a última migration. Na versão inicial isso remove as
cinco tabelas financeiras e seus dados; execute somente num banco descartável ou
quando essa perda for desejada. Reversões financeiras de apostas usam novas operações,
nunca down de migration. A segunda migration permite rejeições auditáveis de
player/moeda incompatível. Seu down restaura a FK anterior: falha e preserva tudo
caso existam rejeições incompatíveis com ela. Não exclua auditoria para forçar o down.
A migration 0003 cria recibos idempotentes; seu down remove os recibos, preservando
as transações financeiras, que deixam de ter replay original disponível.
A migration 0004 cria e preenche agenda de referências pendentes; down perde
agenda/contadores, preservando transações e recibos. Pare os workers antes de migrations.
Os testes cobrem tanto reversão completa num banco vazio quanto upgrade/reversão
com dados existentes e falha segura diante dessas rejeições.

## O que os testes comprovam

- Os cinco modelos passam por MikroORM e factories rehydrate, incluindo valores
  monetários com 36 dígitos inteiros e duas casas, sem conversão para number.
- Constraints rejeitam escala excedente, valores especiais, saldo negativo,
  duplicidades, alterações de ledger, referências inválidas e estados inconsistentes.
- Disputas de unicidade usam duas conexões com PIDs PostgreSQL diferentes e uma
  barreira antes das operações; esses testes verificam as constraints.
- Uma falha após flush reverte o conjunto; inconsistência diferida falha no commit.
- Casos de uso da T04 exercitam abertura, cinco operações, rejeições, eventos e
  rollback. Duas apostas de 80.00 sobre 100.00 geram um débito, uma rejeição e 20.00.
  REFUND/ROLLBACK concorrentes aplicam uma vez; outra wallet progride enquanto a
  primeira está bloqueada. Todos os cenários conferem saldo versus soma do ledger.
- O comando compilado de migrations funciona sem fontes TypeScript ou CLI global.

Cada suíte cria um banco `challenge_test_<identificador aleatório>`, aplica migrations
e remove apenas esse banco ao concluir. O usuário de integração precisa de CREATEDB.
Não há TRUNCATE, DROP ou down no banco configurado por `DB_NAME` durante os testes.
Em interrupção abrupta, um banco temporário pode permanecer; consulte os nomes antes
de remover manualmente um banco que tenha esse prefixo. Não use limpeza por wildcard.

## Diagnóstico

- `ECONNREFUSED`: confira daemon/contexto Docker e a porta 15432 no host.
- Falta de CREATEDB: use o usuário local do Compose; não conceda privilégios de
  administração ao usuário de execução em produção para satisfazer testes.
- `23505`: unique constraint; identifique se é chave externa, idempotência, ledger,
  wallet ou reversão antes de mapear o resultado para o caso de uso.
- `23514`: check/trigger de domínio; conferir a transação inteira, pois a falha pode
  ocorrer no commit mesmo após flush bem-sucedido.
- `23503`: referência ou escopo inexistente/incompatível.
- `ajv/dist/core` ausente: reinstale com lockfile congelado. AJV 8.13.0 está fixado
  para o peer usado pelo migrator; o ESLint conserva sua dependência AJV 6 separada.

Não use schema update automático do ORM: as migrations contêm domínios e triggers
que não são descritos integralmente pelo EntitySchema. Após editar dependências,
reconstrua as imagens. Não altere migrations já aplicadas em ambientes compartilhados;
acrescente uma nova migration versionada.

## Encerramento e limites

`bun run stack:down` e `colima stop backend-challenge` liberam os serviços, mantendo
o volume PostgreSQL. As tabelas continuam disponíveis na próxima inicialização.
Os casos de uso internos estão em src/application/financial-processing.ts, ligados
ao banco por createFinancialProcessing em src/composition/financial-processing.ts.
A T05 acrescenta [endpoints financeiros e replay original](http.md). O [worker de referências](references.md) existe na T06, com recuperação
após SIGTERM e SIGKILL testada. A T07 usa o mesmo schema para inbox e publicação; não acrescenta migration.
Readiness e três instâncias completas continuam pendentes.
