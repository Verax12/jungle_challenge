# Reprodução limpa da entrega

## Isolamento

Use os pré-requisitos da [stack](backend.md) e execute na raiz do checkout. Um nome
Compose diferente cria rede/volume PostgreSQL independentes, sem worktree ou cópia
do repositório. Escolha um nome que ainda não exista e confirme isso antes de subir:

```sh
export COMPOSE_PROJECT_NAME=backend-challenge-review
export PORT=13010
export DB_PORT=15440
docker compose ps -a
docker volume ls --filter label=com.docker.compose.project=$COMPOSE_PROJECT_NAME
```

No Colima, acrescente `export DOCKER_CONTEXT=colima-backend-challenge` antes dos
comandos. SQS continua publicado em 4566, que precisa estar livre. Não reutilize um
nome com dados existentes: esta sequência terminará removendo o volume da revisão.
Não é necessário criar .env. Se houver .env próprio, confira a configuração Compose
antes de usar este roteiro. Senhas locais são públicas e exclusivas do desenvolvimento.

## Instalar e validar

```sh
bun run doctor
docker compose build --no-cache app distributed
docker compose run --rm --no-deps distributed bun run check
bun run stack:up
bun run stack:migrate
bun run stack:migrate
bun run stack:persistence
bun run stack:messaging
bun run stack:distributed
bun run stack:smoke
bun run stack:workers
```

O build sem cache cria node_modules/dist na imagem a partir do lockfile congelado;
não usa os diretórios do host, excluídos por .dockerignore. Imagens base podem estar
no cache local, mas instalação e build são executados novamente. O volume novo
comprova migrations desde banco vazio; a segunda execução comprova idempotência.
As suítes de persistência também testam down/up em bancos descartáveis.

O check da imagem executa os mesmos gates que o host, com Bun fixado. Os comandos
stack:* podem reconstruir imagens aproveitando o cache recém-criado. Não precisam
de dependências instaladas no host além do Bun/CLI Docker.

## Conferir operação

```sh
curl -fsS http://127.0.0.1:13010/health/live
curl -fsS http://127.0.0.1:13010/health/ready
curl -fsS http://127.0.0.1:13010/metrics
docker compose exec -T consumer bun -e "for(const path of ['health/live','health/ready','metrics']){const r=await fetch('http://127.0.0.1:9464/'+path);if(!r.ok)process.exit(1)}"
docker compose exec -T publisher bun -e "for(const path of ['health/live','health/ready','metrics']){const r=await fetch('http://127.0.0.1:9464/'+path);if(!r.ok)process.exit(1)}"
docker compose exec -T reference-worker bun -e "for(const path of ['health/live','health/ready','metrics']){const r=await fetch('http://127.0.0.1:9464/'+path);if(!r.ok)process.exit(1)}"
```

Adapte os exemplos de [HTTP](http.md) à porta 13010: criar wallet, apostar, repetir,
consultar ledger e reconciliar. Para SQS, use o [envelope e envio](messaging.md).
Somente o banco da revisão recebe esses exemplos. Publisher deve drenar a outbox;
workers devem continuar saudáveis. As suítes distribuídas já exercitam falhas e restart.

## Encerrar

Confirme que COMPOSE_PROJECT_NAME ainda identifica a stack descartável escolhida:

```sh
docker compose --profile workers down --volumes
```

Esse comando apaga o volume dessa revisão. Para a stack habitual, use
`bun run stack:down`, que preserva volumes. Não execute prune nem limpezas por
wildcard. Colima e outros containers não precisam ser encerrados.

Registre commit/base, versões, comandos, resultados e limites na
[auditoria de entrega](../delivery-review.md). Passar localmente não significa que
o workflow remoto foi executado; esse resultado depende de publicação autorizada.
