# Dívida técnica e pendências

As entregas T00–T10 foram auditadas novamente na T11. A [T12](../audits/T12-corrections.md)
corrigiu os três achados e integrou regressões aos gates. Não há achado F1/F2/F3
pendente; CI remota e homologação externa continuam sem execução.

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

## Achados T11 resolvidos na T12

| Item                           | Resolução e evidência                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| F1: OPENING retroativa         | Migration incremental com auditoria de histórico, sucessor e regressões PostgreSQL aprovadas |
| F2: erros do parser HTTP       | 413/415/400 com respostas seguras; testes reais e imagem de produção aprovados               |
| F3: status FAILED nas métricas | Estados derivados do domínio; scrape persistido e contadores/replay aprovados                |

Detalhes, 440 testes e limites na [revalidação T12](../audits/T12-corrections.md).
Histórico T11 preservado. Atualizar um banco existente exige parar escritores e
seguir o [procedimento de upgrade](../runbooks/persistence.md#atualizar-um-banco-existente-para-t12).
