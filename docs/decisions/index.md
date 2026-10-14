# Decisões

| Registro                            | Estado   | Tema                                           |
| ----------------------------------- | -------- | ---------------------------------------------- |
| [0001](0001-development-harness.md) | Aceito   | Estrutura, ferramentas e limites do harness    |
| [0002](0002-backend-options.md)     | Proposto | Escolhas técnicas ainda pendentes do backend   |
| [0003](0003-backend-foundation.md)  | Aceito   | Ambiente e bootstrap do backend                |
| [0004](0004-financial-domain.md)    | Aceito   | Modelo financeiro puro                         |
| [0005](0005-schema-persistence.md)  | Aceito   | Persistência exata e invariantes no PostgreSQL |

- [0006 — processamento transacional](0006-transactional-processing.md): aceito.

- [0007 — idempotência e HTTP](0007-idempotency-http.md): aceito.

Novos registros devem conter contexto, estado, decisão ou proposta, consequências
e verificação. Mantenha decisões aceitas separadas das sugestões. Ao substituir uma
decisão, preserve o registro antigo e indique o novo documento.
