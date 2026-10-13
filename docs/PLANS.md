# Planos de execução

## Uma tarefa por vez

O [roadmap](exec-plans/roadmap.json) contém escopo, dependências, aceite e verificação
prevista de cada etapa. O [catálogo](requirements.json) associa requisitos a tarefas.
Uma etapa precisa de plano detalhado antes de começar; etapas futuras não precisam
de implementações ou comandos fictícios para parecerem prontas.

Estados do roadmap: `planned`, `active`, `blocked`, `completed`. Somente uma tarefa
pode estar `active`. Dependências de tarefas `active` ou `completed` devem estar
`completed`. `blocked` exige explicar a condição e como retomar no plano.

Planos em andamento ou bloqueados ficam em `docs/exec-plans/active/`. Ao concluir,
mova o plano para `completed/`, atualize o roadmap e o link no índice. As pastas
passam a existir quando contêm o primeiro plano; não são necessários placeholders.

## Formato verificável

Cada plano deve conter um título e um bloco JSON de metadados. Exemplo estrutural:

```json
{
  "id": "T01",
  "status": "planned",
  "requirements": ["REQ-STACK"],
  "dependsOn": ["T00"],
  "updatedAt": "2026-10-13"
}
```

Os IDs de requisitos devem existir no catálogo; o ID, status e dependências devem
corresponder ao roadmap. A data usa `YYYY-MM-DD`. Inclua estas seções, com conteúdo:

- `## Objetivo`
- `## Requisitos atendidos`
- `## Dependências`
- `## Limites`
- `## Passos`
- `## Critérios de aceite`
- `## Comandos de validação`
- `## Decisões`
- `## Resultados e limitações`
- `## Próximo passo`

Passos e critérios de aceite devem permitir acompanhar progresso. Registre comandos
realmente executados, resultados, falhas e pendências. Não registre uma execução
planejada como evidência. Mantenha decisões materiais em ADRs e referencie-as no plano.

## Critério de conclusão

Uma tarefa só fica `completed` quando seu escopo e aceite foram atendidos, as
verificações aplicáveis passaram, o diff foi revisado e as limitações estão descritas.
Checks do harness não substituem testes do backend. Após apresentar a entrega,
aguarde a escolha da próxima etapa; não inicie o roadmap inteiro automaticamente.
