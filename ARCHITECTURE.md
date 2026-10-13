# Arquitetura

## Estado atual

O harness está concluído. A T01 acrescenta bootstrap NestJS executado pelo Bun,
configuração validada, build TypeScript e Compose com PostgreSQL e SQS via LocalStack.
Existe apenas o endpoint `/health/live`, sem dependência de banco ou broker.
O provisionamento cria filas vazias; ainda não existem entidades, migrations,
operações financeiras, consumidores, inbox/outbox ou garantias financeiras implementadas.

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

Nesta etapa, somente adapters e composition contêm código. Domain e application
receberão implementações a partir da T02; não foram criadas classes vazias de fachada.

O domínio não importa pacotes externos, com uma exceção reservada para `decimal.js`
caso essa opção de aritmética exata seja adotada na etapa T02. Isso não instala nem
define a implementação de Money. Aplicação não importa bibliotecas externas: I/O,
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
