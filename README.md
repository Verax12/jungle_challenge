# Jungle Challenge — Processador de apostas

Backend para processar operações financeiras de apostas por HTTP e SQS. A implementação
prioriza valores monetários exatos, idempotência persistente e consistência do saldo
sob duplicação de mensagens, concorrência, referências fora de ordem e reinícios.

O projeto usa **Bun, TypeScript estrito, NestJS, MikroORM, PostgreSQL e SQS emulado
com LocalStack**. Docker Compose prepara a infraestrutura e os quatro processos:
API, consumidor de comandos, publisher da outbox e worker de referências pendentes.

## Funcionalidades

| Operação | Comportamento                                                 |
| -------- | ------------------------------------------------------------- |
| BET      | Debita a wallet; rejeita quando o saldo é insuficiente.       |
| WIN      | Credita a wallet; pode referenciar uma BET da mesma rodada.   |
| LOSS     | Registra o resultado sem movimentar saldo.                    |
| REFUND   | Reverte integralmente uma BET processada por meio de crédito. |
| ROLLBACK | Inverte uma BET, WIN ou REFUND processada.                    |

- Wallet única por jogador/moeda, com saldo inicial auditável e ledger imutável.
- Dinheiro em strings decimais nos contratos, bigint no domínio e NUMERIC exato no banco.
- Idempotência compartilhada entre HTTP/SQS, com replay do resultado original.
- Transação SQL atômica para saldo, transação, ledger, recibo, inbox e outbox.
- Controle de concorrência por wallet, referências pendentes com retry e expiração,
  tratamento de mensagens inválidas e DLQ.
- Consultas, paginação por cursor, reconciliação, logs JSON, métricas Prometheus e health checks.

As decisões, interpretações e limites estão em [ARCHITECTURE.md](ARCHITECTURE.md).

## Executar o projeto

### Pré-requisitos

- Bun **1.4.3**, fixado em [.bun-version](.bun-version).
- Docker com Compose e Buildx, com daemon disponível.
- Portas locais **3000** (API), **15432** (PostgreSQL) e **4566** (SQS) livres.

Não é necessária conta AWS/LocalStack nem instalação de Node. O primeiro build
baixa as imagens e dependências fixadas. No macOS com Colima, consulte a
[preparação da stack](docs/runbooks/backend.md).

### Instalação e inicialização

Na raiz do repositório:

```sh
bun install --frozen-lockfile
bun run doctor
bun run check
bun run stack:up
bun run stack:migrate
bun run stack:workers
bun run stack:smoke
```

Aplique as migrations antes de usar os endpoints financeiros ou iniciar os workers.
`stack:workers` inicia consumidor, publisher e worker de referências. O ambiente
Docker usa credenciais públicas locais de desenvolvimento e dispensa `.env`.
Para executar a aplicação no host, veja o [guia de configuração](docs/runbooks/backend.md).

### Conferir a aplicação

```sh
curl -fsS http://127.0.0.1:3000/health/live
curl -fsS http://127.0.0.1:3000/health/ready
curl -fsS http://127.0.0.1:3000/metrics
curl -i http://127.0.0.1:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"player-demo","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```

A criação retorna 201, o ID da wallet, saldo 100.00 BRL e versão 1. Uma nova criação
para o mesmo jogador/moeda retorna 409. Use o ID retornado nos exemplos de
[aposta, replay, consultas e ledger](docs/runbooks/http.md).

Os valores monetários entram e saem como strings com duas casas decimais.
`POST /wagering/transactions` exige o header `Idempotency-Key`. As respostas
distinguem aplicação, replay, pendência de referência, rejeição e conflito.

### Encerrar e retomar

```sh
bun run stack:down
```

O volume PostgreSQL é preservado. Para retomar, execute `stack:up`, `stack:migrate`
e `stack:workers`. O LocalStack não mantém filas/mensagens entre recriações do seu
container; provisionar filas vazias não recupera mensagens anteriores.

## Testes e validação

Com a stack iniciada e as migrations aplicadas:

```sh
bun run check
bun run stack:persistence
bun run stack:messaging
bun run stack:distributed
bun run stack:smoke
```

| Comando                     | Verificação                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `bun run check`             | Documentação, arquitetura, lint, formatação, tipos, build e testes de harness/aplicação/domínio. |
| `bun run stack:persistence` | Migrations, constraints, atomicidade, operações e HTTP com PostgreSQL real.                      |
| `bun run stack:messaging`   | SQS, inbox/outbox, retry, DLQ, publishers e observabilidade.                                     |
| `bun run stack:distributed` | Três processos, 50 duplicatas, disputa de saldo, wallets paralelas, crash e restart.             |
| `bun run stack:smoke`       | Conectividade e comportamento básico da imagem entregue.                                         |

Para os fluxos completos da imagem de produção e as interrupções deliberadas de
PostgreSQL/SQS, siga o [runbook de validação](docs/runbooks/production-validation.md).
Ele configura uma **stack descartável exclusiva** e executa `test:recovery` antes
de `stack:production`. Não use esses testes no banco que pretende manter.

Não execute `check`/`build` simultaneamente com testes que usam `dist` no mesmo
checkout. As suítes de integração criam bancos e filas descartáveis. A
[matriz de testes](docs/test-matrix.md) detalha os cenários e as asserções financeiras.

A [validação T13](docs/audits/T13-release-validation.md) registrou **477 testes
aprovados e quatro cenários adicionais de recuperação**, com execução local e no
GitHub Actions. O [workflow](.github/workflows/harness.yml) roda em pushes e pull
requests; o [histórico de CI](https://github.com/Verax12/jungle_challenge/actions/workflows/harness.yml)
mostra o resultado de cada versão.

## Documentação

- [Arquitetura](ARCHITECTURE.md): camadas, modelo financeiro, transações, decisões e trade-offs.
- [API HTTP](docs/runbooks/http.md): endpoints, payloads, códigos de resposta e replay.
- [Mensageria](docs/runbooks/messaging.md): filas, envio de comandos, eventos e DLQ.
- [Referências pendentes](docs/runbooks/references.md): processamento fora de ordem e operação do worker.
- [Observabilidade](docs/runbooks/observability.md): reconciliação, health e métricas.
- [Persistência](docs/runbooks/persistence.md): migrations, manutenção e atualização de bancos existentes.
- [Relatório de validação](docs/audits/T13-release-validation.md): requisitos, evidências e limites dos testes.
- [Índice completo](docs/index.md): planos, decisões e demais guias.

## Limites da implementação

Autenticação não foi implementada; os endpoints financeiros estão abertos para
avaliação local. A arquitetura documenta o ponto de extensão e o desenho com
IdP/OIDC e autorização. O SQS está restrito a endpoints locais pela configuração.

O transporte é at-least-once. Assinantes dos eventos devem deduplicar `eventId`
de forma persistente; a fila FIFO não substitui essa responsabilidade.

Não há partidas dobradas, benchmark de carga, dashboard/OpenTelemetry nem
homologação em AWS real, múltiplos hosts ou recuperação de perda de disco.
Os testes documentados delimitam as garantias verificadas.
