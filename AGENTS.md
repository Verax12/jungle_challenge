# Guia de trabalho

## Comece aqui

1. Leia o [índice](docs/index.md), o [enunciado](README.md) e a [arquitetura](ARCHITECTURE.md).
2. Consulte o [roadmap](docs/exec-plans/roadmap.json) e o plano ativo em `docs/exec-plans/active/`.
3. Confira `git status --short` antes de editar; preserve alterações existentes.

Se não houver plano ativo, identifique a próxima tarefa no roadmap e aguarde sua seleção.

## Regras do projeto

- O README é a fonte dos requisitos; não o reescreva durante a preparação.
- Trabalhe no checkout atual, sem worktrees, uma tarefa por vez.
- Abra sempre uma branch nova `codex/tNN-descricao` para cada etapa, partindo da entrega anterior; não reutilize a branch da etapa concluída.
- Priorize requisitos obrigatórios. Não implemente opcionais ou etapas futuras por iniciativa própria.
- Não adicione comentários ou assinaturas de autoria por IA ao código.
- Registre escolhas não prescritas pelo enunciado como propostas até a decisão da etapa.
- Não use `number`, `float` ou `double` para dinheiro; isso não proíbe contadores e versões numéricas.
- Domínio independente de NestJS, ORM e AWS; respeite as [camadas](ARCHITECTURE.md).
- Idempotência e invariantes financeiras exigem persistência e garantias no PostgreSQL.
- Não confunda lint, documentação ou mocks com evidência de concorrência e atomicidade.
- Não marque requisitos como verificados sem evidências reais.
- Não crie serviços externos, automações, commits, push ou PR como efeito implícito desta preparação.

## Comandos

- `bun run doctor`: diagnóstico do ambiente, sem instalações.
- `bun install --frozen-lockfile`: instalação reproduzível.
- `bun run check`: harness, build e testes de domínio/HTTP/configuração, sem containers.
- `bun run test:domain`: regras financeiras e modelos puros, sem banco ou broker.
- `bun run stack:up` e `bun run stack:smoke`: stack e smoke em containers reais.
- `bun run stack:workers`: iniciar consumidor, publisher e referências após migrations; veja [mensageria](docs/runbooks/messaging.md).
- `bun run test:messaging` e `bun run stack:messaging`: integração PostgreSQL/SQS em recursos descartáveis.
- `bun run stack:references`: iniciar worker de referências após migrations; veja [operação](docs/runbooks/references.md).
- `bun run stack:migrate`: aplicar migrations no banco local configurado.
- `bun run stack:persistence` ou `bun run test:persistence`: integração PostgreSQL em bancos descartáveis; veja [persistência](docs/runbooks/persistence.md).
- `bun run check:docs` e `bun run check:architecture`: verificações direcionadas.
- `bun run lint`, `bun run typecheck`, `bun run format:check`: qualidade estática.
- `bun run test:harness`: testes dos verificadores.
- `bun run format`: formatação; o README original é excluído.

Use a versão de Bun em `.bun-version`. Veja [preparação e execução](docs/runbooks/environment.md).
Para a aplicação e Docker, consulte [stack local](docs/runbooks/backend.md).
Para endpoints, replay e limites de autenticação, veja [API HTTP](docs/runbooks/http.md).

## Ciclo de entrega

1. Detalhe a tarefa conforme [PLANS](docs/PLANS.md) antes de começar.
2. Implemente apenas seu escopo e execute as verificações aplicáveis.
3. Revise o diff, os requisitos afetados e as limitações dos resultados.
4. Atualize plano, evidências e decisões junto da mudança.
5. Apresente a entrega e o próximo passo; aguarde a seleção da próxima tarefa.

Ao encontrar uma falha recorrente, acrescente uma verificação ou ajuste a orientação
responsável. Não aumente este guia com detalhes que pertencem aos documentos específicos.
