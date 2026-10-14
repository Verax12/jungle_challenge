# ADR 0007 — Recibo idempotente e contratos HTTP

## Estado

Aceito na T05 em 2026-10-14, branch codex/t05-idempotency-http.

## Contexto

T04 impede efeitos duplicados mas retorna conflito para qualquer repetição. O
README exige replay com o saldo observado originalmente e hash de campos de negócio,
além de endpoints e paginação. Não exige implementar autenticação.

## Decisão

- FinancialProcessing calcula SHA-256 de JSON com chaves ordenadas recursivamente:
  providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind,
  money(amount/currency) e referenceExternalTransactionId quando presente. Chave,
  correlationId, causationId e demais metadados não entram. Contratos estritos não
  normalizam dinheiro nem descartam campos desconhecidos silenciosamente.
- Um recibo imutável guarda chave, identidade externa, hash e resultado original
  (status, saldo, versão, failureCode quando houver). É inserido no mesmo commit dos
  efeitos e eventos. Replays não gravam ledger/outbox nem alteram wallet.
- Consultar recibo antes e depois do lock de wallet. Em corrida entre identidades
  que atingem wallets distintas, as uniques fazem a perdedora reverter; uma nova
  unidade de leitura consulta o recibo confirmado e decide replay/conflito.
  Não há lock global, garantia em memória nem retry automático de movimentação.
- Mesma chave e payload idêntico: replay. Chave divergente para o mesmo provider/ID
  externo é conflito, assim como chave reutilizada com payload diferente. Não há
  aliases de chave. Registros antigos da T04 sem recibo falham como conflito;
  não é possível inventar saldo original de LOSS/rejeições antigas.
- Replay preserva a resposta inicial inclusive quando PENDING_REFERENCE. Consultas
  GET retornarão o estado atual quando o worker T06 existir. Recibo não é o estado
  mutável da transação; resolver pendência não reescreve o aceite original.
- POST wallet: 201; POST transação aplicada: 201, replay aplicado: 200; pendente:
  202; rejeição de negócio: 422, inclusive replay. Contrato inválido: 400; ausente:
  404; conflito: 409; infraestrutura transitória: 503 com Retry-After; inesperado: 500. Erros têm código estável, sem SQL, stack, credenciais ou payload completo.
- Ledger ordena por wallet_version crescente e fixa a versão máxima da primeira
  página. Cursor base64url versionado carrega wallet, última versão e teto; não
  representa autorização ou assinatura. É validado e vinculado à wallet. Novos
  movimentos ficam para uma nova paginação. Limit padrão 50, intervalo 1–100.
- HTTP exige um único Idempotency-Key e rejeita chave no corpo. Body e Money têm
  campos permitidos explícitos, IDs de até 256 caracteres e valores monetários
  compatíveis com o limite SQL de 36 dígitos inteiros, sempre em strings de escala 2.
- Autenticação omitida: endpoints de negócio são abertos no ambiente local. Guard
  explícito delimita o ponto de extensão. Em implantação autenticada, substituí-lo
  por validação JWT/OIDC de IdP (issuer, audience, assinatura e expiração), mapear
  identidade para provider/players e aplicar autorização também nas consultas.
  Health permanece público. Não se confia num header de provider como autenticação;
  canal SQS futuro segue validação de identidade/escopo pelo mesmo caso de uso.
- Conexão de banco inicializada sob demanda e fechada no shutdown; liveness não
  depende do banco. Migrations continuam explícitas, sem criar schema no bootstrap.

## Consequências

Recibo ocupa armazenamento persistente sem expiração nesta etapa. Perder a resposta
HTTP após commit não perde o resultado. Leitura de recibo após conflito só acontece
quando a transação concorrente confirmou; falhas transitórias propagam como 503.
A resposta original pode continuar pendente enquanto GET mostra estado posterior.
Sem IdP, esta API não oferece isolamento entre usuários; o Compose limita portas
publicadas ao localhost. Workers, prontidão e observabilidade ficam no roadmap.

## Verificação

Testes reais de HTTP e PostgreSQL: replay após outros movimentos e reinício de
processo, payload divergente, conflitos concorrentes, rollback do recibo, constraints,
paginação durante inserções, códigos HTTP e rejeição externa de OPENING.

## Referências

- [NestJS — exception filters](https://docs.nestjs.com/exception-filters).
- [NestJS — guards](https://docs.nestjs.com/guards).
- [PostgreSQL 17 — isolamento](https://www.postgresql.org/docs/17/transaction-iso.html).
