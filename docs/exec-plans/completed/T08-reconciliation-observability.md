# T08 — Reconciliação e observabilidade

```json
{
  "id": "T08",
  "status": "completed",
  "requirements": [
    "REQ-RECONCILIATION",
    "REQ-RECONCILIATION-DIVERGENCE",
    "REQ-HEALTH",
    "REQ-LOGS",
    "REQ-METRICS"
  ],
  "dependsOn": ["T07"],
  "updatedAt": "2026-10-14"
}
```

## Objetivo

Expor reconciliação exata, logs estruturados, métricas operacionais e readiness real.

## Requisitos atendidos

Seções 9 e 12: reconciliação sem correção, divergências sinalizadas, logs sem payloads, métricas mínimas e health público.

## Dependências

T07 em bdf5ac3. Branch codex/t08-reconciliation-observability, Bun fixado, PostgreSQL e LocalStack locais.

## Limites

Sem dashboard/OTel, autenticação, novas regras financeiras ou matriz distribuída T09. Sem worktrees ou push. README intacto.

## Passos

- [x] Revisar enunciado e abrir branch.
- [x] Implementar reconciliação com snapshot único e resposta exata.
- [x] Instrumentar HTTP, SQS, referências e publicação.
- [x] Expor métricas e readiness com dependências reais e limites de espera.
- [x] Validar consistência, divergência, falhas, correlação e métricas.
- [x] Atualizar evidências, revisar diff e fazer commit.

## Critérios de aceite

Reconciliação compara saldo à soma assinada do ledger no mesmo snapshot, inclui diferença e contagem, sem escrever dados. Divergência gera log/métrica. Health aberto diferencia processo e dependências. Métricas cobrem status, duplicatas, retries, DLQ, locks, lag e latência, sem IDs como labels. Testes reais validam incrementos e indisponibilidade.

## Comandos de validação

Executados: bun run check no host e Linux; test:persistence e test:messaging no host;
stack:messaging, stack:smoke, stack:up/migrate/workers; test:persistence na imagem
Linux. Probes HTTP em consumer/publisher/reference-worker, typecheck/lint/formato,
check:docs/check:architecture, git diff --check e SHA-256 do README.

## Decisões

Diferença = saldo armazenado menos calculado. SQL NUMERIC e Money mantêm precisão. Snapshot por consulta única; sem locks de wallet para leitura. Contadores locais por processo; gauges de estado persistido coletadas sob demanda. Cliente Prometheus oficial fixado; sem exportação externa. Detalhes no [ADR 0010](../../decisions/0010-reconciliation-observability.md).

## Resultados e limitações

- Reconciliação HTTP implementada com snapshot único, precisão monetária exata,
  diferença assinada e contagem. Casos de zero/ledger vazio, 36 dígitos, wallet
  inexistente e diferenças de um centavo positivos/negativos passaram. Uma transação
  aberta e não confirmada não provocou falsa divergência; após commit, resposta
  passou a observar integralmente o novo saldo e ledger. Leitura não bloqueou wallet.
- Divergência induzida somente em banco descartável gerou resposta, log de erro e
  incremento da métrica. Consulta posterior confirmou que o endpoint não reparou
  o saldo. Teste restaurou o valor antes de conferir invariantes e remover o banco.
- Logs JSON e X-Correlation-Id instrumentam API/SQS/referências/publicação. Campos
  permitidos evitam dinheiro, corpo, playerId, chave/hash, SQL e mensagens brutas.
  Métricas têm labels finitos; testes capturaram contexto e ausência de payloads.
- Gauges SQL medem status atual, quantidade de outbox e lag; SQS fornece profundidade
  aproximada da DLQ. Contadores/histogramas cobrem resultados, replay, retries, DLQ,
  divergências, latência e conflitos de lock. Timeout 55P03 foi induzido mantendo
  lock em outra conexão PostgreSQL; incremento e ausência de SQL nos logs conferidos.
- Readiness público testa PostgreSQL e SQS; liveness permanece independente.
  Conexões recusadas e sockets que aceitam sem responder retornaram indisponível
  dentro dos limites testados. Falha de métricas retornou 503 sem zeros artificiais.
  Probes saudáveis e os listeners de todos os workers responderam 200 na produção local.
- 401 testes validados: 45 harness, 56 aplicação, 131 domínio, 126 persistência,
  37 mensageria e 6 smoke. A T08 acrescenta 3 testes de aplicação, 10 de integração
  operacional e 1 smoke. Aplicação/domínio: 187 testes/603 asserções; persistência:
  126/877; mensageria: 37/246; smoke: 6/22. Check completo, persistência e mensageria
  passaram no host macOS e Linux; smoke e probes passaram na imagem de produção.
- Instalação congelada das imagens passou. A primeira reconstrução precisou baixar
  dependências e demorou; não foi necessário alterar registry ou enfraquecer lockfile.
  Adicionado @prometheus-io/client 0.16.1 e três dependências transitivas. Sem migration
  nova, serviço remoto, dashboard ou tracing. Bun permanece 1.4.3.
- Testes encontraram normalização necessária para NUMERIC retornado sem escala;
  corrigida na projeção SQL, sem converter dinheiro para number. A inspeção do SDK
  encontrou requestTimeout apenas avisando por padrão; throwOnRequestTimeout=true
  agora interrompe probes e preserva o limite previsto no cliente SQS T07.
- Validação inicial sem permissão de sockets falhou em listen; a execução autorizada
  passou. Ajustes de tipagem, import e formatação foram corrigidos, sem relaxar gates.
  A tentativa inicial de adiantar agenda via SQL foi recusada pelo guard; teste usa
  espera real, preservando as proteções. README intacto e recursos descartáveis removidos.
- Contadores operacionais podem perder a observação se o processo morrer logo após
  commit; reiniciam com o processo e não substituem auditoria persistida. Gauges
  globais repetidos não devem ser somados. Scrapes fazem agregações sujeitas a timeout.
  Readiness não valida migrations nem ausência de backlog. Sem garantias futuras de T09.
- CI agora sobe workers e consulta endpoints operacionais; execução remota continua
  dependente de publicação autorizada. Sem worktrees, push ou coautor. Containers da
  validação são encerrados preservando volumes e Colima.

## Próximo passo

T09 — Testes distribuídos e recuperação, aguardando seleção em nova branch a partir desta entrega.
