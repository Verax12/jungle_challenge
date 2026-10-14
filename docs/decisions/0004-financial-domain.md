# ADR 0004 — Modelo financeiro puro

## Estado

Aceito em 2026-10-14 para T02. SQL, locks, HTTP e políticas operacionais permanecem
fora desta decisão.

## Contexto

O enunciado exige precisão, encapsulamento, reidratação, ledger imutável e estados
explícitos. A escala fixa permite aritmética nativa sem dependências no domínio.

## Decisão

- Money guarda centavos em `bigint`. Entrada exige string com exatamente duas casas,
  sem espaços, sinal positivo, expoente ou zeros excedentes à esquerda. Não há
  arredondamento: precisão excedente falha. `from` rejeita negativos; `rehydrate`
  permite negativos internos, usados também em subtração/negação. Saída sempre tem
  duas casas. BRL, USD e EUR são o conjunto explícito suportado; expandi-lo exige
  decisão, especialmente para moedas cuja unidade fracionária não tem escala 2.
- BET, WIN, REFUND e ROLLBACK exigem valor positivo. LOSS exige zero; abertura
  permite zero. WIN de valor zero deve ser representado por LOSS. Essa interpretação
  evita ledger sem movimento e mantém a versão vinculada à mudança de saldo.
- Wallet.open retorna wallet e, para saldo positivo, transação OPENING já aplicada
  e ledger CREDIT. IDs e hash da abertura vêm do chamador. A versão inicial é 1.
  Wallet.apply retorna o ledger, ou nenhum para LOSS, e marca a transação aplicada.
  Não persiste nem publica; o caso de uso futuro deverá gravar o conjunto atomicamente.
- OPENING tem factory interna própria; create aceita somente tipos externos. As
  referências de WIN, quando presentes, devem ser BET processada no mesmo escopo.
  BET/LOSS não aceitam referência. WIN sem referência é permitido.
- REFUND/ROLLBACK exigem referência processada, mesmo provider/player/wallet/moeda/
  rodada e ID externo solicitado; reversões exigem valor integral. REFUND aceita
  BET; ROLLBACK aceita BET/WIN/REFUND. O histórico informa se aquela referência já
  foi revertida pelo mesmo tipo. Conforme a regra explícita do README, REFUND e
  ROLLBACK distintos podem reverter uma mesma BET uma vez cada. A consulta e a
  constraint concorrente que sustentam esse histórico pertencem a T03/T04.
- Ausência da referência gera erro de domínio específico; o coordenador futuro
  marcará PENDING_REFERENCE. Referência encontrada porém não PROCESSED é rejeitável.
  Nenhuma decisão de TTL, número de tentativas ou worker é antecipada.
- Falhas de validação não alteram wallet, transação ou versão. A aplicação decidirá
  persistir a rejeição. Transições terminais são erros de programação.
- Instantes são strings ISO UTC canônicas, fornecidas explicitamente pelo chamador,
  evitando relógio global e objetos Date mutáveis no estado. Factories validam
  entradas; rehydrate copia estado persistido confiável sem repetir transições.
- Eventos são subclasses concretas de IntegrationEvent, com tipo e versão fixos,
  payload JSON copiado e congelado recursivamente. Factories conferem o estado
  necessário; construir evento não significa publicá-lo. IDs vêm do chamador.
- Inbox processada e outbox publicada não aceitam novas transições. Outbox contabiliza
  falhas de publicação e recebe base/teto de backoff exponencial como parâmetros;
  a política operacional será escolhida na T07. Nenhuma deduplicação em memória
  é usada como garantia persistente.

## Transições

| Estado atual                | Destinos permitidos                                                   |
| --------------------------- | --------------------------------------------------------------------- |
| PENDING                     | PENDING_REFERENCE (quando há referência), PROCESSED, REJECTED, FAILED |
| PENDING_REFERENCE           | PENDING_REFERENCE, PROCESSED, REJECTED, FAILED                        |
| PROCESSED, REJECTED, FAILED | Nenhum                                                                |

Repetir PENDING_REFERENCE é permitido sem efeito financeiro. markProcessed exige
ID interno quando há referência externa. reject aceita código de negócio; fail
aceita somente INFRASTRUCTURE_PERMANENT. Reidratação não executa essa matriz.

## Códigos de falha

| Código                                                                     | Significado / orientação futura ao chamador                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| INVALID_MONEY, UNSUPPORTED_CURRENCY, INVALID_INPUT                         | Corrigir contrato/formato/identificação.                                          |
| CURRENCY_MISMATCH, WALLET_MISMATCH                                         | Corrigir moeda ou escopo da operação.                                             |
| INSUFFICIENT_FUNDS                                                         | BET sem saldo; rejeição terminal.                                                 |
| REVERSAL_INSUFFICIENT_FUNDS                                                | Reversão retiraria mais que o saldo disponível.                                   |
| REFERENCE_REQUIRED, REFERENCE_NOT_ALLOWED                                  | Corrigir presença da referência.                                                  |
| REFERENCE_NOT_FOUND                                                        | Referência ausente; aguardar resolução, ou rejeitar ao expirar a política futura. |
| REFERENCE_NOT_PROCESSED, REFERENCE_SCOPE_MISMATCH, REFERENCE_KIND_MISMATCH | Referência existente incompatível.                                                |
| REFERENCE_AMOUNT_MISMATCH, REFERENCE_ALREADY_REVERSED                      | Reversão parcial ou repetida do mesmo tipo.                                       |
| IDEMPOTENCY_CONFLICT                                                       | Hash diverge para a identidade consultada; não tratar como replay.                |
| INFRASTRUCTURE_PERMANENT                                                   | Estado FAILED auditável; não é rejeição de negócio.                               |

InvalidTransactionStateError e InvalidMessageStateError são erros de programação,
não failureCode de negócio. O mapeamento HTTP e classificação de erros dos drivers
ficam para T05/T07.

## Consequências

Nenhum valor monetário passa por number, mas contadores, versões e cálculo de tempo
podem usá-lo. Bigint não é serializado diretamente. Ainda não se define a precisão
máxima da coluna SQL: a T03 deverá compatibilizar seus limites com o contrato.

O domínio consegue verificar regras usando fatos fornecidos, mas não prova que
esses fatos estão atualizados ou completos. Unicidade, locks, replay persistente,
atomicidade, publicação e recuperação exigem banco e workers das etapas seguintes.

## Verificação

Testes de valores altos, inválidos, moedas, reconstrução, matriz de estados,
reversões, ledger, payloads imutáveis e modelos inbox/outbox. Evidências no plano T02.
