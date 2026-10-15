# Validação dos processos de produção

## Escopo

A suíte usa API NestJS, consumidor, publisher e worker de referências reais da imagem
runtime. Dados financeiros são criados apenas por HTTP/SQS; SQL é usado para leitura
e comparação. A instrumentação das suítes distribuídas continua cobrindo mortes em
fronteiras transacionais exatas; estes testes conferem os entrypoints entregues.

Os testes criam registros financeiros persistentes e consomem os eventos das wallets
que criaram. Use uma stack descartável exclusiva, nunca o banco que pretende manter.
PRODUCTION_TESTS=1 é obrigatório; o comando em containers já o configura.

## Executar

Na raiz do checkout, com portas livres:

```sh
export DOCKER_CONTEXT=colima-backend-challenge
export COMPOSE_PROJECT_NAME=backend-challenge-t13-validation
export PORT=13013
export DB_PORT=15443
export DB_PASSWORD=challenge-local-only
export AUDIT_APP_URL=http://127.0.0.1:13013
export AUDIT_POSTGRES_MODE=stop
bun install --frozen-lockfile
bun run stack:up
bun run stack:migrate
bun run stack:workers
bun run test:recovery
bun run stack:production
```

Se usa outro Docker local, selecione seu contexto. SQS usa a porta 4566. O teste
recovery deve rodar primeiro num banco de negócio vazio; suas outras fixtures de
integração usam bancos separados. Não execute outras suítes que dependam de DB/SQS
durante recovery, pois ele deliberadamente interrompe essas dependências.

Para rodar somente os seis fluxos de produção a partir do host:

```sh
PRODUCTION_TESTS=1 SMOKE_APP_URL=http://127.0.0.1:13013 bun run test:production
```

Esse comando exige as variáveis DB_PORT/DB_PASSWORD anteriores. Pode repetir os
fluxos: cada caso cria wallets e identidades únicas e reconcilia o banco ao terminar.
O helper devolve visibilidade aos eventos alheios; não apaga esses eventos.

## O que é conferido

- BET, WIN, LOSS, REFUND e ROLLBACK pela API; rejeição, conflito, replay original,
  consultas, paginação estável durante novo movimento e reconciliação.
- Três entregas SQS com deduplication IDs distintos e duas identidades de inbox,
  uma transação financeira/recibo e um débito; replay cruzando HTTP/SQS.
- REFUND/ROLLBACK antecipados por HTTP e SQS, resolvidos pelo worker real após BET
  recebida pelo outro canal; recibo original continua PENDING_REFERENCE.
- IDs e envelopes recebidos do broker iguais aos confirmados na outbox; quantidades
  esperadas por tipo de evento e ausência de ledger em LOSS/rejeição.
- SQS pausado: live permanece disponível, readiness falha, operação financeira
  confirma, retry da outbox é persistido e publicação retoma sem perder IDs.
- PostgreSQL parado: depois de confirmar que o consumidor retomou polling do SQS,
  envio durante a parada produz retry observado; ao reiniciar o banco, os mesmos
  processos completam uma vez, reconciliam e publicam eventos.
- SIGTERM enquanto o consumer está bloqueado antes do commit: sinal observado por
  Docker, ausência de dados visíveis antes de liberar lock, commit+ack e saída 0;
  restart e duplicata confirmam um efeito, inbox/recibo e ledger coerentes.

Os probes validam o nome do projeto e endereços locais. O teste de shutdown também
confere IP do consumidor contra pg_stat_activity e mapeamentos de portas. Não são
probes AWS nem experimentos de perda de disco. Parar PostgreSQL preserva seu volume;
pausar LocalStack preserva suas filas. Nenhuma limpeza por wildcard é executada.

## Encerrar

Com o mesmo COMPOSE_PROJECT_NAME exclusivo:

```sh
docker compose --profile workers down --volumes
```

Isso remove o banco de teste. A stack habitual deve usar stack:down sem --volumes.
A [CI](../../.github/workflows/harness.yml) executa essas verificações após as suítes
obrigatórias e antes de remover seus próprios recursos.
