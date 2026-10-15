# ADR 0011 — Correções da auditoria

## Estado

Aceito na T12, em 2026-10-15.

## Contexto

A [auditoria T11](../audits/T11-readme-audit.md) reproduziu três defeitos: OPENING retroativa inconsistente aceita pelo schema, erros de parser classificados como 500 e métricas que omitiam FAILED. As regressões devem integrar os gates existentes.

## Decisão

Acrescentar Migration202610150001, preservando as quatro migrations históricas. Antes de instalar a proteção, bloquear escritas nas tabelas de wallet/transação/ledger e conferir cadeia, soma assinada, head e versão. Qualquer divergência aborta a migration inteira com SQLSTATE 23514 e o identificador da wallet; nenhum reparo financeiro automático.

O novo constraint trigger diferido valida o sucessor imediato. O trigger anterior continua validando predecessor e head; o BEFORE INSERT já serializa pela wallet. A consulta utiliza o índice por wallet/versão e não recalcula o histórico inteiro a cada operação. O diferimento preserva lotes consistentes inseridos fora da ordem de versão na mesma transação. Down remove somente o trigger/função novos e preserva dados, mas volta a expor a falha anterior.

No HTTP, aceitar apenas Error com tipos conhecidos do parser e status/statusCode correspondentes: entity.too.large (413), charset.unsupported/encoding.unsupported (415), entity.parse.failed (400). Responder códigos públicos sem mensagem, stack ou corpo recebido. Outros erros mantêm o tratamento anterior; status arbitrário não transforma falha interna em erro de entrada.

Operations e Telemetry derivam seus estados de WagerTransactionStatus. FAILED passa a aparecer em gauges e contadores, inclusive zero. Isso não altera as transições financeiras nem cria FAILED durante indisponibilidade.

## Consequências

O upgrade exige janela de manutenção, parando API e workers. A auditoria inicial percorre o histórico e bloqueia escritas enquanto dura; planejar tempo conforme volume. Em caso de divergência, preservar banco e logs, investigar antes de nova tentativa. Não desabilitar triggers para forçar aprovação. Uma reversão de schema não é reversão financeira.

Testes de parser entram em tests/app, ledger em tests/persistence e gauge em tests/messaging. Os jobs existentes da CI já executam essas pastas. O registro T11 permanece histórico e não será reescrito como se tivesse passado.

## Verificação

Regressões reais de PostgreSQL e HTTP, upgrade de histórico válido/inválido, snapshots preservados, down/up, lote em ordem inversa, disputa entre crédito válido e OPENING retroativa, scrape de FAILED e contadores. Resultados da execução no [plano T12](../exec-plans/completed/T12-audit-fixes.md).
