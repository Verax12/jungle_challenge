# ADR 0006 — Unidade transacional e concorrência por wallet

## Estado

Aceito na T04 em 2026-10-14. Branch codex/t04-transactional-processing.

## Contexto

Os modelos e o schema não coordenam a leitura financeira com concorrência. A T04
precisa executar abertura/operações e produzir outbox atômica, sem antecipar HTTP,
replay de requisições, inbox/worker ou publicação.

## Decisão

- Casos de uso dependem de portas de unidade transacional, relógio e identidade.
  Adaptador MikroORM usa EntityManager separado por execução, READ COMMITTED e
  PESSIMISTIC_WRITE na wallet antes de reidratar seu saldo. O lock dura até o commit.
  Não há cache de saldo ou mutex global, nem I/O externo dentro da transação.
- Referência é lida por provider/ID externo depois do lock. Reversões consultam o
  histórico no mesmo contexto; operações válidas sobre a mesma referência têm a
  mesma wallet, logo são serializadas. A unique constraint permanece como proteção.
- Sucesso grava wallet, transação, ledger quando aplicável e outbox no mesmo commit.
  Abertura positiva gera OPENING e os eventos Processed/BalanceChanged; abertura
  zero não emite esses eventos. LOSS gera Processed sem BalanceChanged. Rejeição
  de negócio grava transação e Rejected; referência ausente grava PendingReference.
- O instante de processamento é lido depois do lock, usando o maior entre relógio,
  updatedAt da wallet e createdAt da transação. Isso preserva ordenação diante de
  espera pelo lock ou relógio local atrasado. Contadores e datas podem usar number;
  dinheiro permanece em Money/string decimal.
- Validação estrutural acontece antes de persistir. Wallet inexistente é erro de
  aplicação, pois não existe agregado para auditar. Erros de domínio esperados na
  aplicação tornam-se rejeição; erros de programação/infraestrutura propagam e
  revertem tudo. Não há retry automático nesta etapa.
- A FK composta da T03 impedia auditar moeda/player incompatível. Nova migration
  preserva a FK para wallet e exige escopo correto, exceto REJECTED com código
  correspondente. Campos originais são preservados; movimento inválido continua
  proibido. Down falha de forma transacional se houver rejeições incompatíveis com
  o schema anterior; não apaga auditoria para conseguir reverter.
- Inputs internos recebem payloadHash; hash canônico, replay e resposta original
  pertencem à T05. Duplicata de chave ou identidade externa falha com conflito e
  rollback sem novo efeito. Este comportamento intermediário não é a API final.
- O código somente enfileira eventos no PostgreSQL; não publica. Inbox e ack serão
  integrados na T07. Não são adicionados hooks de teste à interface de produção;
  testes podem decorar a unidade transacional real para induzir falhas.

## Consequências

Uma wallet muito disputada serializa suas operações; wallets distintas permanecem
independentes. Transações curtas e sem rede externa limitam o tempo de lock. Exceção
no flush ou commit invalida o resultado da execução; objetos de domínio retornados
são snapshots e a aplicação só recebe sucesso depois do commit.

T05 precisará tratar identidade/replay na mesma unidade transacional. T06 resolverá
pendências e sua política de expiração. T09 comprovará três processos e recuperação;
duas conexões reais não equivalem a esses cenários.

## Verificação

Integração real: abertura, cinco operações, rejeições auditáveis, eventos, rollback
após flush e no commit, duas apostas de 80 sobre 100, reversões concorrentes e
progresso de outra wallet enquanto a primeira está bloqueada. Cada cenário confere
saldo reconstruído pelo ledger. Unidade verifica a coordenação e erros inesperados.

## Referências

- [MikroORM 6.6 — transações e concorrência](https://mikro-orm.io/docs/6.6/transactions).
- [PostgreSQL 17 — locks explícitos](https://www.postgresql.org/docs/17/explicit-locking.html).
