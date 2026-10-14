# Testes distribuídos e recuperação

## Preparação e execução

Use Bun de [.bun-version](../../.bun-version), Docker/Compose e o contexto descrito
na [stack local](backend.md). As configurações de PostgreSQL e SQS seguem os
runbooks de [persistência](persistence.md) e [mensageria](messaging.md).

```sh
bun install --frozen-lockfile
bun run infra:up
bun run stack:distributed
```

Esse comando constrói a imagem com lockfile congelado e executa os oito cenários
no Linux. Não depende de API ou workers já iniciados: a suíte abre processos próprios
em portas livres. Cada teste cria um banco challenge_test_* e três filas test-*;
aplica migrations, encerra seus processos e remove somente seus recursos ao terminar.
O usuário do PostgreSQL precisa de CREATEDB. O comando não limpa o banco da aplicação.

Para executar os processos pelo Bun do host, com os serviços Compose locais padrão:

```sh
DB_PASSWORD=challenge-local-only bun run test:distributed
```

Se o ambiente tiver configuração própria, use seus valores DB_* e SQS_ENDPOINT.
Não execute build/check simultaneamente com testes no mesmo checkout: ambos usam
dist. Containers têm filesystem independente. Para executar apenas um cenário após
o build, use o nome apresentado na saída:

```sh
bun run build
DB_PASSWORD=challenge-local-only bun test tests/distributed --test-name-pattern '50 parallel HTTP' --timeout 45000
```

Ao encerrar a infraestrutura local, `bun run stack:down` preserva os volumes.

## O que a suíte observa

- Três APIs Nest ou três consumidores SQS, com PIDs de sistema e sessões SQL distintos.
- Cinquenta submissões paralelas por canal. SQS usa IDs de deduplicação e grupos
  distintos para que o broker não esconda as duplicatas do consumidor.
- Grafo real de locks PostgreSQL: as APIs esperam pela mesma wallet e outra wallet
  confirma antes da liberação. Polling tem prazo e observa estado, não apenas tempo.
- SIGKILL após flush antes do commit, após commit antes de DeleteMessage e após
  envio SQS antes de publishedAt. O teste reduz a visibilidade daquela mensagem para
  um segundo e aguarda expiração real; a configuração operacional continua 30 s.
- Dois publishers mantêm claims de linhas distintas simultaneamente na mesma outbox.
- REFUND e ROLLBACK chegam antes do BET. SIGTERM após commit permite confirmar o ack
  e encerrar antes da próxima recepção. Novos processos de consumidor, referências e
  API resolvem a referência tardia; replay mantém o recibo original pendente e GET
  mostra a transação processada.
- Saldo exato, quantidade de lançamentos, inbox e eventos. Toda fixture financeira
  é reconciliada antes de remover o banco, além das asserções de cada caso.

O coordenador usa IPC para comandos e observações. O código em tests carrega módulos
compilados reais e envolve SQL/SQS com barreiras somente para localizar o ponto da
morte. Não há switches de falha no backend. stdout/stderr são drenados e cada filho
tem prazo para encerrar; processo que não responde a SIGTERM recebe SIGKILL e falha o teste.

## Diagnóstico

| Sintoma                                       | Verificação                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Falha antes de ready                          | Build, DB_*, conexões PostgreSQL e evento fatal com PID.                                                                |
| Timeout aguardando lock                       | PIDs impressos, pg_stat_activity e pg_blocking_pids no banco descartável; não substitua por sleep.                      |
| Timeout de mensagem                           | Eventos do filho, origem/DLQ e visibilidade; um receive cancelado pode ter sido aceito pelo broker e exigir redelivery. |
| Falha após restart                            | Compare inbox, recibo, ledger e outbox; não apague evidências para obter sucesso.                                       |
| Child shutdown timeout                        | O teste já envia SIGKILL; investigue trabalho ou rede presos antes de ampliar o prazo.                                  |
| Recursos residuais após interrupção do runner | Consulte bancos challenge_test_* e filas test-*; remova somente recursos identificados da execução interrompida.        |

## Limites da evidência

São processos independentes em um mesmo host/container, compartilhando PostgreSQL e
LocalStack. Não é teste em múltiplos hosts, benchmark, homologação AWS, recuperação
de perda de disco ou garantia de exactly-once no transporte. A composição de teste
usa os mesmos casos de uso/adaptadores; entrypoints, health e shutdown operacionais
também têm cobertura nas suítes anteriores e na CI da stack.

No crash após send, FIFO pode suprimir a segunda entrega na janela do broker.
O contrato de assinante com inbox SQL é testado separadamente em
[recovery.test.ts](../../tests/messaging/recovery.test.ts), com duplicatas que
contornam essa janela de deduplicação. Não há assinante de negócio adicional implantado.

Veja a [matriz obrigatória](../test-matrix.md) e os resultados no plano T09.
