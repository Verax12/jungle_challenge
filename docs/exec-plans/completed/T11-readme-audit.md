# T11 — Auditoria ponto a ponto do README

```json
{
  "id": "T11",
  "status": "completed",
  "requirements": [
    "REQ-SYSTEM",
    "REQ-SCHEMA-INVARIANTS",
    "REQ-WALLET-LEDGER",
    "REQ-FINAL-INVARIANT",
    "REQ-ELIMINATORY",
    "REQ-DELIVERY-DOCS"
  ],
  "dependsOn": ["T10"],
  "updatedAt": "2026-10-15"
}
```

## Objetivo

Revisar integralmente o enunciado contra código e evidências, repetir todas as
verificações e reportar os resultados atuais antes de qualquer envio para main.

## Requisitos atendidos

Todas as seções obrigatórias e os 78 itens do catálogo serão conferidos. Investigar
OPENING retroativa apontada pela revisão anterior e recuperação de dependências reais.

## Dependências

T10 em 9aebb41. Branch codex/t11-readme-audit, mesmo checkout, Bun 1.4.3 e contexto
colima-backend-challenge. Projeto Compose exclusivo backend-challenge-t11-20261015,
portas HTTP 13011, PostgreSQL 15441 e SQS 4566, volume novo.

## Limites

Auditoria e testes; não corrigir regras financeiras silenciosamente. Sem main, push,
PR, worktree ou dados pessoais. Preservar volume anterior, SQL Server e Colima.
Falhas reproduzidas devem aparecer no relatório e na rastreabilidade, mesmo se as
suítes anteriores passarem. Nenhuma nota/garantia de aprovação externa.

## Passos

- [x] Conferir checkout limpo e criar branch.
- [x] Conferir README, implementação e testes por seção.
- [x] Reproduzir instalação, migrations e todas as suítes existentes.
- [x] Testar lacuna de ledger e interrupção/retomada real de dependências.
- [x] Publicar relatório local ponto a ponto e roteiro para lacunas.
- [x] Atualizar estados, revisar diff, limpar recursos temporários e registrar entrega.

## Critérios de aceite

Relatório distingue implementado, testado, falhou e não executado. Cada item aponta
arquivo/teste e resultado. Falhas comprovadas têm receita reproduzível. Testes
verdes anteriores não devem esconder um contraexemplo financeiro atual.

## Comandos de validação

Executados: doctor, bun install --frozen-lockfile, check no host e Linux, build Docker
sem cache, stack:migrate duas vezes, stack:persistence, stack:messaging,
stack:distributed, stack:smoke, stack:workers e testes/audit no host/Linux.
O script tests/audit/runtime-outage.ts executou pausas/retomadas e asserções reais;
foi repetido em volume novamente vazio após reforçar contagem de eventos e replay.
Dois casos HTTP também foram conferidos diretamente na imagem de produção.
Comandos completos e resultados em [relatório](../../audits/T11-readme-audit.md)
e [registro de casos](../../audits/T11-test-results.json).

## Decisões

Três revisões independentes divididas em financeiro/schema, mensageria/observabilidade
e HTTP/stack/documentação; execução de infraestrutura centralizada para evitar
interferência. Novos testes da auditoria podem revelar falhas e não serão tratados
como aprovação por apenas reproduzirem o comportamento defeituoso.

## Resultados e limitações

- Os 414 testes existentes passaram: 49 harness, 57 aplicação/configuração, 131 domínio,
  126 persistência, 37 mensageria, 8 distribuídos e 6 smoke. Check completo passou no
  host e Linux; instalação congelada/build sem cache reproduzidos.
- Seis casos novos: dois controles SQL passaram; ledger retroativo, dois erros de
  parser HTTP e gauge FAILED falharam. Mesmos resultados no host e Linux. Total
  distinto 416 aprovados e 4 falhas em 420 casos, sem skips.
- F1: SQL aceitou OPENING 5 retroativa após WIN 10, mantendo wallet 10/version 2 e
  ledger 15, com constraints habilitadas. F2: corpo excessivo/charset não suportado
  retornaram 500/INTERNAL_ERROR, antes de invocar serviço financeiro. F3: linha FAILED
  persistida ficou ausente do gauge. Nenhum patch em src/migrations foi aplicado.
- SQS pausado: readiness 503/live 200, BET 25 confirmou sobre 100, retry persistido e
  outbox publicada após retomada. PG pausado: comando WIN 10 recebido durante pausa
  foi aplicado ao retomar; não se afirma timeout/retry PG. Mesmos quatro processos,
  replay observado por métrica, saldo 85 reconciliado, uma inbox, dois recibos, três
  lançamentos, seis IDs recebidos e DLQ vazia. API/workers ficaram saudáveis depois.
- Relatório mapeia 78 requisitos a implementação e testes, com método de revisão
  explícito. 71 permanecem verificados; sete reabertos pelos impactos de três defeitos.
  Histórico T10 preservado, mas avisos atuais impedem leitura de aprovação irrestrita.
- Primeiro roteiro do probe usava contagem literal e profundidade aproximada da fila;
  revisão independente pediu asserção de 4/6 eventos e métrica de replay. Ajustados e
  reproduzidos em banco novamente vazio; nenhum resultado foi inferido desses indícios.
- Scripts de auditoria são específicos desta rodada; regressões exigem comportamento
  correto e permanecem vermelhas. Não esconder sua falha pelo check original que
  ainda não inclui tests/audit. Integrá-las aos gates acompanha a futura correção.
- A conferência final encontrou cinco falhas na fixture documental: ela não copiava
  scripts, tsconfig, Dockerfile e Compose agora citados na matriz. A cópia desses
  arquivos foi incluída, mantendo a verificação de links; não é falha de backend.
- Banco começou com zero tabelas públicas; quatro migrations aplicadas, segundo up
  sem alterações. Fixtures e stack temporária removidas; volume anterior e SQL Server
  preservados, Colima ativo. Sem main, push, PR, pacote novo ou alteração de lockfile.
- CI remota, AWS, múltiplos hosts, TTL de 24 h de relógio real, carga e perda de disco não
  foram executados. Caminhos para validação ou limitações de escopo estão no relatório.
  Pausar PG não equivale a derrubar/recriar seu processo; essa distinção está explícita.

## Próximo passo

Auditoria concluída; apresentar relatório e aguardar seleção da etapa de correção.
Corrigir F1/F2 e a lacuna F3, integrar regressões e revalidar antes de main. Não
publicar nem iniciar outra etapa automaticamente.
