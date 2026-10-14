# T07 — SQS, inbox e outbox

```json
{
  "id": "T07",
  "status": "completed",
  "requirements": [
    "REQ-POST-COMMIT",
    "REQ-ATOMIC-UNIT",
    "REQ-SQS-QUEUES",
    "REQ-SHARED-USECASE",
    "REQ-INBOX-DEDUPE",
    "REQ-ACK-AFTER-COMMIT",
    "REQ-SQS-ERRORS",
    "REQ-SHUTDOWN",
    "REQ-OUTBOX-PUBLISHERS",
    "REQ-OPENING-INTERNAL",
    "REQ-REFERENCE-EXPIRY"
  ],
  "dependsOn": ["T06"],
  "updatedAt": "2026-10-14"
}
```

## Objetivo

Integrar consumo SQS ao mesmo caso de uso HTTP e publicar eventos confirmados, com deduplicação persistente, retries e recuperação.

## Requisitos atendidos

Envelope/filas, inbox atômica, ack após commit, erros/retries/DLQ, shutdown e publishers concorrentes. Completar validação SQS de OPENING e publicação da expiração T06.

## Dependências

T06 em 08b821a, Bun 1.4.3, PostgreSQL 17 e LocalStack local. Branch codex/t07-sqs-inbox-outbox.

## Limites

Sem reconciliação/métricas T08 ou matriz completa de três instâncias T09. Sem worktrees, push ou publicação externa. Eventos podem ser redeliverados: consumidores devem deduplicar eventId persistentemente.

## Passos

- [x] Revisar contratos e criar branch exclusiva.
- [x] Detalhar ADR e integrar inbox à unidade financeira.
- [x] Implementar consumidor, validação, lease de visibilidade, retry e DLQ.
- [x] Implementar publicação concorrente da outbox e recuperação.
- [x] Integrar workers, comandos, filas e CI.
- [x] Validar PostgreSQL/SQS reais, falhas, concorrência e shutdown.
- [x] Atualizar evidências, revisar diff e fazer commit.

## Critérios de aceite

Inbox, recibo, efeitos e eventos confirmam juntos. Ack ocorre após commit, inclusive replay e rejeição de negócio. Mensagem inválida vai à DLQ; falha transitória tem backoff e cinco recebimentos antes da DLQ. Publishers selecionam somente eventos confirmados e recuperam falhas antes/depois do envio. Shutdown conclui trabalho ou devolve visibilidade. Saldo permanece igual ao ledger nos cenários financeiros.

## Comandos de validação

Executados no host: bun run check, bun run test:persistence, bun run test:messaging.
Em Linux: bun run stack:messaging, bun run stack:persistence, bun run check no
container; stack:up/migrate/smoke/workers e consumer/publisher --once na imagem de
produção. Verificações dirigidas adicionais de renovação de visibilidade e recuperação.
Instalação congelada das imagens, typecheck/lint/format/check:docs e git diff --check.

## Decisões

Inbox protege consumerName/messageId e hash do envelope canônico. Recibo financeiro conserva hash de negócio. DLQ usa limite de cinco recebimentos; retry via visibilidade exponencial. Outbox usa locks por linha com SKIP LOCKED durante envio limitado, sem alterar o commit financeiro. Fila de eventos separada, eventId estável; nenhuma promessa de exactly-once no transporte. Veja o [ADR 0009](../../decisions/0009-sqs-inbox-outbox.md).

## Resultados e limitações

- Inbox persistente integrada ao mesmo FinancialProcessing do HTTP. Registro,
  payloadHash, processamento/replay e processedAt compartilham commit com recibo,
  efeitos financeiros, agenda quando pendente e outbox. Nenhuma migration ou
  dependência nova foi necessária; schema e constraints anteriores foram reutilizados.
- Consumidor valida envelope, recusa OPENING, faz ack após commit e mantém rejeição
  financeira auditável. Mensagens inválidas/conflitantes vão para DLQ; infraestrutura
  transitória tem backoff e cinco recebimentos. DLQ explícita e redrive nativo testados.
- Publicação em wager-events.fifo, claim concorrente com SKIP LOCKED, eventId estável,
  retry persistido e marcação publishedAt após envio. Evento sem commit financeiro
  ficou invisível para o publisher. Duplicatas são seguras mediante contrato de inbox
  do assinante, demonstrado com um efeito SQL descartável no teste.
- 387 testes validados: 45 harness, 53 aplicação, 131 domínio, 126 persistência,
  27 mensageria e 5 smoke. A T07 acrescenta 3 testes de aplicação e 27 de mensageria.
  Persistência: 126 testes/877 asserções, no host e Linux. Mensageria: 26 testes no
  host mais renovação dirigida; 27 testes/160 asserções em Linux. A recuperação foi
  ampliada com uma asserção de publicação após morte, validada isoladamente nos dois ambientes.
- Concorrência real: duas conexões/PIDs disputaram a mesma inbox recebida em grupos
  FIFO distintos; dois publishers mantiveram locks de linhas diferentes ao mesmo
  tempo. IDs publicados e efeitos financeiros conferidos sem duplicação.
- Processo consumidor recebeu SIGKILL após commit e antes de ack; outra execução
  recuperou por inbox e publicou os eventos confirmados. Publisher morreu após envio
  ao broker e antes de publishedAt; outra instância concluiu. SIGTERM durante trabalho
  em andamento permitiu ack antes de sair. Renovação real de visibilidade após 10 s
  e devolução antes de iniciar o caso de uso foram verificadas.
- Backoff durável, cinco recebimentos, redrive nativo e falha no envio à DLQ foram
  testados. Alguns testes aceleram visibilidade depois de conferir o valor solicitado;
  outro usa espera real. Falha SQL após flush reverte inbox, recibo, ledger e eventos.
  Todas as fixtures comparam saldo à soma do ledger no encerramento.
- Evento de expiração da T06 foi recebido no broker; requisito de expiração e recusa
  SQS de OPENING agora têm evidência completa. Nenhum requisito futuro amplo de T09
  foi marcado concluído apenas por essas verificações.
- Bun 1.4.3, PostgreSQL 17, LocalStack 4.14.0, macOS e Linux. Build/checks passaram
  nos dois ambientes. Smoke passou na imagem de produção; três workers iniciaram via
  Compose e rodadas --once encerraram com sucesso. CI foi ampliada; execução remota
  depende de publicação autorizada.
- Corrigidas tipagens do registro composto de inbox durante desenvolvimento. Não
  foram enfraquecidos testes ou verificadores. README original preservado.
- Limites: publicação at-least-once, ordenação de chegada no broker, assinante de
  negócio externo não implementado, retenção finita das filas. Locks de outbox
  ocupam conexão durante envio limitado. Métricas/readiness/reconciliação T08 e
  matriz de três instâncias/50 reenvios T09 continuam pendentes.
- Sem worktrees, push ou coautoria. Encerramento preserva os volumes PostgreSQL.

## Próximo passo

T08 — Reconciliação e observabilidade, aguardando seleção. Abrir nova branch a
partir desta entrega; definir métricas, logs mínimos, readiness e reconciliação.
