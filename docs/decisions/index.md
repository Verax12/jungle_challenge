# Decisões

| Registro                                     | Estado                    | Tema                                                |
| -------------------------------------------- | ------------------------- | --------------------------------------------------- |
| [0001](0001-development-harness.md)          | Aceito                    | Estrutura e ferramentas do harness                  |
| [0002](0002-backend-options.md)              | Substituído por 0003–0009 | Propostas iniciais; histórico, não opções pendentes |
| [0003](0003-backend-foundation.md)           | Aceito                    | Stack, runtime e bootstrap                          |
| [0004](0004-financial-domain.md)             | Aceito                    | Money, modelos, regras, estados e códigos           |
| [0005](0005-schema-persistence.md)           | Aceito                    | Persistência exata e invariantes SQL                |
| [0006](0006-transactional-processing.md)     | Aceito                    | Unidade transacional e concorrência por wallet      |
| [0007](0007-idempotency-http.md)             | Aceito                    | Recibo, replay, HTTP e desenho de autenticação      |
| [0008](0008-pending-references.md)           | Aceito                    | Agenda, backoff, TTL e recuperação                  |
| [0009](0009-sqs-inbox-outbox.md)             | Aceito                    | Inbox, ack, retry/DLQ e publicação                  |
| [0010](0010-reconciliation-observability.md) | Aceito                    | Reconciliação, logs, métricas e probes              |

| [0011](0011-audit-corrections.md) | Aceito | Ledger, parser HTTP e métricas FAILED |

ADRs registram o contexto da etapa em que foram aceitos; menções a funcionalidades
então futuras permanecem como histórico. A [arquitetura atual](../../ARCHITECTURE.md)
e os runbooks descrevem o funcionamento entregue. T10 consolida a documentação sem
mudar escolhas financeiras ou políticas operacionais.

Novos registros devem conter contexto, estado, decisão/proposta, consequências e
verificação. Preserve registros substituídos e indique a decisão que os substitui;
não promova sugestões históricas a requisitos do enunciado.
