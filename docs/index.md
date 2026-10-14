# Documentação do projeto

## Ponto de partida

- [Enunciado original](../README.md): fonte dos requisitos; preservado integralmente.
- [Guia de trabalho](../AGENTS.md): orientação operacional.
- [Arquitetura](../ARCHITECTURE.md): estado atual e camadas planejadas.
- [Catálogo de requisitos](requirements.json): requisitos, tarefas e evidências.
- [Qualidade e rastreabilidade](quality.md): como interpretar os estados e validar entregas.

## Planejamento

- [Formato e ciclo dos planos](PLANS.md).
- [Roadmap](exec-plans/roadmap.json): T00 é o harness; T01 a T10 são o backend.
- [Plano T00 — harness concluído e evidências](exec-plans/completed/T00-harness.md).
- [Plano T01 — base do backend e evidências](exec-plans/completed/T01-backend-foundation.md).
- [Plano T02 — domínio financeiro e evidências](exec-plans/completed/T02-financial-domain.md).
- [Plano T03 — schema, persistência e evidências](exec-plans/completed/T03-schema-persistence.md).
- [Dívida técnica](exec-plans/tech-debt.md).

## Decisões

- [Índice de decisões](decisions/index.md).
- [ADR 0001 — harness de desenvolvimento](decisions/0001-development-harness.md).
- [ADR 0002 — escolhas pendentes do backend](decisions/0002-backend-options.md).
- [ADR 0003 — ambiente e bootstrap](decisions/0003-backend-foundation.md).
- [ADR 0004 — domínio financeiro](decisions/0004-financial-domain.md).
- [ADR 0005 — schema e persistência](decisions/0005-schema-persistence.md).

## Operação

- [Ambiente e comandos](runbooks/environment.md).
- [Execução da stack local](runbooks/backend.md).
- [Migrations e testes de persistência](runbooks/persistence.md).
- [Diagnóstico de verificações](runbooks/troubleshooting.md).

## Referências

- [Harness Engineering — OpenAI](https://openai.com/index/harness-engineering/): contexto versionado e feedback executável.
- [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md): instruções no repositório.
- [Planos de execução](https://developers.openai.com/cookbook/articles/codex_exec_plans): retomada e evidências.

As referências orientam o processo. Requisitos do produto continuam definidos pelo
enunciado, e as restrições desta entrega prevalecem sobre exemplos das referências.

Estado atual: T00 a T03 concluídas; não há plano ativo. Próxima tarefa: T04,
processamento transacional e concorrência, aguardando seleção do usuário e nova branch.
Modelos financeiros e schema persistente implementados; caso de uso, endpoints e
workers financeiros ainda pendentes.
