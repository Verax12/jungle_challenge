# T12 — Correções da auditoria

```json
{
  "id": "T12",
  "status": "completed",
  "requirements": [
    "REQ-SYSTEM",
    "REQ-SCHEMA-INVARIANTS",
    "REQ-WALLET-LEDGER",
    "REQ-FINAL-INVARIANT",
    "REQ-HTTP-STATUS",
    "REQ-METRICS",
    "REQ-ELIMINATORY"
  ],
  "dependsOn": ["T11"],
  "updatedAt": "2026-10-15"
}
```

## Objetivo

Corrigir F1, F2 e F3 da [auditoria T11](../../audits/T11-readme-audit.md), incorporar regressões aos gates e repetir a validação da entrega.

## Requisitos atendidos

Invariantes no schema e reconciliação, respostas HTTP coerentes e métricas por estado. Os sete requisitos reabertos foram revalidados com testes reais e retornaram a verified.

## Dependências

T11 concluída em 1d9d63a. Branch codex/t12-audit-fixes, mesmo checkout. Bun 1.4.3 e contexto Docker colima-backend-challenge. Stack exclusiva backend-challenge-t12-20261015, HTTP 13012, PostgreSQL 15442 e SQS 4566.

## Limites

Corrigir apenas os três defeitos autorizados. Preservar o enunciado original, evidências históricas, volume anterior e SQL Server. Sem worktrees, push, PR ou merge. Nenhuma reparação automática de dados financeiros inconsistentes.

## Passos

- [x] Criar branch e registrar plano.
- [x] Implementar migration incremental, proteção de sucessor e preflight de dados existentes.
- [x] Corrigir parser HTTP e métricas por estado.
- [x] Mover regressões para suítes regulares e ampliar cenários críticos.
- [x] Executar checks e integrações completas, revisar diff e atualizar evidências.
- [x] Limpar recursos exclusivos e registrar entrega em commit.

## Critérios de aceite

As quatro regressões vermelhas passam. Migration aceita histórico válido e recusa histórico inconsistente sem alterá-lo. Downgrade/reaplicação e preservação de dados são testados. Parser retorna 413/415, mantém erros internos como 500 e não expõe detalhes. FAILED aparece em métricas. Gates completos passam em infraestrutura real.

## Comandos de validação

Executados: bun run check no host e Linux; test:persistence, test:messaging e
test:distributed no host; stack:migrate repetido; stack:persistence, stack:messaging,
stack:distributed e stack:smoke em Linux; stack:workers e chamadas HTTP reais na
imagem de produção. Resultados e comandos no [relatório T12](../../audits/T12-corrections.md)
e [registro nominal](../../audits/T12-test-results.json).

## Decisões

[ADR 0011](../../decisions/0011-audit-corrections.md): migration incremental com
preflight e trigger de sucessor diferido, preservando locks e validações antigas.
Não reescrever histórico financeiro. HTTP classifica somente erros conhecidos com
status coerentes; métricas usam enum do domínio. T11 preservada como fotografia
histórica; regressões passam nos gates existentes sem alterar o workflow.

## Resultados e limitações

- 440 casos distintos aprovados, zero falhas/skips: 49 harness, 74 app, 131 domínio,
  134 persistência, 38 mensageria, 8 distribuídos e 6 smoke. Repetições não somadas.
- As quatro regressões originalmente vermelhas passaram. Vinte casos novos ampliam
  upgrade/downgrade, falha segura, corrida, parser e contadores.
- Upgrade de histórico consistente preserva snapshots de todos os dados financeiros;
  histórico inconsistente bloqueia a quinta migration e permanece intocado. Down/up
  preserva dados, lote invertido válido passa e corrida rejeita OPENING indevida.
- Revisão independente da migration não encontrou defeitos. A sugestão de comprovar
  lock automático foi incorporada retirando FOR UPDATE explícito do teste, que
  passou no host e Linux. Nenhum reparo de dados existentes foi executado.
- Primeira execução dirigida no host não iniciou os cenários porque faltava
  DB_PASSWORD; configurada a senha pública local, todos passaram. Não houve pacote
  novo, mudança de lockfile ou flexibilização de expectativa para esconder falhas.
- API de produção confirmou 413/415/415/400, ready/live 200 e FAILED=0. Os três
  workers responderam ready/metrics 200 com FAILED=0. Gauge FAILED=1 foi conferido
  com transação persistida em banco descartável. Banco de negócio permaneceu vazio.
- Cinco migrations aplicadas; segundo up sem reaplicação. Nenhum banco temporário
  restante; stack T12 removida com seu volume, mantendo volume anterior, SQL Server
  e Colima. Enunciado comparado byte a byte com c7143e6; hash original preservado.
- AWS, CI remota, múltiplos hosts, TTL real de 24 h, carga e perda de disco não
  executados. Probes específicos pause/unpause da T11 não repetidos; suites
  distribuídas de crash/restart repetidas. Sem push, PR, merge ou worktree.

## Próximo passo

Apresentar correções e resultados; aguardar seleção antes de publicação ou outra
etapa. Para banco existente, aplicar o procedimento de manutenção do runbook.
