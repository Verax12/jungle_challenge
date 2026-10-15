# T12 — Correções e revalidação

Data: 2026-10-15. Branch: codex/t12-audit-fixes, criada a partir de 1d9d63a.
Os três defeitos da [T11](T11-readme-audit.md) foram corrigidos. As regressões
integram os gates regulares: **440 testes distintos aprovados, zero falhas e zero
skips**. Os [resultados nominais](T12-test-results.json) registram arquivos e casos;
a repetição host/Linux não duplica essa contagem.

## Alterações e decisões

| Achado                                       | Alteração                                                                                                                              | Evidência                                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1: OPENING retroativa quebra reconciliação  | Quinta migration audita histórico e instala checagem diferida do sucessor do ledger, complementando predecessor/head e lock existentes | [Regressão original e controles SQL](../../tests/persistence/ledger-invariants.test.ts), [upgrade e concorrência](../../tests/persistence/ledger-upgrade.test.ts) |
| F2: parser devolve 500 para entrada inválida | Classificação restrita a Error, tipo conhecido e status/statusCode coerentes; respostas públicas sem detalhes internos                 | [HTTP real](../../tests/app/http-input.test.ts), [classificação e proteção contra falsos tipos](../../tests/app/http-error-classification.test.ts)                |
| F3: FAILED omitido das métricas              | Gauges e contadores derivam status do enum do domínio                                                                                  | [Scrape PostgreSQL/SQS](../../tests/messaging/transaction-status-metrics.test.ts), [contadores e replay](../../tests/app/telemetry.test.ts)                       |

A [migration incremental](../../src/adapters/persistence/migrations/Migration202610150001.ts)
preserva as quatro anteriores. Uma consulta indexada confere o próximo lançamento;
não recalcula todo o ledger em cada operação. A validação diferida permite um lote
consistente inserido em ordem inversa dentro da mesma transação.

Antes de ativar o trigger, a migration bloqueia escritas e valida cadeia, soma,
saldo e versão existentes. Se houver divergência, aborta e identifica a wallet.
Não corrige registros financeiros automaticamente. Down preserva os dados, porém
remove a nova proteção e restaura a exposição ao defeito anterior. O upgrade exige
janela de manutenção e duração proporcional ao histórico.

O [filtro HTTP](../../src/adapters/http/financial-error.filter.ts) retorna:

- Corpo acima do limite existente de 100 KiB: 413/PAYLOAD_TOO_LARGE.
- Charset ou content encoding não suportado: 415/INVALID_REQUEST.
- JSON malformado: 400/INVALID_REQUEST.
- Erro interno com status arbitrário ou classificação incoerente: 500/INTERNAL_ERROR.

O limite não foi ampliado. Os testes confirmam que o processamento financeiro não
é chamado e que corpo, mensagem e stack do erro não aparecem na resposta.
FAILED aparece como zero quando ausente e como um após uma transação persistida.
Contadores incluem esse estado e não o incrementam em replay. Não houve mudança
na política de rollback/retry/DLQ ou nas transições financeiras.

As decisões estão no [ADR 0011](../decisions/0011-audit-corrections.md).

## Verificação executada

| Grupo                                        | Casos distintos aprovados | Ambiente              |
| -------------------------------------------- | ------------------------- | --------------------- |
| Harness                                      | 49                        | Host e Linux          |
| Aplicação, configuração, parser e telemetria | 74                        | Host e Linux          |
| Domínio                                      | 131                       | Host e Linux          |
| Persistência e HTTP com banco                | 134                       | Host e Linux          |
| Mensageria e observabilidade                 | 38                        | Host e Linux          |
| Distribuição e recuperação                   | 8                         | Host e Linux          |
| Smoke da imagem de produção                  | 6                         | Linux                 |
| **Total**                                    | **440**                   | Sem contar repetições |

As quatro regressões vermelhas da T11 agora passam. Seus dois controles SQL também
passam nas suítes permanentes. Foram acrescentados mais vinte casos: cinco de
upgrade/concorrência, dois HTTP reais, onze de classificação e dois de telemetria.

Os testes do upgrade comprovaram:

1. Históricos válidos de wallet zero, WIN e OPENING+WIN são preservados, com snapshots
   das wallets, transações e ledger idênticos antes/depois de up, down e novo up.
2. A inconsistência original é produzida sob as quatro migrations anteriores, com
   constraints habilitadas. O novo up falha duas vezes, deixa somente quatro versões
   registradas e mantém todos os registros intactos.
3. Outra fixture simula corrupção administrativa desabilitando temporariamente o
   trigger de wallet em banco descartável. O upgrade também recusa o head divergente.
   Esse caso testa detecção de dados corrompidos; não representa uma nova evasão SQL.
4. Lote válido com ledger v2 inserido antes de v1 confirma normalmente.
5. Duas conexões disputam crédito legítimo e OPENING retroativa. Sem FOR UPDATE
   explícito no teste, os locks do próprio schema preservam uma aprovação, uma
   rejeição 23514, saldo 15 e soma do ledger 15.

Também foram reexecutados: disputa BET 80+80 sobre 100; 50 reenvios HTTP e SQS;
três processos; morte antes/depois do commit/ack/publicação; dois publishers;
referências fora de ordem e reinício. Reconciliação continuou sendo conferida com
PostgreSQL real, sem substituir isso por análise textual ou mocks.

Probes adicionais na imagem de produção confirmaram 413/415/415/400 com os corpos
esperados, live/ready 200 e FAILED=0 em /metrics. Os três workers também responderam
ready e métricas com 200 e FAILED=0. O banco de negócio permaneceu com zero wallets;
os testes financeiros usaram bancos descartáveis. Cinco migrations aplicadas na
stack nova; repetir up não reaplicou nenhuma.

## Reprodução

Pré-requisitos e perfil Docker no [ambiente](../runbooks/environment.md).
Use uma stack exclusiva para a validação; as portas precisam estar livres:

```sh
export DOCKER_CONTEXT=colima-backend-challenge
export COMPOSE_PROJECT_NAME=backend-challenge-t12-20261015
export PORT=13012
export DB_PORT=15442
bun install --frozen-lockfile
bun run check
bun run stack:up
bun run stack:migrate
bun run stack:migrate
bun run stack:persistence
bun run stack:messaging
bun run stack:distributed
bun run stack:smoke
bun run stack:workers
docker compose run --rm --build --no-deps distributed bun run check
```

Se seu Docker não usa esse perfil Colima, selecione seu contexto local. SQS ocupa 4566. Para testar no host com a mesma infraestrutura, use DB_PASSWORD com a senha
pública local challenge-local-only, DB_PORT=15442 e os comandos test:persistence,
test:messaging e test:distributed. Não execute build/check em paralelo com testes
que usam dist no mesmo checkout.

Para atualizar **um banco existente**, siga o [procedimento de manutenção](../runbooks/persistence.md#atualizar-um-banco-existente-para-t12).
Ele inclui parada dos escritores, tratamento de falha segura e consultas de
diagnóstico. Não é necessário criar outro teste manual para fechar F1/F2/F3: todos
foram reproduzidos e aprovados localmente.

Ao encerrar a stack descartável acima, com o mesmo COMPOSE_PROJECT_NAME:

```sh
docker compose --profile workers down --volumes
```

## Rastreabilidade e limites

Os sete requisitos reabertos na T11 recebem evidência T12, retornando a 78 itens
verificados **no escopo local documentado**. O relatório e JSON da T11 preservam as
falhas históricas; somente links dos testes movidos e uma nota de atualização foram
ajustados. O enunciado original permanece byte a byte idêntico ao commit-base.

CI remota, AWS real, múltiplos hosts, TTL de 24 horas de relógio real, carga sustentada
e perda de disco não foram executados. Os roteiros/limites da [auditoria T11](T11-readme-audit.md)
continuam aplicáveis. Os probes específicos de pause/unpause da T11 não foram
repetidos nesta etapa; as suítes distribuídas de crash/restart foram. A execução
local em Linux não equivale a uma execução remota do GitHub Actions.

Stack e volume descartáveis T12 removidos; nenhum banco temporário restante.
Volume anterior, SQL Server e Colima preservados.

Não houve dependência nova, mudança de lockfile, push, PR ou merge em main.
O próximo passo de publicação depende de seleção explícita do usuário.
