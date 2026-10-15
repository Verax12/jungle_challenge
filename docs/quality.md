# Qualidade e rastreabilidade

## Estado das garantias

A T01 implementa a base executável, a T02 acrescenta modelos financeiros puros e
a T03 implementa schema/mapeamento com testes de PostgreSQL real.
A T04 executa abertura e operações com lock, ledger e eventos atômicos. A T05
acrescenta endpoints HTTP, recibos idempotentes e replay. A T06 acrescenta worker
de referências, com agenda e recuperação testadas em PostgreSQL. A T07 acrescenta
consumidor/publisher com PostgreSQL e SQS reais, a T08 instrumenta observabilidade e
a T09 valida concorrência/recuperação entre processos independentes. A T10 registrou
78 requisitos com evidências revisadas e 414 testes aprovados. A [T11](audits/T11-readme-audit.md)
reabriu sete requisitos após reproduzir três defeitos adicionais. A [T12](audits/T12-corrections.md)
corrigiu os três achados, integrou as regressões e aprovou 440 testes distintos. Os
78 requisitos foram reavaliados na [T13](audits/T13-release-validation.md), com
477 testes e quatro probes aprovados. Foram acrescentados regressões Unicode,
limites monetários/reversões e fluxos HTTP/SQS dos processos de produção. O catálogo
registra o estado individual de cada requisito. Testes de unidade comprovam regras
locais; harness e smoke tests não significam correção financeira distribuída.

## Catálogo

[requirements.json](requirements.json) usa `schemaVersion: 1`,
`sourcePath: docs/challenge.md` e o SHA-256 do enunciado original. Na T14, a pedido
do usuário, esse texto saiu do README e foi arquivado integralmente. O README
passou a documentar somente a implementação, sem delimitador nem proteção por hash.
Seus links continuam verificados. O arquivo arquivado mantém o mesmo hash e fornece
as seções dos requisitos. `readmeSections` conserva o nome histórico do campo.
Cada requisito tem `id`, `summary`, `readmeSections`, `taskId`, `status` e `evidence`.
O resumo serve para navegação; a seção citada continua sendo a especificação.

Estados: `planned` (não implementado), `implemented` (implementado, validação ainda
incompleta) e `verified` (evidência revisada). Evidências têm `kind`, `description`
e `status` (`planned` ou `verified`). Uma evidência `verified` também exige `path`
para um arquivo existente, como teste ou relatório de execução versionado.

Um arquivo existir não comprova seu resultado: a revisão deve conferir comando,
ambiente, resultado e relação com o requisito. Não altere status somente para obter
um check verde. O verificador valida estrutura, referências e consistência; a
cobertura semântica do enunciado requer revisão humana do catálogo.

## Estratégia de testes do backend

| Tipo          | Evidência necessária                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Unidade       | Money, estados, operações, moedas, saldo, ledger e payload divergente                                               |
| Integração    | PostgreSQL e LocalStack/MiniStack reais, migrations, constraints, atomicidade, inbox/outbox, retry e DLQ            |
| Concorrência  | 50 duplicatas, saldo disputado, wallets paralelas, três processos, dois publishers, morte após commit e recuperação |
| Reconciliação | Saldo materializado igual ao reconstruído pelo ledger no final de todos os cenários obrigatórios                    |
| Revisão       | Contratos HTTP, logs, métricas, shutdown e documentação refletindo a implementação                                  |

Não substituir completamente banco e broker por mocks. Testes distribuídos precisam
de sincronização e evidências determinísticas, sem usar apenas sequências de chamadas
ou esperas arbitrárias como prova de paralelismo. T04 a T06 já injetam falhas transacionais; T07 cobre ack e publishers; T09 amplia a matriz distribuída.

## Gates atuais e evolução

`bun run check` executa documentos, arquitetura, lint, formato, tipos, build e testes
do harness/aplicação/domínio, inclusive após uma verificação falhar. Qualquer falha torna o
resultado final diferente de zero. O build recria apenas `dist/`, ignorado pelo Git.
O comando não instala dependências nem modifica arquivos versionados.

T01 adiciona smoke tests com PostgreSQL e LocalStack reais, executados separadamente
por `test:smoke`/`stack:smoke` e pelo job `stack` na CI. T02 inclui `test:domain` no
check e, portanto, na CI: valores exatos, estados, reversões, ledger, eventos e
mensagens. A sequência de movimentos em memória não é teste de concorrência.
T03 acrescenta `test:persistence`/`stack:persistence`, fora do check sem Docker e
incluído no job stack da CI. Testa migrations, mapeamento e SQL direto, com disputas
de unicidade sincronizadas entre duas conexões PostgreSQL. Esses resultados não
substituem a disputa de apostas no caso de uso ou os cenários com três instâncias.
T04 usa a mesma suíte de persistência para testar os casos de uso reais, rollback
após flush/no commit e concorrência. Uma transação de controle segura a wallet;
pg_blocking_pids demonstra duas sessões esperando na cadeia de locks antes de liberá-las.
Outra wallet deve confirmar antes da liberação. Polling tem prazo; esperar um tempo
fixo não é usado como prova de concorrência. Falha inicial de observação mostrou que
o segundo waiter pode esperar pelo primeiro, exigindo percorrer a cadeia completa.
T05 inclui HTTP real na suíte de persistência: contratos, recibos, replay após
movimentos e troca de processo, concorrência de chaves, paginação sob inserções e
conexão PostgreSQL recusada. Testes isolados de mapeamento de falhas não são prova de
recuperação distribuída. O reinício sequencial de um processo não equivale a três
instâncias simultâneas.
T07 acrescenta mensageria; T09 completa a matriz distribuída local. Não usar testes vazios,
skips ou stubs como aceitação dos requisitos futuros. Não enfraquecer um gate para
ocultar uma falha financeira ou um teste instável.

## Checklist de revisão

- A mudança respeita o escopo da tarefa e as regras do enunciado arquivado?
- Dependências, planos, requisitos e ADRs continuam coerentes?
- Os testes exercitam falhas e invariantes relevantes, além do caminho feliz?
- Logs e relatórios evitam segredos e payloads financeiros completos?
- Comandos e evidências relatados foram realmente executados?
- A próxima sessão consegue localizar o próximo passo sem ler o chat?

A T06 testa claims concorrentes, expiração com relógio injetado, rollback após flush,
reinício real após SIGTERM e SIGKILL antes do commit. Relógio controlado não é evidência
de 24 horas contínuas de carga. O processo agendado e o banco são reais nos cenários
de recuperação. A suíte messaging da T07 observa o evento de expiração publicado no broker.

Build/check e testes com subprocessos compilados devem rodar sequencialmente no mesmo
checkout, pois ambos recriam/consomem dist. Containers têm seu próprio filesystem.

T07 acrescenta test:messaging/stack:messaging e execução na CI, usando bancos e filas
exclusivos por fixture. Testa inbox/ack, redelivery, retries, DLQ, concorrência de
consumidores e publishers, e processos mortos entre commit/ack e envio/publishedAt.
O contrato de assinante usa deduplicação SQL por eventId com efeito também SQL;
não representa um assinante de negócio implantado. T09 acrescenta três instâncias e
50 reenvios. LocalStack real não equivale a homologação em AWS.

T08 acrescenta testes de reconciliação via HTTP com snapshot único sob transação
concorrente, precisão de 36 dígitos e divergência deliberada sem reparo. Somente os
bancos descartáveis permitem a injeção controlada que contorna triggers; o schema
normal permanece protegido. Logs são capturados, métricas são consultadas após
fluxos reais e lock timeout é produzido segurando uma wallet em outra conexão.
Probes testam dependências recusadas e sockets abertos que não respondem, além do
caminho saudável. Readiness não equivale à matriz distribuída T09.

T09 acrescenta test:distributed/stack:distributed, executado também no job stack
da CI. A [matriz obrigatória](test-matrix.md) mapeia cada cenário aos testes reais;
o [runbook](runbooks/distributed.md) explica barreiras, processos e limites.
Além das reconciliações por cenário, as suítes de processamento e HTTP conferem
todas as wallets após cada teste. Referências e mensageria já mantêm essa proteção.
As fixtures documentais copiam tests e src para validar links da matriz e auditoria: não se deve
ignorar links para código nem afrouxar o check quando a documentação passa a citá-los.
Casos negativos do catálogo devem definir explicitamente o estado inválido, sem
presumir que um requisito específico continuará planejado conforme o projeto avança.

A matriz T11 também referencia scripts, tsconfig, Dockerfile e Compose; a fixture
documental copia esses arquivos. Ao adicionar links para outras áreas do checkout,
mantenha a cópia da fixture alinhada, sem ignorar links ou relaxar suas assertions.

Na T10, os testes do verificador protegiam o apêndice operacional:
editar comandos é permitido, mas alterar o enunciado, quebrar links ou tornar o
delimitador ambíguo produz erro. Todas as suítes foram reproduzidas com dependências
instaladas pelo lockfile congelado e volume PostgreSQL novo. Detalhes no
[plano concluído](exec-plans/completed/T10-delivery-review.md).

A T11 registrou dois controles SQL aprovados e quatro falhas nos testes adicionais.
Na T12, todos passaram; foram movidos para tests/app, tests/persistence e
tests/messaging, executados pelos gates existentes da CI. Acrescentados upgrade
válido/inválido, down/up sem perda, lote em ordem inversa e corrida dependente dos
locks automáticos do schema, além de parser e contadores.
Dois probes adicionais pausam/retomam dependências preservando estado; não equivalem
a perda de disco nem a homologação AWS.

A T13 executa test:recovery sobre stack exclusiva vazia antes de stack:production.
A CI inclui parada real do PostgreSQL, pausa do SQS e SIGTERM antes do commit.
Asserções observam logs de retry/ack, locks, visibilidade SQL, efeitos financeiros,
IDs dos eventos, DLQ e reconciliação; processo apenas vivo não comprova recuperação.
Detalhes e limites no [runbook de produção](runbooks/production-validation.md).

T13 publicou main e conferiu aprovação remota dos jobs harness/stack. O
[relatório T13](audits/T13-release-validation.md) identifica execução e commit;
isso não amplia os limites de homologação externa acima.

A T14 adapta essas regressões à separação dos arquivos: edição do README é aceita,
links quebrados continuam falhando, mudança do enunciado arquivado é recusada e
sourcePath inválido não redireciona a verificação para outra fonte.
