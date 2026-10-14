# Arquitetura

## Estado atual

O harness está concluído. A T01 acrescenta bootstrap NestJS executado pelo Bun,
configuração validada, build TypeScript e Compose com PostgreSQL e SQS via LocalStack.
Existe apenas o endpoint `/health/live`, sem dependência de banco ou broker.
O provisionamento cria filas vazias. A T02 implementa modelos de domínio de Money,
wallet, transações, ledger, inbox/outbox e eventos, com testes de unidade.
A T03 acrescenta EntitySchema, mapeadores, migrations e constraints no PostgreSQL.
Ainda não existem casos de uso financeiros ligados ao servidor, consumidores ou
garantias financeiras distribuídas completas implementadas.

O [README](README.md) define o produto. O [catálogo](docs/requirements.json) liga
os requisitos às tarefas e às evidências esperadas.

## Organização das camadas

| Local              | Responsabilidade                                       | Dependências internas permitidas |
| ------------------ | ------------------------------------------------------ | -------------------------------- |
| `src/domain/`      | Money, agregados, regras, estados e eventos de domínio | domain                           |
| `src/application/` | Casos de uso e portas para persistência e serviços     | domain, application              |
| `src/adapters/`    | HTTP, ORM, SQS e implementações das portas             | domain, application, adapters    |
| `src/composition/` | Bootstrap, módulos NestJS e ligação das dependências   | Todas as camadas                 |

Portas ficam em `src/application/ports/`. Adapters da mesma camada podem compartilhar
implementações internas, mas os casos de uso não podem depender delas. O ponto de
entrada fica em `src/composition/`, sem arquivos de aplicação soltos em `src/`.

Domain contém o modelo puro da T02; adapters e composition contêm a base da T01.
Application receberá casos de uso e portas nas próximas etapas.

O domínio não importa pacotes externos. Money usa centavos `bigint` e saída decimal
com duas casas; a exceção antiga do verificador para `decimal.js` foi removida.
Aplicação não importa bibliotecas externas: I/O,
tempo e identidade são acessados por portas quando necessários. Adapters e composição
podem usar pacotes externos. Não são permitidos ciclos de imports.

## Verificação mecânica

`bun run check:architecture` analisa a AST TypeScript, imports, reexports, imports de
tipos, `import()` e `require()` literais. A resolução usa `tsconfig.json`, incluindo
o alias `@/*` para `src/*`. Imports locais não resolvidos e imports dinâmicos não
literais falham com diagnóstico. Barrels não contornam a regra: os reexports também
são analisados.

Sem arquivos em `src`, o comando informa que o backend ainda não existe. Fixtures
temporárias testam a política. O verificador não é um sandbox contra código hostil
e não comprova regras de negócio, ausência de dinheiro em `number` ou segurança em runtime.

## Fronteiras financeiras previstas

O mesmo caso de uso atenderá HTTP e SQS. A unidade de concorrência será a wallet.
Saldo, ledger, transação, inbox quando aplicável e outbox deverão confirmar juntos.
Publicação e ack ocorrerão depois do commit. Essas são obrigações futuras, ainda
sem implementação ou evidências de funcionamento.

O [ADR 0003](docs/decisions/0003-backend-foundation.md) registra NestJS, MikroORM e
LocalStack, build e limites da stack local. A [ADR 0005](docs/decisions/0005-schema-persistence.md)
define representação SQL e protocolo transacional previsto; casos de uso e protocolos
HTTP/SQS continuam pendentes das etapas correspondentes.
Consulte [execução local](docs/runbooks/backend.md) para setup e smoke tests.

## Modelo implementado na T02

A [ADR 0004](docs/decisions/0004-financial-domain.md) documenta escala, valores zero,
moedas, transições, referências e códigos de falha. As factories validam entradas;
rehydrate reconstrói estado persistido confiável sem executar movimentações.

Wallet.open devolve a wallet e, se houver saldo inicial, OPENING e ledger. Wallet.apply
valida uma transação e seus fatos de referência antes de mudar estado, devolvendo o
ledger correspondente. LOSS só muda o estado da transação. Esses objetos precisam
ser persistidos em uma mesma transação SQL futura; nenhuma memória local garante
unicidade, ausência de lost updates ou replay persistente.

Os quatro tipos de evento têm factories e envelopes imutáveis; ainda não há
coordenador que os grave automaticamente em outbox a cada operação. Inbox e Outbox
modelam transições e retry parametrizado, sem consumidores ou publishers. IDs e
instantes ISO UTC entram como argumentos; o domínio não lê relógio nem cria UUIDs.

O mapeamento SQL está definido na T03. A API financeira ainda não existe, e a política
de HTTP/TTL/tentativas segue pendente.

## Persistência implementada na T03

MikroORM mantém registros de persistência separados dos objetos de domínio, usando
EntitySchema e Unit of Work. Mapeadores convertem strings decimais para Money.rehydrate
e registros para as factories dos cinco modelos, sem decorators ou tipos ORM no domínio.
O domínio usa bigint; o banco usa numeric exato em colunas de valor e moeda separadas.
O tipo customizado ExactAmountType nunca converte dinheiro para number.

O domínio SQL money_amount não tem typmod para evitar arredondamento implícito; checks
limitam a escala a duas casas e o valor a `0 <= valor < 10^36`. A fronteira ORM exige
strings com duas casas e rejeita valores fora dessa faixa; a leitura normaliza zeros
fracionários. O domínio puro pode representar valores maiores, mas não persistí-los.

As migrations versionadas são a autoridade do schema. Uniques protegem wallet por
player/moeda, ID externo por provider, idempotency key global, ledger por transação/
wallet e por wallet/versão, inbox por consumidor/mensagem e reversão aplicada por
referência/tipo. Triggers impedem mutação de ledger e registros terminais, além de
conferir referências, versão, cadeia de saldos e consistência no commit.

Constraints diferidas permitem persistir o conjunto em um Unit of Work. Uma falha
no commit exige rollback de tudo, mesmo se flush já retornou. INSERT de ledger
bloqueia somente a wallet relacionada. O caso de uso T04 deverá usar
EntityManager.transactional e SELECT FOR UPDATE/LockMode.PESSIMISTIC_WRITE antes de
reidratar o saldo; não há lock global. Esse protocolo está definido, mas ainda não
implementado como processamento de apostas concorrentes.

O evento é armazenado como envelope JSONB completo, protegido contra alteração;
publicação e vínculo obrigatório com cada operação financeira pertencem a T04/T07.
Testes de schema e rollback manual não substituem esses fluxos. O schema não impede
um administrador de remover/desativar suas proteções. Veja [operação da persistência](docs/runbooks/persistence.md).
