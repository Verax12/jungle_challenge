# Arquitetura

## Estado atual

O harness está concluído. A T01 acrescenta bootstrap NestJS executado pelo Bun,
configuração validada, build TypeScript e Compose com PostgreSQL e SQS via LocalStack.
Existe apenas o endpoint `/health/live`, sem dependência de banco ou broker.
O provisionamento cria filas vazias. A T02 implementa modelos de domínio de Money,
wallet, transações, ledger, inbox/outbox e eventos, com testes de unidade.
Ainda não existem entidades ORM, migrations, casos de uso financeiros ligados ao
servidor, consumidores ou garantias financeiras distribuídas implementadas.

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
LocalStack, build e limites da stack local. Representação SQL de Money, estratégia
de lock e decisões de protocolo continuam pendentes das etapas correspondentes.
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

O mapeamento de bigint para representação SQL exata e seus limites será definido na
T03. A API financeira ainda não existe, e a política de HTTP/TTL/tentativas segue pendente.
