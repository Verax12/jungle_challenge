# Arquitetura

## Estado atual

O harness está concluído. A T01 acrescenta bootstrap NestJS executado pelo Bun,
configuração validada, build TypeScript e Compose com PostgreSQL e SQS via LocalStack.
Existe apenas o endpoint `/health/live`, sem dependência de banco ou broker.
O provisionamento cria filas vazias. A T02 implementa modelos de domínio de Money,
wallet, transações, ledger, inbox/outbox e eventos, com testes de unidade.
A T03 acrescenta EntitySchema, mapeadores, migrations e constraints no PostgreSQL.
A T04 acrescenta criação de wallet e processamento transacional com outbox e lock
por wallet. Esses casos de uso ainda não estão ligados ao servidor HTTP ou à fila;
consumidores e garantias financeiras distribuídas completas continuam pendentes.

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
Application contém FinancialProcessing e portas de unidade transacional/relógio/identidade.

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
Saldo, ledger, transação e outbox confirmam juntos pela unidade transacional da T04.
A integração da inbox, publicação e ack após commit continuam para T07.

O [ADR 0003](docs/decisions/0003-backend-foundation.md) registra NestJS, MikroORM e
LocalStack, build e limites da stack local. A [ADR 0005](docs/decisions/0005-schema-persistence.md)
define representação SQL; o [ADR 0006](docs/decisions/0006-transactional-processing.md)
detalha a execução transacional implementada. Protocolos HTTP/SQS continuam pendentes.
Consulte [execução local](docs/runbooks/backend.md) para setup e smoke tests.

## Modelo implementado na T02

A [ADR 0004](docs/decisions/0004-financial-domain.md) documenta escala, valores zero,
moedas, transições, referências e códigos de falha. As factories validam entradas;
rehydrate reconstrói estado persistido confiável sem executar movimentações.

Wallet.open devolve a wallet e, se houver saldo inicial, OPENING e ledger. Wallet.apply
valida uma transação e seus fatos de referência antes de mudar estado, devolvendo o
ledger correspondente. LOSS só muda o estado da transação. A aplicação T04 persiste
esses objetos na mesma transação SQL; a unidade transacional garante a serialização
por wallet. Replay do resultado original pertence à T05.

Os quatro tipos de evento têm factories e envelopes imutáveis; FinancialProcessing
os grava na outbox de acordo com o resultado de cada operação. Inbox e Outbox
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
bloqueia somente a wallet relacionada. O caso de uso T04 usa
EntityManager.transactional e LockMode.PESSIMISTIC_WRITE antes de reidratar o saldo.
READ COMMITTED permite que a leitura após a espera observe a operação anterior.
Cada execução usa um EntityManager separado; não há lock global.

O evento é armazenado como envelope JSONB completo, protegido contra alteração;
a T04 grava os eventos na mesma unidade transacional dos efeitos financeiros.
Publicação e inbox permanecem na T07. O schema não impede
um administrador de remover/desativar suas proteções. Veja [operação da persistência](docs/runbooks/persistence.md).

## Processamento implementado na T04

FinancialProcessing oferece createWallet e process, ligados ao MikroORM por
createFinancialProcessing na composição. A porta FinancialUnitOfWork só resolve
após o commit; falhas de flush/commit revertem todos os registros. O domínio continua
sem ORM, relógio ou geração de IDs. Clock/UUID/SHA-256 da abertura são adaptadores.

Abertura positiva cria OPENING, ledger CREDIT e eventos Processed/BalanceChanged;
abertura zero cria apenas wallet com versão 1. BET/WIN/REFUND/ROLLBACK aplicados
mudam saldo, ledger e versão. LOSS produz Processed sem movimento. Rejeições de
negócio geram transação REJECTED com código e evento, preservando saldo/versão.
Referências são buscadas por provider/ID externo; ausência fica PENDING_REFERENCE,
com evento. Resolver essas pendências e definir TTL/backoff pertencem à T06.

Uma nova migration permite guardar os dados recebidos quando player/moeda divergem
da wallet, somente em REJECTED com o código correspondente. As demais transações
continuam sujeitas ao escopo, e rejeição nunca pode ter ledger. A migration anterior
não foi reescrita; down recusa dados incompatíveis sem apagar a auditoria.

A entrada atual é interna e exige payloadHash pronto. Duplicatas falham com conflito
sem repetir efeitos; não há ainda replay de resposta original, hash canônico externo,
contrato HTTP ou consumidor. Infraestrutura/programação provocam rollback, sem
inventar rejeição de negócio. Testes reais cobrem duas apostas concorrentes e progresso
de wallets independentes; três processos, recuperação e mensageria continuam no roadmap.
