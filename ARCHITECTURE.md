# Arquitetura

## Estado atual

O harness está concluído. A T01 acrescenta bootstrap NestJS executado pelo Bun,
configuração validada, build TypeScript e Compose com PostgreSQL e SQS via LocalStack.
O endpoint `/health/live` não depende de banco ou broker. A T05 acrescenta os
endpoints financeiros de criação, submissão e consulta, com replay persistente.
O provisionamento cria filas vazias. A T02 implementa modelos de domínio de Money,
wallet, transações, ledger, inbox/outbox e eventos, com testes de unidade.
A T03 acrescenta EntitySchema, mapeadores, migrations e constraints no PostgreSQL.
A T04 acrescenta criação de wallet e processamento transacional com outbox e lock
por wallet. A T05 liga esses casos de uso ao HTTP e grava recibos imutáveis.
A T06 acrescenta agenda persistente e worker de referências.
A T07 acrescenta consumidor SQS, inbox atômica e publishers concorrentes.
Reconciliação, observabilidade completa e matriz distribuída T09 continuam pendentes.

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

O mesmo caso de uso atende HTTP e SQS. A unidade de concorrência é a wallet.
Saldo, ledger, transação e outbox confirmam juntos pela unidade transacional da T04.
A T07 integra inbox na mesma unidade, com ack após commit e publicação da outbox.

O [ADR 0003](docs/decisions/0003-backend-foundation.md) registra NestJS, MikroORM e
LocalStack, build e limites da stack local. A [ADR 0005](docs/decisions/0005-schema-persistence.md)
define representação SQL; o [ADR 0006](docs/decisions/0006-transactional-processing.md)
detalha a execução transacional implementada. O [ADR 0007](docs/decisions/0007-idempotency-http.md) define HTTP e idempotência;
o [ADR 0009](docs/decisions/0009-sqs-inbox-outbox.md) define protocolo SQS e publicação.
Consulte [execução local](docs/runbooks/backend.md) para setup e smoke tests.

## Modelo implementado na T02

A [ADR 0004](docs/decisions/0004-financial-domain.md) documenta escala, valores zero,
moedas, transições, referências e códigos de falha. As factories validam entradas;
rehydrate reconstrói estado persistido confiável sem executar movimentações.

Wallet.open devolve a wallet e, se houver saldo inicial, OPENING e ledger. Wallet.apply
valida uma transação e seus fatos de referência antes de mudar estado, devolvendo o
ledger correspondente. LOSS só muda o estado da transação. A aplicação T04 persiste
esses objetos na mesma transação SQL; a unidade transacional garante a serialização
por wallet. A T05 persiste o resultado original para replay.

Os quatro tipos de evento têm factories e envelopes imutáveis; FinancialProcessing
os grava na outbox de acordo com o resultado de cada operação. Inbox e Outbox
modelam transições e retry parametrizado, utilizados pelos componentes da T07. IDs e
instantes ISO UTC entram como argumentos; o domínio não lê relógio nem cria UUIDs.

O mapeamento SQL está definido na T03 e a API financeira na T05. A política de
referências está definida na T06; retries de mensageria estão definidos na T07.

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
A T07 acrescenta publicação e inbox atômica. O schema não impede
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
com evento. A T06 resolve essas pendências com agenda e TTL/backoff persistidos.

Uma nova migration permite guardar os dados recebidos quando player/moeda divergem
da wallet, somente em REJECTED com o código correspondente. As demais transações
continuam sujeitas ao escopo, e rejeição nunca pode ter ledger. A migration anterior
não foi reescrita; down recusa dados incompatíveis sem apagar a auditoria.

Na entrega T04, a entrada era interna e duplicatas falhavam como conflito. A T05
passa a calcular o hash no caso de uso e a responder replay por recibo persistente;
a entrada HTTP usa esse mesmo processamento. O consumidor T07 usa o mesmo processamento. Infraestrutura/programação provocam rollback, sem
inventar rejeição de negócio. Testes reais cobrem duas apostas concorrentes e progresso
de wallets independentes. T07 cobre recuperação e mensageria; três processos
simultâneos continuam na matriz T09.

## Idempotência e HTTP implementados na T05

FinancialProcessing calcula SHA-256 de JSON com chaves ordenadas recursivamente,
incluindo somente os campos de negócio documentados no ADR 0007. Header e metadados
não entram no hash. O contrato HTTP rejeita campos extras e usa exclusivamente
Idempotency-Key do header; OPENING continua reservado à factory interna.

processing_receipts guarda identidade, hash, status, balance, walletVersion e código
de falha da resposta inicial. Schema exige identidade/resultado coerentes no commit
e proíbe alteração/exclusão. O recibo é persistido junto de transação, saldo, ledger
e outbox. Consulta antes/depois do lock resolve duplicatas na mesma wallet; corrida
entre wallets termina nas unique constraints, com rollback seguido de consulta ao
recibo confirmado para decidir conflito/replay. Não existe cache de deduplicação.

Replays de aplicação, LOSS, rejeição e pendência preservam saldo/status originais.
GET da transação mostra o estado atual; o aceite pendente não será reescrito quando
o worker T06 resolver sua referência. Dados T04 sem recibo retornam conflito, sem backfill
inventado. Mudar a chave da mesma identidade externa também é conflito.

FinancialQueries fornece GETs de wallet, transação e ledger. Cursor base64url
versionado ordena por walletVersion, fixa teto da primeira página e valida a wallet.
Ele não é assinado nem representa autorização. Novos lançamentos exigem nova
paginação. Limite padrão 50, máximo 100, sem offsets.

O [runbook HTTP](docs/runbooks/http.md) contém rotas, exemplos e a matriz de status.
Conexões são inicializadas sob demanda e fechadas no shutdown; liveness permanece
independente do banco. Erros retornam códigos sem conteúdo SQL ou dados internos.
Readiness, reconciliação e observabilidade completa seguem na T08.

## Referências implementadas na T06

reference_jobs persiste horário devido, contador, expiração, conclusão e contexto.
FinancialProcessing.retryReference usa as mesmas regras da submissão e atualiza a
transação existente. Claim adquire wallet com FOR UPDATE SKIP LOCKED antes de bloquear
agenda e reler estado. Wallets livres progridem mesmo com outra ocupada; uma wallet
continua serializada contra HTTP e demais workers. Efeitos, conclusão e eventos são
atômicos. Falha antes do commit preserva agenda; commit concluído impede reaplicação.

Espera inicial de 1 s, exponencial até 60 s, TTL de 24 h desde createdAt. Expiração
rejeita com REFERENCE_NOT_FOUND e grava evento na outbox. Referência encontrada
não processada é rejeitada, conforme ADR 0004. Não há reordenação de cadeias pendentes.
Uma tentativa ainda sem referência só atualiza a agenda. Recibo original não muda.

O processo reference-main executa rodadas de até 100 tentativas, com pausa de 500 ms.
SIGTERM interrompe novas seleções e aguarda trabalho atual; SIGKILL antes do commit
é recuperado pelo rollback PostgreSQL. O perfil Compose workers inicia explicitamente
após migrations. Sem nova dependência de scheduler. Migração 0004 inclui pendências
anteriores mantendo prazo e correlação quando disponível na outbox.

Veja [ADR 0008](docs/decisions/0008-pending-references.md) e [operação do worker](docs/runbooks/references.md).
O worker de referências apenas grava eventos; o publisher T07 os publica após commit.

## SQS, inbox e outbox implementados na T07

Consumer e publisher são processos separados da API e do worker de referências.
SqsConsumer valida o envelope e chama FinancialProcessing.process com contexto de
inbox. INSERT ON CONFLICT e lock por consumerName/messageId precedem o lock de wallet;
hash do envelope é conferido antes dos efeitos. Inbox, recibo, transação, wallet,
ledger, agenda quando houver e outbox confirmam juntos. Replay também completa a inbox.
DeleteMessage só ocorre depois do retorno do commit.

Rejeição financeira e pendência recebem ack. Entrada inválida/conflito vai à DLQ;
falhas transitórias têm visibilidade exponencial e limite de cinco recebimentos.
Redrive nativo cobre mortes sem tratamento. Envio à DLQ precede ack; falha no envio
mantém origem. Long polling é cancelado em shutdown; trabalho em curso é concluído
ou redeliverado pelo timeout se a infraestrutura impedir confirmação.

PublishOutbox seleciona uma linha devida com FOR UPDATE SKIP LOCKED, envia à fila
wager-events.fifo e marca publishedAt. Eventos ainda sem commit financeiro não são
visíveis. O lock fica aberto durante a chamada limitada de rede; cada processo tem
pool próprio e não bloqueia wallets. Erros persistem backoff de 1 s até 60 s, sem
limite que descarte eventos. SIGKILL libera posse pelo rollback PostgreSQL.

Queda depois do envio e antes de publishedAt pode duplicar entrega. O envelope e
eventId permanecem estáveis, e FIFO deduplica somente na sua janela; assinantes
precisam de inbox persistente por eventId junto dos próprios efeitos. Não há promessa
de exactly-once ou ordem global de eventos. O teste de contrato de assinante usa
inbox e efeito SQL descartáveis; não implementa outro produto consumidor.

A [operação de mensageria](docs/runbooks/messaging.md) descreve execução, envio,
DLQ e shutdown. O ADR 0009 registra hashes distintos de inbox/negócio, retenção,
limites, política de falhas e trade-offs de conexão durante envio.

## Autenticação e autorização

Conforme a seção 2 do README, autenticação foi omitida. Os endpoints financeiros
estão abertos para uso local; OpenBusinessAccessGuard é o ponto de extensão explícito,
sem validação de tokens. Health não usa esse guard. Não há credenciais artesanais.

Uma implantação autenticada substituiria o guard por integração OIDC/JWT com IdP:
validar issuer, audience, assinatura e expiração; associar identidade a provider e
players autorizados; conferir acesso às wallets nas consultas e nas mutações.
Header/body com providerId não provam identidade. SQS é canal interno, mantendo
as validações do mesmo caso de uso. A ausência atual de autorização não é uma
garantia de isolamento entre usuários.
