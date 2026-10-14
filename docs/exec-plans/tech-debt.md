# Dívida técnica e pendências

A base executável do backend existe a partir da T01. Requisitos financeiros não
iniciados pertencem ao roadmap, não devem ser tratados como funcionalidades prontas.

| Item                               | Situação                                              | Tratamento                                              |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Docker e Compose locais            | Preparados na T01 com Colima e Buildx                 | Usar o contexto dedicado conforme runbook da stack      |
| Garantias financeiras persistentes | Modelos locais testados; SQL e concorrência pendentes | T03 a T09, com evidências no catálogo                   |
| CI remota                          | Workflow a validar em execução remota                 | Conferir a primeira execução após publicação autorizada |

Para uma dívida nova, registre impacto, tarefa responsável, critério de resolução e
evidência. Falhas eliminatórias não podem ser adiadas como dívida para declarar entrega completa.

A imagem Community legada do LocalStack foi escolhida para operação local sem conta.
Sua limitação de atualizações está registrada no ADR 0003; revisar a escolha antes
de qualquer uso fora deste ambiente de desenvolvimento.
