# Dívida técnica e pendências

O roadmap obrigatório T00–T10 está concluído. A [auditoria final](../delivery-review.md)
registra evidências locais e limites, sem atribuir resultados a ambientes não executados.

| Item                           | Situação                                                             | Tratamento                                              |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Docker e Compose locais        | Preparados na T01 com Colima e Buildx                                | Usar o contexto dedicado conforme runbook da stack      |
| Conferência final do enunciado | Concluída na T10: auditoria, instalação limpa e 414 testes aprovados | Manter evidências atualizadas quando o código mudar     |
| CI remota                      | Workflow a validar em execução remota                                | Conferir a primeira execução após publicação autorizada |

Para uma dívida nova, registre impacto, tarefa responsável, critério de resolução e
evidência. Falhas eliminatórias não podem ser adiadas como dívida para declarar entrega completa.

A imagem Community legada do LocalStack foi escolhida para operação local sem conta.
Sua limitação de atualizações está registrada no ADR 0003; revisar a escolha antes
de qualquer uso fora deste ambiente de desenvolvimento.
