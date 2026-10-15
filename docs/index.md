# Documentação do projeto

## Ponto de partida

- [Apresentação e execução](../README.md): documentação da implementação.
- [Enunciado arquivado](challenge.md): fonte histórica dos requisitos; preservado integralmente.
- [Guia de trabalho](../AGENTS.md): orientação operacional.
- [Arquitetura](../ARCHITECTURE.md): camadas, funcionamento atual, decisões e limites.
- [Catálogo de requisitos](requirements.json): requisitos, tarefas e evidências.
- [Qualidade e rastreabilidade](quality.md): como interpretar os estados e validar entregas.
- [Matriz de testes obrigatórios](test-matrix.md): cenários do enunciado e evidências executáveis.
- [Auditoria histórica T11 — ponto a ponto e achados](audits/T11-readme-audit.md).
- [Resultados históricos dos 420 testes T11](audits/T11-test-results.json).
- [Correções e revalidação T12](audits/T12-corrections.md).
- [Resultados históricos dos 440 testes T12](audits/T12-test-results.json).
- [Validação integral e publicação T13](audits/T13-release-validation.md).
- [Resultados atuais dos 477 testes T13](audits/T13-test-results.json).
- [Auditoria da entrega](delivery-review.md): conferência do enunciado e critérios eliminatórios.
- [Setup no README](../README.md#executar-o-projeto): instalação e comandos da implementação.

## Planejamento

- [Formato e ciclo dos planos](PLANS.md).
- [Roadmap](exec-plans/roadmap.json): T00 é o harness; T01 a T10 são o backend.
- [Plano T00 — harness concluído e evidências](exec-plans/completed/T00-harness.md).
- [Plano T01 — base do backend e evidências](exec-plans/completed/T01-backend-foundation.md).
- [Plano T02 — domínio financeiro e evidências](exec-plans/completed/T02-financial-domain.md).
- [Plano T03 — schema, persistência e evidências](exec-plans/completed/T03-schema-persistence.md).
- [Plano T04 — processamento transacional](exec-plans/completed/T04-transactional-processing.md).
- [Plano T05 — idempotência e HTTP](exec-plans/completed/T05-idempotency-http.md).
- [Plano T06 — referências fora de ordem](exec-plans/completed/T06-pending-references.md).
- [Plano T07 — SQS, inbox e outbox](exec-plans/completed/T07-sqs-inbox-outbox.md).
- [Plano T08 — reconciliação e observabilidade](exec-plans/completed/T08-reconciliation-observability.md).
- [Plano T09 — testes distribuídos e evidências](exec-plans/completed/T09-distributed-recovery.md).
- [Plano T10 — documentação final e conferência](exec-plans/completed/T10-delivery-review.md).
- [Plano T11 — auditoria ponto a ponto](exec-plans/completed/T11-readme-audit.md).
- [Plano T12 — correções da auditoria](exec-plans/completed/T12-audit-fixes.md).
- [Plano T13 — validação e publicação](exec-plans/completed/T13-release-validation.md).
- [Plano T14 — README do projeto](exec-plans/completed/T14-project-readme.md).
- [Dívida técnica](exec-plans/tech-debt.md).

## Decisões

- [Índice de decisões](decisions/index.md).
- [ADR 0001 — harness de desenvolvimento](decisions/0001-development-harness.md).
- [ADR 0002 — propostas iniciais substituídas](decisions/0002-backend-options.md).
- [ADR 0003 — ambiente e bootstrap](decisions/0003-backend-foundation.md).
- [ADR 0004 — domínio financeiro](decisions/0004-financial-domain.md).
- [ADR 0005 — schema e persistência](decisions/0005-schema-persistence.md).

- [ADR 0006 — processamento transacional](decisions/0006-transactional-processing.md).

- [ADR 0007 — idempotência e HTTP](decisions/0007-idempotency-http.md).
- [ADR 0008 — referências fora de ordem](decisions/0008-pending-references.md).
- [ADR 0010 — reconciliação e observabilidade](decisions/0010-reconciliation-observability.md).
- [ADR 0009 — SQS, inbox e outbox](decisions/0009-sqs-inbox-outbox.md).

- [ADR 0011 — correções da auditoria](decisions/0011-audit-corrections.md).

## Operação

- [Ambiente e comandos](runbooks/environment.md).
- [Execução da stack local](runbooks/backend.md).
- [Migrations e testes de persistência](runbooks/persistence.md).
- [API HTTP e replay](runbooks/http.md).
- [Worker de referências](runbooks/references.md).
- [Consumidor SQS e publisher](runbooks/messaging.md).
- [Reconciliação, health e métricas](runbooks/observability.md).
- [Testes distribuídos e recuperação](runbooks/distributed.md).
- [Fluxos de produção e recuperação](runbooks/production-validation.md).
- [Reprodução limpa da entrega](runbooks/delivery.md).
- [Diagnóstico de verificações](runbooks/troubleshooting.md).

## Referências

- [Harness Engineering — OpenAI](https://openai.com/index/harness-engineering/): contexto versionado e feedback executável.
- [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md): instruções no repositório.
- [Planos de execução](https://developers.openai.com/cookbook/articles/codex_exec_plans): retomada e evidências.

As referências orientam o processo. Requisitos do produto continuam definidos pelo
enunciado, e as restrições desta entrega prevalecem sobre exemplos das referências.

Estado atual: T13 validou os 78 requisitos no escopo local e aprovou 477 testes
mais quatro probes de recuperação. Corrigiu identidade Unicode malformada e manteve
as regressões de ledger, parser e métricas da T12. Main publicada e CI remota
aprovada; consultar o relatório T13 e o link da execução. T14 separou o README da fonte histórica dos requisitos,
com regressões do harness atualizadas e check aprovado. Não há plano ativo;
aguardar seleção explícita de uma nova tarefa.

Para banco existente, siga o procedimento de upgrade da quinta migration no runbook
de persistência. Resultados T10/T11/T12 são históricos; AWS não foi homologada.
