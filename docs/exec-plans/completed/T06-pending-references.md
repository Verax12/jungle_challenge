# T06 — Referências fora de ordem

```json
{
  "id": "T06",
  "status": "completed",
  "requirements": [
    "REQ-REFERENCE-SCOPE",
    "REQ-REFERENCE-PENDING",
    "REQ-REFERENCE-RETRY",
    "REQ-REFERENCE-EXPIRY"
  ],
  "dependsOn": ["T05"],
  "updatedAt": "2026-10-14"
}
```

## Objetivo

Resolver referências ausentes por worker agendado, com espera limitada e efeitos atômicos.

## Requisitos atendidos

Escopo da referência, retomada, backoff persistido e rejeição após expiração. Publicação efetiva dos eventos depende da T07; nesta etapa os eventos são gravados na outbox.

## Dependências

T05 em 043528c, Bun 1.4.3 e PostgreSQL 17. Branch codex/t06-pending-references.

## Limites

Sem consumidor SQS, publisher, reconciliação ou autenticação. Recibos originais não são reescritos. Sem worktrees ou push.

## Passos

- [x] Revisar estado e criar branch da etapa.
- [x] Persistir agenda e contexto junto da pendência, com migration para pendências existentes.
- [x] Compartilhar regras financeiras entre submissão e retomada.
- [x] Implementar claim concorrente por wallet, backoff e expiração.
- [x] Disponibilizar worker executável com encerramento seguro.
- [x] Testar resolução, escopo, corrida, rollback, expiração e reinício em PostgreSQL real.
- [x] Atualizar documentação, revisar e fazer commit.

## Critérios de aceite

Pendência confirmada tem agenda recuperável. REFUND/ROLLBACK antecipados são aplicados uma vez. Workers concorrentes não duplicam efeitos e wallets ocupadas não bloqueiam outras. Falhas de infraestrutura revertem a tentativa inteira. Expiração gera REJECTED/REFERENCE_NOT_FOUND e evento na outbox; saldo e recibo permanecem íntegros. Backoff e contexto sobrevivem ao reinício.

## Comandos de validação

Executados: bun install --frozen-lockfile; bun run check no host e em Linux;
bun run test:persistence; bun run stack:persistence; bun run stack:up;
bun run stack:migrate; bun run stack:smoke; bun run stack:references;
worker --once na imagem de produção; git diff --check.
Teste adicional dirigido de atomicidade inicial executado no host e em Linux.

## Decisões

Política: TTL de 24 horas desde o recebimento, atraso inicial de 1 segundo, exponencial com teto de 60 segundos, polling de 500 ms. No limite, a expiração prevalece sobre referência chegada tardiamente. Falhas de infraestrutura não consomem tentativas de negócio. Claim bloqueia wallet antes da tarefa, usando SKIP LOCKED. Detalhes e justificativas estão no [ADR 0008](../../decisions/0008-pending-references.md).

## Resultados e limitações

- Agenda reference_jobs, contexto e prazo são persistidos junto da pendência. Migration
  0004 preserva dados anteriores e preenche pendências existentes sem renovar TTL.
- FinancialProcessing compartilha regras entre submissão e retomada. Claim por wallet
  com SKIP LOCKED, releitura e atualização atômica de saldo, ledger, transação, agenda
  e eventos. Recibos originais são preservados; GET reflete o estado atualizado.
- Worker separado, sem dependências novas, com polling, lote limitado, logs sem
  payload e encerramento seguro. Compose possui perfil workers e comandos documentados.
  CI passa a executar também a rodada única da imagem de produção; execução remota
  continua dependente de publicação autorizada.
- 357 testes validados: 45 harness, 50 aplicação, 131 domínio, 126 persistência e
  5 smoke. A suíte completa de persistência passou com 125 testes/868 asserções;
  após revisão, um cenário adicional de atomicidade inicial passou isoladamente,
  com 9 asserções, no host e em Linux. A T06 acrescentou 24 testes PostgreSQL e 3 de aplicação.
- Testes reais cobriram referência atrasada para REFUND/ROLLBACK/WIN, escopo, tipos,
  estados, valores, reversão duplicada, insuficiência de saldo, expiração, backoff,
  preservação do replay e contexto, rollback após flush e migração com dados existentes.
  Cada cenário novo confere saldo contra soma do ledger ao encerrar.
- Duas conexões ativas demonstraram exclusão na mesma wallet e progresso em outra
  enquanto a primeira mantém o claim aberto. SIGTERM foi enviado ao processo agendado;
  outro processo retomou a agenda. SIGKILL após flush e antes do commit reverteu efeitos
  e liberou locks; a próxima execução aplicou a pendência uma vez.
- bun run check passou no macOS e em Linux; instalação congelada sem mudanças.
  PostgreSQL 17, Bun 1.4.3. Smoke passou na imagem de produção, worker contínuo iniciou
  via Compose e worker --once encerrou com código zero. Quatro migrations aplicadas
  no banco local, sem bancos descartáveis remanescentes ao conferir.
- Durante desenvolvimento, corrigidas tipagens de enum/estado e expectativas SQL dos
  testes. Uma execução de restart coincidiu com outro build removendo dist; a execução
  sequencial passou. A orientação de não reconstruir dist durante testes de subprocesso
  foi registrada no runbook e em quality.md. Nenhum teste foi desabilitado.
- O encerramento operacional revelou que Compose down sem perfil deixava o worker
  ativo. stack:down foi ajustado para incluir workers e verificado encerrando o
  processo e removendo a rede, com volumes preservados.
- REQ-REFERENCE-SCOPE/PENDING/RETRY verificados. REQ-REFERENCE-EXPIRY permanece
  implemented: rejeição e gravação atômica do evento estão verificadas, publicação
  efetiva permanece na T07. Não se apresenta outbox gravada como publicação concluída.
- Referência encontrada em estado não PROCESSED continua rejeitável conforme ADR 0004;
  não há resolução topológica de cadeias. Sob contenção/indisponibilidade, TTL é observado
  na próxima execução possível. Relógios dos hosts precisam estar sincronizados.
- Sem consumidor, inbox ativa, publisher, reconciliação ou três instâncias completas.
  README preservado; sem worktree, push ou coautoria.

## Próximo passo

T07 — SQS, inbox e outbox, aguardando seleção do usuário. Abrir nova branch a
partir desta entrega e detalhar consumidor, publicação, retries, DLQ e shutdown.
