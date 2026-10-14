# T09 — Testes distribuídos e recuperação

```json
{
  "id": "T09",
  "status": "completed",
  "requirements": [
    "REQ-SYSTEM",
    "REQ-REQUIRED-RACE",
    "REQ-OUTBOX-RECOVERY",
    "REQ-UNIT-SUITE",
    "REQ-REAL-INTEGRATION",
    "REQ-FIFTY-DUPLICATES",
    "REQ-PARALLEL-WALLETS",
    "REQ-THREE-PROCESSES",
    "REQ-KILL-BEFORE-ACK",
    "REQ-OUT-OF-ORDER-RESTART",
    "REQ-FINAL-INVARIANT"
  ],
  "dependsOn": ["T08"],
  "updatedAt": "2026-10-14"
}
```

## Objetivo

Completar a matriz obrigatória com processos independentes, PostgreSQL e SQS reais,
reconciliando o estado final e rastreando as evidências de cada cenário.

## Requisitos atendidos

Seções 1, 3, 8, 11 e 13: 50 duplicatas paralelas, disputa de saldo, wallets livres,
três processos, dois publishers, mortes nos limites transacionais, desordem e restart.
Conferir também a cobertura de unidade/integração já existente.

## Dependências

T08 em 032bbb7, branch codex/t09-distributed-recovery. Bun 1.4.3, PostgreSQL 17 e
LocalStack locais. Cada cenário usa banco e filas descartáveis exclusivos.

## Limites

Sem features opcionais, benchmark de carga, autenticação ou preparação final T10.
Sem worktrees, push ou alteração do README. Corrigir backend somente se uma falha
real do cenário exigir. Não enfraquecer verificações para acomodar comportamento errado.

## Passos

- [x] Revisar enunciado, estado e abrir branch.
- [x] Criar coordenador de processos com barreiras explícitas e limpeza.
- [x] Implementar 50 envios, corrida de saldo e progresso independente.
- [x] Validar consumidores/publishers concorrentes, SIGKILL e restart.
- [x] Resolver reversão entregue antes da referência após restart.
- [x] Integrar comandos/CI e mapear a matriz completa às evidências.
- [x] Executar gates, atualizar documentação e preparar entrega para commit.

## Critérios de aceite

Registrar PIDs distintos e observar concorrência real por locks/barreiras. Cinquenta
submissões simultâneas geram um único débito, e dois débitos de 80.00 sobre 100.00
resultam em 20.00. Wallet livre progride com outra bloqueada. Dois publishers têm
claims simultâneos distintos e preservam eventos. SIGKILL e restart mantêm efeitos
únicos. Todo cenário financeiro termina com saldo igual à soma assinada do ledger.

## Comandos de validação

Executados: bun run check, test:persistence, test:messaging, test:distributed,
bun test tests/distributed --timeout 45000, stack:distributed, stack:up,
stack:migrate e stack:smoke. Host com DB_PASSWORD local; Docker com contexto
colima-backend-challenge. Check completo também executado no serviço distributed
da imagem Linux com --no-deps. Sem dependências novas. O build da imagem instala com
lockfile congelado. Revisão de diff, tipos, lint, formato, documentos e arquitetura.

## Decisões

Processos de teste carregam módulos reais compilados. Barreiras/falhas ficam
somente em tests; sem switches de fault injection na aplicação. Medir existência
de PIDs e estados SQL, não inferir paralelismo apenas por duração. Capturar falhas
com prazos e encerrar filhos antes de remover banco/filas.

## Resultados e limitações

- Oito testes distribuídos passaram em macOS/Bun 1.4.3 e Linux na imagem Docker,
  com PostgreSQL 17 e LocalStack 4.14.0 reais: 158 asserções em cada ambiente.
  Exemplos de PIDs concorrentes registrados: APIs macOS 99646/99647/99648 e Linux
  29/30/31. Cada uma tinha sessão PostgreSQL distinta; locks/barreiras demonstraram
  simultaneidade, além da existência dos processos.
- Cinquenta apostas idênticas por HTTP produziram uma criação e 49 replays; cinquenta
  envios SQS com deduplicação do broker contornada produziram um processamento e
  49 replays, uma inbox e um débito. Reiniciar a API manteve o recibo.
- Duas apostas de 80.00 sobre 100.00 resultaram em PROCESSED e
  REJECTED/INSUFFICIENT_FUNDS, saldo 20.00 e um débito. A terceira API processou
  outra wallet enquanto as duas primeiras permaneciam na cadeia de locks.
- SIGKILL antes do commit reverteu o conjunto após flush; depois do commit e antes
  de ack preservou inbox/ledger/outbox. Consumidor novo retomou por expiração real
  da visibilidade reduzida a um segundo somente no teste. Dois publishers em
  processos diferentes mantiveram claims distintos e publicaram todos os eventos.
- SIGKILL após envio SQS antes de publishedAt deixou a linha recuperável, com ID
  estável após restart. FIFO suprimiu a cópia nessa janela; o teste de contrato de
  assinante da suíte messaging verificou separadamente inbox SQL/efeito único com
  duas entregas reais que contornam a deduplicação FIFO.
- REFUND e ROLLBACK chegaram antes do BET em dois cenários. Após SIGTERM com ack
  confirmado e novos consumidor/worker/API, a referência tardia resolveu cada
  reversão uma vez. GET mostrou PROCESSED; replay preservou a resposta pendente
  original. Saldo 100.00 e três lançamentos em ambos.
- Acrescentado teste unitário de chave idempotente com hash divergente. Suítes
  processing/http agora reconciliam todas as wallets após cada teste; referências
  e mensageria já faziam isso. Nenhuma alteração em src ou migration foi necessária.
- Total de 410 testes: 45 harness, 57 aplicação, 131 domínio, 126 persistência,
  37 mensageria, 8 distribuídos e 6 smoke. Check passou no host e Linux. Persistência:
  126/936 asserções; mensageria: 37/246; smoke: 6/22 na imagem da aplicação.
  A suíte distribuída também passou no Linux. A [matriz](../../test-matrix.md)
  liga todos os critérios da seção 13 aos testes e distingue limites da evidência.
- A execução inicial revelou timeout no cenário de referência ao encerrar um
  consumidor já em outra recepção. O teste passou a sinalizar SIGTERM na barreira
  pós-commit e conferir ack antes do restart, tornando explícito o ponto de parada.
  Não foram ampliados prazos nem relaxadas as asserções financeiras.
- O check documental real passou, mas a fixture do próprio harness não copiava os
  arquivos tests referenciados pela matriz. A cópia foi incluída; os 45 testes do
  harness passaram sem ignorar links. Ao verificar REQ-SYSTEM, outro teste revelou
  dependência do estado planejado desse requisito; agora cria explicitamente a
  condição inválida sem evidências. Ajuste de import type resolveu o lint inicial.
- Cenários locais entre processos não comprovam múltiplos hosts, throughput, perda
  de disco ou homologação AWS. CI ganhou stack:distributed; execução remota permanece
  pendente de publicação autorizada. O [runbook](../../runbooks/distributed.md)
  documenta reprodução, diagnóstico, limpeza e limites.
- README preservado; sem pacote novo, worktree, push ou coautor. Recursos temporários
  são removidos pelas fixtures. Encerramento da stack preserva volumes e Colima.

## Próximo passo

T10 — Documentação final e conferência do enunciado, aguardando seleção do usuário
e nova branch a partir desta entrega.
