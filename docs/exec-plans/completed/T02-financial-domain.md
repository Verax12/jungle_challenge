# T02 — Domínio financeiro

```json
{
  "id": "T02",
  "status": "completed",
  "requirements": [
    "REQ-MONEY-EXACT",
    "REQ-FACTORIES",
    "REQ-MONEY-IMMUTABLE",
    "REQ-MONEY-CONTRACT",
    "REQ-MONEY-INVALID",
    "REQ-MONEY-CURRENCY",
    "REQ-DOMAIN-INDEPENDENT",
    "REQ-TRANSACTION-STATES",
    "REQ-LEDGER-FACTORY",
    "REQ-INBOX-OUTBOX-MODEL",
    "REQ-REFERENCE-REQUIRED",
    "REQ-FAILURE-CODES",
    "REQ-EVENT-TYPES",
    "REQ-EVENT-ENVELOPE"
  ],
  "dependsOn": ["T01"],
  "updatedAt": "2026-10-14"
}
```

## Objetivo

Implementar o modelo financeiro puro e testes determinísticos, seguindo as seções
5, 6, 7 e 11 do [README](../../../README.md), sem integrar processamento ao servidor.

## Requisitos atendidos

Os 14 requisitos T02 listados nos metadados foram confrontados com testes e revisão.
Onze foram verificados no escopo de domínio. INBOX-OUTBOX-MODEL, FAILURE-CODES e
EVENT-TYPES estão implementados com evidência unitária, mas validação final pendente:
faltam persistência, integração dos códigos aos contratos e geração dos eventos pelo
caso de uso. Esses limites continuam explícitos no catálogo.

## Dependências

T01 concluída em `0b2a7b7`; Bun 1.4.3. Branch `codex/t02-financial-domain`, no
checkout atual, sem worktrees. Não são necessárias novas dependências.

## Limites

Sem schema, migrations, repositories, endpoints financeiros, workers, locks ou
publicação. Identidade, relógio e histórico de reversões entram por argumentos.
Unicidade, idempotência persistente e atomicidade continuam para T03–T07.

## Passos

- [x] Conferir estado, enunciado e catálogo; criar branch e plano.
- [x] Registrar decisões de escala, zero, referências, transições e falhas.
- [x] Implementar Money, ledger, transação e wallet com factories e reidratação.
- [x] Implementar envelope/eventos e modelos de inbox/outbox.
- [x] Testar caminhos válidos, rejeições, imutabilidade e reconstrução.
- [x] Integrar testes ao check, revisar diff e registrar evidências para commit.

## Critérios de aceite

- Dinheiro usa centavos `bigint`, sem conversão para `number` ou arredondamento.
- Contratos exigem duas casas; valores internos podem ser negativos para diferenças.
- Estados terminais bloqueiam transições e reidratação não reaplica movimentos.
- Movimentos retornam ledger balanceado; LOSS não altera saldo ou versão.
- Reversões validam escopo, tipo, estado, valor e evidência de reversão anterior.
- Eventos têm tipos concretos, versão e JSON sem instâncias de Money ou bigint.
- Datas/payloads externos não permitem alterar estado encapsulado.
- Suíte de domínio e todos os checks passam, sem alegar garantias distribuídas.

## Comandos de validação

`bun run test:domain`, `bun run check`, `git diff --check` e
`git diff --exit-code -- README.md`. Build e HTTP continuam no check existente.

## Decisões

Decisões aceitas na [ADR 0004](../../decisions/0004-financial-domain.md): bigint
em centavos, contratos de escala 2, suporte explícito BRL/USD/EUR, zero apenas em
LOSS/abertura, referências, transições, falhas e instantes ISO imutáveis. Políticas
de retry, TTL, HTTP e SQL serão decididas em suas etapas; o modelo de outbox recebe
parâmetros de backoff, sem defaults de produção. Removida do verificador arquitetural
a exceção proposta para decimal.js, pois o domínio não usa dependências externas.

## Resultados e limitações

Executado no macOS com Bun 1.4.3 em 2026-10-14:

| Verificação                                 | Resultado                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:domain` e execução pelo check | 131 testes, 454 assertions, sem falhas.                                                                                                            |
| `bun run check`                             | Documentação, arquitetura, lint, formato, tipos e build aprovados; 45 testes do harness, 19 de aplicação e 131 de domínio passaram (195 no total). |
| Arquitetura                                 | 16 arquivos de aplicação analisados; 8 novos arquivos de domínio, sem imports externos.                                                            |
| Diff/enunciado                              | `git diff --check` sem erros; README preservado byte a byte.                                                                                       |

Rastreabilidade das evidências:

| Arquivo de testes                      | Garantias locais exercitadas                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/domain/money.test.ts`           | Valores acima da precisão segura de number, centavos acumulados, escala, sinais internos, moedas e imutabilidade.                             |
| `tests/domain/transactions.test.ts`    | Referências obrigatórias, escopo/tipo/estado/valor, histórico informado, conflito de hash, matriz de transições e categorias de falha.        |
| `tests/domain/wallet-ledger.test.ts`   | OPENING/zero, operações, insuficiência distinta para reversão, falha sem mutação, versões, reconstrução sequencial pelo ledger e reidratação. |
| `tests/domain/events-messages.test.ts` | Quatro eventos, LOSS sem movimento, JSON imutável, datas, inbox e outbox com backoff parametrizado e restauração.                             |

Uma fixture inicial reutilizava o ID externo da BET na REFUND; a factory rejeitou
a autorreferência corretamente e a fixture foi corrigida com identidade distinta.
Durante a revisão, os contratos dos dados de eventos também ficaram readonly no
tipo, além do congelamento recursivo em runtime; typecheck e testes foram repetidos.

Não foram adicionados pacotes. Não foi necessário iniciar Docker para esta mudança
de domínio puro; os smoke tests de PostgreSQL/SQS não foram repetidos nesta etapa.
A CI executará a suíte pelo comando check, mas não houve execução remota ou push.
Nenhum teste sequencial foi apresentado como prova de concorrência ou idempotência
persistente. Nenhum endpoint financeiro foi acrescentado.

## Próximo passo

Apresentar a entrega e seu commit. Próxima etapa: T03, schema e persistência,
dependente de seleção do usuário. Definir precisão SQL de Money, entidades ORM,
constraints e migrations reversíveis antes de implementar casos de uso.
