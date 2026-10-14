# Execução da stack local

## Pré-requisitos

Bun 1.4.3, Docker, Docker Compose e Buildx. Não são necessárias credenciais AWS,
conta LocalStack ou conexão à empresa. O ambiente é exclusivamente local.

No macOS, uma opção é Homebrew com Colima:

```sh
brew install colima docker docker-compose docker-buildx
colima start backend-challenge --runtime docker --vm-type vz --cpus 2 --memory 4 --disk 20 --mount none --ssh-agent=false --ssh-config=false --activate=false
export DOCKER_CONTEXT=colima-backend-challenge
```

Os plugins Compose/Buildx do Homebrew precisam ser encontrados pelo Docker. Mescle
`"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]` no arquivo de configuração
Docker do usuário, preservando outras entradas. Em Intel, adapte ao prefixo do Homebrew.
Isso já foi configurado nesta máquina. Não é necessário mudar o contexto global.

## Tudo em containers

```sh
bun run doctor
bun run stack:up
bun run stack:migrate
bun run stack:smoke
```

Não é obrigatório criar `.env` nesse modo; o Compose tem defaults públicos locais.
A imagem usa o lockfile congelado e a mesma versão Bun do projeto. A sequência é:
PostgreSQL/LocalStack saudáveis, provisionamento das filas e inicialização da aplicação.

| Serviço       | Endereço padrão no host             |
| ------------- | ----------------------------------- |
| HTTP liveness | `http://127.0.0.1:3000/health/live` |
| PostgreSQL    | `127.0.0.1:15432`                   |
| SQS           | `http://127.0.0.1:4566`             |

As filas são `wager-transactions.fifo` e `wager-transactions-dlq.fifo`. Não existem
consumidores ou redrive de negócio ainda. O smoke usa uma fila temporária própria
para envio/recebimento e a remove no final; não injeta mensagens nas filas de negócio.

## Aplicação no host, dependências em containers

```sh
cp .env.example .env
bun install --frozen-lockfile
bun run infra:up
bun run infra:provision
bun run start:dev
```

`start:dev` faz build e inicia; para aplicar alterações, encerre e execute novamente.
Em outro terminal, `bun run test:smoke` verifica HTTP, PostgreSQL e SQS. A configuração
local é carregada pelo Bun a partir de `.env`, que não entra no Git nem na imagem.
Se a aplicação Compose já ocupar a porta 3000, pare o serviço `app` antes de iniciar
outro processo local ou escolha outra porta em `.env`.

## Verificação e encerramento

```sh
bun run check
docker compose ps -a
docker compose logs --tail 100 app queues
bun run stack:down
```

`stack:down` preserva o volume PostgreSQL. Para reiniciar apenas a aplicação:
`docker compose restart app`. Após recriar LocalStack, execute `bun run stack:up`
para repetir o provisionamento, pois suas filas/mensagens não são persistidas nesta etapa.

Para liberar também a VM, execute `colima stop backend-challenge`. Não apague volumes
com dados que precisa preservar. A limpeza de volumes na CI ocorre apenas no runner descartável.

## Limites

Liveness não certifica disponibilidade do banco/broker. Domínio puro e schema já
existem; a T04 acrescenta casos de uso transacionais internos. Consulte
[migrations e testes](persistence.md). Ainda faltam endpoints financeiros, readiness,
autenticação, workers e métricas.
O smoke atual comprova instalação e comunicação, não correção financeira distribuída.
