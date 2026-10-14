# ADR 0005 — Persistência exata e invariantes no PostgreSQL

## Estado

Aceito em 2026-10-14 para T03, na branch `codex/t03-schema-persistence`.

## Contexto

O modelo puro não protege concorrência entre processos, unicidade persistente ou
alterações por SQL direto. O README exige garantias no schema e migrations reversíveis.

## Decisão

- MikroORM 6.6.17 com EntitySchema separado do domínio. Registros ORM mutáveis são
  convertidos para factories rehydrate; Money nunca recebe number. Migrations do
  pacote oficial, na mesma versão, são listadas explicitamente para funcionar no build.
  AJV 8.13.0 é dependência explícita para satisfazer o peer do ajv-draft-04 usado pelo
  migrator. A resolução inicial encontrava AJV 6 do ESLint; o lockfile preserva as
  duas versões nos seus consumidores, sem desabilitar validações.
- Dinheiro usa domínio SQL `money_amount` sobre numeric sem typmod, faixa
  `0 <= valor < 10^36`, escala até 2 e rejeição de NaN/Infinity. Isso mantém até 36
  dígitos inteiros e dois fracionários sem arredondamento implícito de numeric(p,2).
  O tipo ORM valida strings de duas casas e normaliza escala na leitura, sem Number.
  O domínio puro ainda aceita valores maiores; a fronteira de persistência os rejeita.
- Moedas limitadas a BRL/USD/EUR como na T02. IDs são text não vazios, compatíveis
  com o modelo atual; não é introduzida exigência de UUID nos IDs de provedores.
  Datas são timestamptz, mapeadas de/para instantes ISO UTC do domínio.
- Unique constraints: player/moeda; provider/ID externo; idempotency key global;
  transação/wallet no ledger; wallet/versão no ledger; inbox consumer/message.
  Índice parcial impede duas reversões PROCESSED do mesmo tipo sobre a referência,
  permitindo persistir rejeições e tentativas pendentes para auditoria.
- Ledger recebe wallet_version como ordenação persistente: abertura positiva é
  versão 1, primeiro movimento após abertura zero é versão 2. A cadeia confere
  saldo anterior, direção, valor e saldo final; o último lançamento deve concordar
  com saldo e versão da wallet. Constraints diferidas conferem o estado no commit,
  permitindo ao Unit of Work gravar os registros em ordens diferentes.
- Triggers protegem identidade da wallet, incremento de versão, identidade/payload
  da transação e estados terminais. UPDATE/DELETE do ledger e TRUNCATE das tabelas
  auditáveis são rejeitados. Deleção de registros auditáveis também é bloqueada.
  Isso protege DML normal; um administrador com privilégios para alterar schema
  ou desativar triggers continua capaz de removê-las.
- INSERT de ledger bloqueia somente a wallet correspondente; validação diferida
  compara o topo indexado e o predecessor, sem recalcular todo o histórico.
  Para T04, o caso de uso deverá executar `EntityManager.transactional()` e adquirir
  lock pessimista da wallet antes da leitura/reidratação. O schema não substitui
  esse protocolo contra cálculo com estado obsoleto; não existe lock global.
- Referências processadas são conferidas por escopo, estado, tipo e valor. Uma
  transação PROCESSED com efeito exige ledger correspondente; LOSS e rejeições não
  podem tê-lo. Consistência com inbox/outbox por operação ficará para T04/T07.
- Inbox/outbox preservam identificação e payload. Outbox guarda envelope JSONB
  completo, tentativas e datas, com índice de pendentes; não há publisher nesta etapa.
- Migrations são explícitas, sem schema update automático. Down é destrutivo para
  as tabelas financeiras e serve à reversibilidade testada, nunca é rollback de negócio.
  Testes criam bancos exclusivos descartáveis e os removem ao concluir.

## Consequências

Regras no banco e no domínio precisam evoluir juntas. Migrations não importam enums
mutáveis do domínio: sua definição fica congelada na versão. Geradores automáticos
de schema não devem substituir triggers/domínios SQL por definições simplificadas.

Uma gravação financeira parcial pode passar pelo INSERT mas falha ao confirmar a
transação. Os testes precisam observar COMMIT, não apenas flush. A criação de bancos
descartáveis exige CREATEDB no usuário de integração; não é exigência do usuário de
execução da aplicação em produção. CI usa um PostgreSQL descartável local.

## Verificação

Round trips reais de todos os modelos, lifecycle up/down/up, rollback, DML inválido,
imutabilidade, referências e disputas reais das unique constraints. Os testes de
carga, três instâncias e caso de uso financeiro continuam no roadmap.

## Referências

- [PostgreSQL 17 — numeric e arredondamento](https://www.postgresql.org/docs/17/datatype-numeric.html).
- [PostgreSQL 17 — constraint triggers](https://www.postgresql.org/docs/17/sql-createtrigger.html).
- [MikroORM 6.6 — migrations](https://mikro-orm.io/docs/6.6/migrations).
