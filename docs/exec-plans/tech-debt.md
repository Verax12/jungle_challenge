# Dívida técnica e pendências

As entregas T00–T10 foram auditadas novamente na T11; há correções obrigatórias
pendentes antes de aprovar main. A [auditoria final](../delivery-review.md)
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

## Pendências reproduzidas na T11

| Item                           | Impacto                          | Resolução necessária                                                                         |
| ------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------- |
| F1: OPENING retroativa         | SQL aceita saldo 10/ledger 15    | Migration corretiva, regressão aprovada, auditoria de dados existentes sem reparo silencioso |
| F2: erros do parser HTTP       | 500 para corpo excessivo/charset | Classificar entrada com 4xx, aprovar dois testes HTTP                                        |
| F3: status FAILED nas métricas | Transação persistida omitida     | Completar estados do gauge e validar scrape real                                             |

Evidências e comandos estão na [auditoria T11](../audits/T11-readme-audit.md).
A tarefa de auditoria está concluída; a implementação ainda não está aprovada para
main. Corrigir em nova etapa selecionada pelo usuário e integrar os testes adicionais
aos gates regulares. Não adiar F1/F2 como opcionais nem fechar por check verde isolado.
