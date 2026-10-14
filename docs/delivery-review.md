# Auditoria da entrega

## Escopo e método

T10 revisa as seções obrigatórias do [enunciado](../README.md) contra implementação,
[catálogo](requirements.json), [matriz de testes](test-matrix.md) e decisões aceitas.
O [plano T10](exec-plans/completed/T10-delivery-review.md) registra execução e resultados.
Esta revisão não atribui nota nem promete avaliação externa.

Foram lidos contratos, Money, mapeamento monetário, caso de uso financeiro, unidade
transacional, recibos, protocolo inbox/ack, publisher e políticas de referências.
Revisão estática orienta a auditoria; evidência financeira depende das suítes reais.

## Cobertura do enunciado

| Seção                       | Implementação e evidência                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 e 3 — sistema distribuído | FinancialProcessing compartilhado, PostgreSQL e mensageria; matriz T09 cobre duplicação, desordem, três processos e recuperação.             |
| 2 — autenticação            | Omissão explícita, OpenBusinessAccessGuard e desenho IdP/OIDC/autorização em ARCHITECTURE. Health público.                                   |
| 4 — stack                   | Bun fixado, TypeScript estrito, NestJS, MikroORM, PostgreSQL, LocalStack e Compose; instalação congelada, migrations e smoke.                |
| 5 — invariantes             | Locks/constraints, recibos e ledger auditável; critérios eliminatórios detalhados abaixo.                                                    |
| 6 — modelos                 | Factories, rehydrate, estado encapsulado, Money/ledger imutáveis, inbox/outbox; domínio, mapeadores e testes SQL.                            |
| 7 — operações/referências   | Cinco operações, escopo e valor integral, unicidade por tipo, falhas distintas, agenda/TTL; domínio, processamento e referências.            |
| 8 — concorrência            | Disputa 80+80 sobre 100, wallet independente e três processos; saldo final 20 e um débito comprovados.                                       |
| 9 — HTTP                    | Rotas, header, hash, replay, paginação, reconciliação e probes; integração HTTP/PostgreSQL e observabilidade.                                |
| 10 — SQS                    | Filas, contrato, inbox atômica, ack pós-commit, retry/DLQ/redrive e shutdown; suíte messaging e processos mortos/reiniciados.                |
| 11 — outbox/eventos         | Quatro subclasses/envelopes, persistência atômica, claims concorrentes e retry; publisher e contrato de assinante SQL com entrega duplicada. |
| 12 — observabilidade        | Logs com campos permitidos, métricas e health separados; captura de logs, scrapes e indisponibilidade real em testes.                        |
| 13 — testes                 | Matriz associa cada caso a teste executável; reconciliação ao fim dos cenários financeiros e processos reais.                                |
| 14 — documentação           | Setup no apêndice do README, arquitetura atual, decisões, runbooks, limites e reprodução limpa. Sem opcionais adicionais.                    |

## Critérios eliminatórios

| Falha a evitar                     | Proteção e teste revisado                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dinheiro em number                 | [Money](../src/domain/money.ts) usa bigint, [ExactAmountType](../src/adapters/persistence/amount-type.ts) usa strings/NUMERIC. money.test, amount-type.test e roundtrip.test exercitam precisão/36 dígitos e inválidos. Busca textual isolada não é prova. |
| Saldo negativo por race            | [Unidade financeira](../src/adapters/persistence/financial-unit-of-work.ts) bloqueia wallet antes de reidratar; schema confere não-negatividade/ledger. processing.test e distributed/concurrency.test disputam saldo em conexões/processos reais.         |
| Débito/crédito duplicado           | Uniques, recibo, inbox e reversão por referência/tipo. processing/http/references testam débitos e créditos/reversões concorrentes; 50 cópias HTTP/SQS e redelivery resultam em efeito único.                                                              |
| Idempotência só em memória         | processing_receipts e inbox_messages são persistentes e transacionais. Testes reiniciam processos e preservam resultado original; Maps do adapter são somente estado da unidade SQL atual.                                                                 |
| Apenas uma instância correta       | Três APIs/consumidores com PIDs distintos, locks/barreiras e dois publishers. Wallet livre progride enquanto outra aguarda lock.                                                                                                                           |
| Publicar antes do commit           | [PublishOutbox](../src/application/publish-outbox.ts) lê outbox confirmada por transação separada. publisher.test mantém transação financeira sem commit e comprova invisibilidade; recovery testa o intervalo posterior ao envio.                         |
| Ledger ausente/não auditável       | [Ledger](../src/domain/ledger.ts) imutável, constraints/triggers bloqueiam alterações e exigem correspondência no commit. schema/processing/http/references/messaging/distributed conferem estado e reconciliação.                                         |
| PostgreSQL/SQS totalmente mockados | Compose real, testes de persistência/mensageria/distribuídos/smoke com bancos/filas descartáveis; mocks de unidade não substituem esses gates.                                                                                                             |

Arquivos de testes e comandos estão na [matriz](test-matrix.md); nomes aqui são
referências de cobertura, não um relatório de execução por si só.

## Ajustes encontrados na revisão

- Guia do host omitia db:migrate; sequência corrigida antes do início da API/workers.
- Exemplos de workers no host agora usam portas operacionais diferentes para
  consumer/publisher/referências, evitando colisão na porta 9464.
- Guias de persistência/HTTP/mensageria ainda descreviam garantias T08/T09 como futuras.
- ADR 0002 permanecia visualmente proposto apesar de já substituído pelas decisões
  posteriores; índice agora diferencia histórico de escolhas vigentes.
- Quatro requisitos mantinham status implemented e evidências futuras de T05/T07/T09
  já realizadas. Foram atualizados com os resultados reproduzidos na T10; histórico
  anterior preservado.
- README precisava de setup sem perder o enunciado. O apêndice após delimitador
  preserva os bytes originais; o mesmo SHA-256 continua protegendo os requisitos.
  O verificador ainda valida links do documento inteiro e rejeita delimitador ambíguo.

## Resultado da reprodução

Em 2026-10-14, a reprodução passou no projeto Compose exclusivo
backend-challenge-t10-20261014, com volume PostgreSQL inicialmente vazio. Bun 1.4.3,
PostgreSQL 17.11 e LocalStack 4.14.0; instalação congelada/build sem cache e check
completo no host macOS e na imagem Linux. Quatro migrations aplicadas; segunda
execução sem migrations adicionais.

| Suíte                     | Testes aprovados |
| ------------------------- | ---------------- |
| Harness                   | 49               |
| Aplicação/configuração    | 57               |
| Domínio                   | 131              |
| Persistência PostgreSQL   | 126              |
| Mensageria PostgreSQL/SQS | 37               |
| Distribuídos/recuperação  | 8                |
| Smoke da imagem           | 6                |
| Total distinto            | 414              |

As repetições entre host/imagem não entram novamente no total. Todos os testes
passaram, sem skips. São quatro casos novos do harness; nenhuma mudança de backend,
migration, pacote ou lockfile foi necessária nesta etapa.

API e três workers responderam 200 em liveness, readiness e metrics. Jornada
adicional pela imagem de produção: abertura 100.00 BRL, BET 25.00 (201), replay
(200), payload conflitante (409) e WIN 10.00 via SQS entregue duas vezes com IDs de
deduplicação de transporte distintos. Resultado: saldo 85.00, uma inbox, três
lançamentos e seis eventos publicados. Após reiniciar API e workers, o replay
retornou o mesmo ID/saldo original 75.00; a reconciliação continuou em 85.00 com três
lançamentos, sem efeito extra.

O catálogo termina com 78/78 requisitos obrigatórios verificados, dentro dos limites
abaixo. A auditoria encontrou correções de documentação/rastreabilidade e de fixture
documental, sem falha de backend nesta execução. Recursos temporários foram removidos;
o volume anterior e outros serviços foram preservados. Comandos e resultados estão
no plano T10; roteiro reutilizável em [reprodução limpa](runbooks/delivery.md).

## Limites mantidos

Autenticação omitida; endpoint SQS exclusivamente local; sem benchmark, partidas
dobradas ou dashboard/OTel. Testes usam múltiplos processos em uma máquina, não AWS
ou múltiplos hosts. Não há garantia de exactly-once no transporte ou de recuperação
de perda de disco. LocalStack não preserva filas ao recriar containers; PostgreSQL
tem volume. Retenção finita do broker exige consumo/DLQ dentro do prazo.

Replay preserva aceite original; GET mostra estado atual. FAILED existe no modelo,
mas falha de infraestrutura durante escrita provoca rollback/retry/DLQ, não uma
rejeição financeira fabricada. Limites de dinheiro, referências, timeout e métricas
estão em [ARCHITECTURE](../ARCHITECTURE.md). CI remota depende de publicação autorizada.
