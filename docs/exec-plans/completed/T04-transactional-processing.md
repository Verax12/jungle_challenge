# T04 — Processamento transacional e concorrência

```json
{
  "id": "T04",
  "status": "completed",
  "requirements": [
    "REQ-WALLET-CONCURRENCY",
    "REQ-WALLET-LEDGER",
    "REQ-WALLET-VERSION",
    "REQ-NO-EFFECT-LEDGER",
    "REQ-BET",
    "REQ-WIN",
    "REQ-LOSS",
    "REQ-REFUND",
    "REQ-ROLLBACK",
    "REQ-REVERSAL-AMOUNT",
    "REQ-REVERSAL-INSUFFICIENT",
    "REQ-OPENING-ATOMIC"
  ],
  "dependsOn": ["T03"],
  "updatedAt": "2026-10-14"
}
```

## Objetivo

Criar wallets e processar operações financeiras com atomicidade e serialização por
wallet no PostgreSQL, preservando domínio puro e outbox persistente.

## Requisitos atendidos

Requisitos dos metadados: operações, abertura, versão, ledger e concorrência.
A ausência de lost update e a geração atômica de eventos recebem evidências adicionais.

## Dependências

T03 em f38f03d; Bun 1.4.3 e PostgreSQL 17 real. Branch exclusiva
codex/t04-transactional-processing, sem worktrees.

## Limites

Sem endpoints, hash/replay de requisições externas, worker de referências, inbox SQS
ou publisher. Entrada da aplicação é interna e recebe payloadHash já calculado;
T05 definirá o contrato externo e resposta original de replay. Duplicação deve
falhar sem novo efeito. Referência ausente permanece pendente para T06.

## Passos

- [x] Revisar estado e abrir branch exclusiva.
- [x] Registrar decisões, portas e plano antes da implementação.
- [x] Implementar abertura e processamento com eventos e lock antes da leitura.
- [x] Adaptar schema para auditar rejeições de moeda/player sem permitir aplicação inválida.
- [x] Testar operações, rollback, disputa de saldo, reversões e wallets independentes.
- [x] Executar gates, revisar diff, atualizar evidências e concluir com commit.

## Critérios de aceite

- Abertura positiva grava OPENING, ledger, saldo e eventos juntos; zero mantém versão 1.
- Duas apostas de 80.00 sobre 100.00 produzem uma aplicação, uma rejeição e saldo 20.00.
- Wallets distintas progridem mesmo com uma wallet bloqueada; nenhuma trava global.
- LOSS/rejeição não mudam saldo/versão/ledger; eventos refletem o resultado.
- Reversões conferem referência integral e duplicação sob o mesmo lock.
- Falhas antes do commit revertem efeitos, incluindo outbox.
- Cada cenário financeiro confere saldo reconstruído pelo ledger.

## Comandos de validação

bun run check; bun run test:persistence; bun run stack:persistence;
bun run stack:smoke; instalação congelada; migrations e git diff --check.

## Decisões

O [ADR 0006](../../decisions/0006-transactional-processing.md) registra READ COMMITTED,
lock pessimista por wallet, unidade transacional e tratamento das rejeições.
Erros de infraestrutura causam rollback; não são convertidos em rejeição de negócio.

## Resultados e limitações

- Implementados FinancialProcessing, portas, adaptador MikroORM e composição interna.
  Nenhum endpoint/consumidor foi adicionado. Migration 0002 permite auditar rejeições
  por moeda/player incompatível e mantém proibida sua aplicação financeira.
- Bun 1.4.3, PostgreSQL 17 real, macOS e containers Linux no contexto dedicado.
  Nenhuma dependência nova. Instalação congelada passou no host e nas imagens.
- bun run check passou no host e no container Linux: documentos, arquitetura (27 arquivos), lint, formatação,
  tipos, build, 45 testes do harness, 36 de aplicação/configuração e 131 de domínio.
- bun run test:persistence e stack:persistence: 74 testes, 489 asserções,
  sem falhas em ambos. Incluem 31 testes novos de processamento e upgrade; mais
  seis testes unitários de coordenação elevam a suíte de aplicação de 30 para 36.
- Disputa obrigatória comprovada: duas sessões PostgreSQL bloqueadas antes de liberar
  a wallet; uma aposta aplicada, outra rejeitada e saldo 20.00. Repetir identidades
  não altera saldo. Outra wallet confirma sem esperar pela wallet bloqueada.
- REFUND e ROLLBACK concorrentes têm um único efeito. Operações e rejeições
  preservam eventos corretos, versão e saldo igual à soma do ledger. Falhas após
  flush e no commit revertem o conjunto; nenhum evento é publicado nesta etapa.
- Primeira versão do teste de sincronização falhou porque o segundo waiter pode
  bloquear no primeiro, e não diretamente na transação de controle. A observação
  foi corrigida para percorrer a cadeia pg_blocking_pids, com prazo e PIDs distintos;
  nenhuma regra de negócio foi enfraquecida. A orientação está em quality.md.
- Migration 0002 testada em upgrade com dados, down/up e recusa segura de down
  quando há rejeições incompatíveis com a FK antiga. Recusa mantém dados e histórico.
  A migration foi aplicada ao banco local de desenvolvimento por stack:migrate.
  Consulta final confirmou as duas migrations aplicadas, nenhuma pendente e nenhum
  banco temporário restante.
- stack:up e stack:smoke passaram: quatro testes com HTTP, PostgreSQL e SQS reais.
  Total de 290 testes distintos, incluindo as suítes anteriores. CI remota não
  executada; o workflow já inclui os comandos de integração usados nesta entrega.
- REQ-WALLET-CONCURRENCY e REQ-WALLET-NONNEGATIVE continuam implemented por
  aguardarem a matriz com três processos/recuperação da T09. Atomicidade com inbox
  permanece parcial até T07. Eventos mínimos agora têm evidência de geração real.
- Hash canônico externo, resposta original de replay, HTTP, worker/TTL de referências,
  inbox e publisher continuam pendentes. Duplicata hoje retorna conflito interno;
  isso evita efeito repetido, mas não satisfaz o contrato de replay da T05.
- README original preservado. Não foram criados worktrees ou serviços externos.

## Próximo passo

T05 — idempotência e HTTP, aguardando seleção do usuário. Abrir nova branch a partir
desta entrega e detalhar o plano antes de começar.
