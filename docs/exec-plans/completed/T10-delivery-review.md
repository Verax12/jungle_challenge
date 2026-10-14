# T10 — Documentação final e conferência

```json
{
  "id": "T10",
  "status": "completed",
  "requirements": [
    "REQ-DELIVERY-DOCS",
    "REQ-ELIMINATORY",
    "REQ-WALLET-CONCURRENCY",
    "REQ-WALLET-NONNEGATIVE",
    "REQ-INBOX-OUTBOX-MODEL",
    "REQ-FAILURE-CODES"
  ],
  "dependsOn": ["T09"],
  "updatedAt": "2026-10-14"
}
```

## Objetivo

Entregar documentação de uso reproduzível, arquitetura atual e auditoria do enunciado
com evidências reais, completando o roadmap obrigatório.

## Requisitos atendidos

Seção 14: README com setup/comandos, arquitetura com decisões e limites, e revisão
dos oito critérios eliminatórios. Conferir também a cobertura de todas as seções
obrigatórias contra o catálogo e a matriz de testes.

## Dependências

T09 em 7ede856. Branch codex/t10-delivery-review. Bun 1.4.3 e Docker/Compose no
contexto local existente. Stack Compose exclusiva com volume PostgreSQL novo.

## Limites

Sem opcionais, novas features, worktrees, push ou serviços externos. Não alterar o
texto do enunciado. Corrigir código somente se a auditoria revelar falha obrigatória.
Limpar exclusivamente recursos criados para esta validação; preservar a stack local
anterior, volumes existentes, Colima e SQL Server.

## Passos

- [x] Conferir checkout e abrir branch a partir da T09.
- [x] Revisar requisitos, implementação, testes e decisões.
- [x] Acrescentar setup no README preservando os bytes do enunciado original.
- [x] Atualizar arquitetura, runbooks, decisões e auditoria final.
- [x] Reproduzir instalação congelada, migrations, todas as suítes e operação com volume novo.
- [x] Registrar resultados/limites, atualizar catálogo/roadmap e preparar commit.

## Critérios de aceite

Setup executável por uma nova pessoa, sequência explícita de migrations/workers,
comandos de validação, endpoints, limites e desenho de autenticação. Critérios
eliminatórios ligados a código e testes reais. Todas as suítes passam na instalação
limpa; não declarar CI remota ou ambientes não executados como verificados.

## Comandos de validação

Executados no checkout da T10:

```sh
export DOCKER_CONTEXT=colima-backend-challenge
export COMPOSE_PROJECT_NAME=backend-challenge-t10-20261014
export PORT=13010
export DB_PORT=15440
bun run doctor
bun run check
docker compose build --no-cache app distributed
docker compose run --rm --build --no-deps distributed bun run check
bun run stack:up
bun run stack:migrate
bun run stack:migrate
bun run stack:persistence
bun run stack:messaging
bun run stack:distributed
bun run stack:smoke
bun run stack:workers
docker compose restart app consumer publisher reference-worker
docker compose --profile workers down --volumes
```

Conferidos probes API/workers, jornada HTTP/SQS antes/depois do restart, migrations
e ausência de bancos/filas de fixtures após testes. O [roteiro](../../runbooks/delivery.md)
detalha pré-requisitos, isolamento e reprodução. Após o registro final, formatação,
check documental, testes do harness e revisão do diff conferem o fechamento.

## Decisões

Documentação operacional acrescentada após um delimitador no fim do README. O prefixo
original continua protegido pelo mesmo SHA-256 do catálogo; links do documento
inteiro continuam verificados. Testes rejeitam mudanças do enunciado e delimitador
duplicado, ausente com apêndice ou antecipado. Isso atende ao setup exigido pela seção
14 sem reescrever o enunciado. Não foi necessário alterar o hash esperado.

A arquitetura foi organizada pelo funcionamento atual; o histórico permanece nos
planos/ADRs. ADR 0002 está marcado como substituído; nenhuma política financeira
foi alterada. Escolhas como TTL, backoff e status HTTP continuam identificadas como
decisões de implementação aceitas nas etapas correspondentes.

Reprodução em projeto Compose exclusivo, volume novo e build sem cache, aproveitando
a VM existente. Não instalar novos pacotes nem modificar configurações pessoais.
Manter limites locais explícitos, inclusive perda de mensagens ao recriar LocalStack,
retenção do broker, ausência de autenticação e CI remota ainda não executada.

## Resultados e limitações

- Auditoria das 14 seções e oito critérios eliminatórios liga código, matriz e
  resultados na [conferência final](../../delivery-review.md). O catálogo tem 78
  requisitos obrigatórios verificados. Quatro entradas antigas ainda implemented
  com evidência futura foram atualizadas após reproduzir as suítes; histórico mantido.
- README ganhou setup/comandos ao final. Seu prefixo corresponde byte a byte ao
  README de 7ede856, com SHA-256 original
  47795fce2fc38cae5f1b91368ebaf80b7a2ed1fe147f36704b665faf0613812e.
  Arquitetura, índice, qualidade, ADRs e runbooks descrevem o estado entregue.
- Corrigidas a omissão de db:migrate no fluxo do host e a colisão de portas dos
  workers nos exemplos. Guias deixam de apresentar T08/T09 como futuras. Modo Docker
  validado sem .env; nenhuma credencial pessoal ou conta externa foi necessária.
- Build sem cache executou bun install --frozen-lockfile nos estágios de produção
  e desenvolvimento: 226 e 337 pacotes, respectivamente. Diretórios node_modules/dist
  do host são excluídos do contexto. Check completo passou no macOS e na imagem Linux.
- Ambiente: Bun 1.4.3, PostgreSQL 17.11, LocalStack 4.14.0; Docker CLI 29.8.2,
  daemon 29.5.2, Compose 5.5.1 e Buildx 0.37.2, Colima aarch64. Projeto Compose
  exclusivo não tinha containers/volumes; banco começou com zero tabelas públicas.
  Quatro migrations aplicadas; segunda execução exit 0 sem aplicação adicional.
- Total distinto: 414 testes aprovados, zero falhas/skips. Harness 49 (73 asserções),
  aplicação/configuração 57, domínio 131, persistência 126 (936 asserções), mensageria
  37 (246), distribuídos 8 (158) e smoke 6 (22). Repetições host/imagem não duplicam
  esse total. Integração foi executada em Linux com banco/broker reais.
- Distribuídos registraram APIs PIDs 29/30/31 e sessões PostgreSQL 488/490/489, com
  barreiras/locks demonstrando paralelismo. Passaram 50 duplicatas, disputa de saldo,
  wallets independentes, dois publishers, SIGKILL, desordem e recuperação. A matriz
  existente descreve os detalhes e limites de cada cenário.
- API e consumer/publisher/references responderam 200 em health/live, health/ready e
  metrics. Jornada adicional na imagem de produção: wallet 100.00 BRL, BET 25.00
  criado (201), replay (200), mesmo header com payload divergente (409), WIN 10.00
  enviado duas vezes ao SQS com deduplicação de transporte contornada. Resultado:
  85.00 BRL, uma inbox, três lançamentos, seis eventos publicados e outbox drenada.
- Após restart dos quatro serviços, replay manteve transactionId/saldo original
  75.00; reconciliação continuou consistente em 85.00, três lançamentos. Probes e
  Docker health permaneceram saudáveis. Não houve novo efeito financeiro.
- O primeiro teste documental revelou que a fixture não copiava src, agora citado
  pela auditoria. Incluída a cópia; 49 testes passaram sem ignorar links. Quatro casos
  novos protegem apêndice/delimitador; nenhuma mudança em src, migrations,
  dependências, lockfile ou workflow foi necessária.
- Bancos e filas de teste foram limpos pelas fixtures. Stack exclusiva removida com
  seu volume ao final; volume backend-challenge_postgres-data preservado, SQL Server
  ainda running e Colima mantido ativo. Não houve prune nem limpeza de recursos alheios.
- Esta evidência é local: sem execução remota do GitHub Actions, homologação AWS,
  múltiplos hosts, benchmark ou teste de perda de disco. As limitações constam na
  arquitetura e auditoria; ausência de execução nesses ambientes não é aprovação.

## Próximo passo

Roadmap obrigatório T00–T10 concluído. Apresentar entrega e aguardar nova solicitação;
não há outra etapa obrigatória prevista. Publicação/CI remota exigem solicitação
própria. Novo escopo deve ter plano e branch próprios, sem worktrees.
