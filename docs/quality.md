# Qualidade e rastreabilidade

## Estado das garantias

A T01 implementa a base executável, a T02 acrescenta modelos financeiros puros e
a T03 implementa schema/mapeamento com testes de PostgreSQL real.
A T04 executa abertura e operações com lock, ledger e eventos atômicos. A T05
acrescenta endpoints HTTP, recibos idempotentes e replay. A T06 acrescenta worker
de referências, com agenda e recuperação testadas em PostgreSQL. Consumidor ainda não existe. O catálogo
registra o estado individual de cada requisito. Testes de unidade comprovam regras
locais; harness e smoke tests não significam correção financeira distribuída.

## Catálogo

[requirements.json](requirements.json) usa `schemaVersion: 1` e o SHA-256 do README
original. Cada requisito tem `id`, `summary`, `readmeSections`, `taskId`, `status` e
`evidence`. O resumo serve para navegação; a seção citada continua sendo a especificação.

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
ou esperas arbitrárias como prova de paralelismo. T04 a T06 já injetam falhas transacionais; ack e publishers serão exercitados na T07/T09.

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
T07 acrescentará mensageria; T09 completará a validação distribuída. Não usar testes vazios,
skips ou stubs como aceitação dos requisitos futuros. Não enfraquecer um gate para
ocultar uma falha financeira ou um teste instável.

## Checklist de revisão

- A mudança respeita o escopo da tarefa e as regras do README?
- Dependências, planos, requisitos e ADRs continuam coerentes?
- Os testes exercitam falhas e invariantes relevantes, além do caminho feliz?
- Logs e relatórios evitam segredos e payloads financeiros completos?
- Comandos e evidências relatados foram realmente executados?
- A próxima sessão consegue localizar o próximo passo sem ler o chat?

A T06 testa claims concorrentes, expiração com relógio injetado, rollback após flush,
reinício real após SIGTERM e SIGKILL antes do commit. Relógio controlado não é evidência
de 24 horas contínuas de carga. O processo agendado e o banco são reais nos cenários
de recuperação. A publicação do evento de expiração permanece pendente para T07.

Build/check e testes com subprocessos compilados devem rodar sequencialmente no mesmo
checkout, pois ambos recriam/consomem dist. Containers têm seu próprio filesystem.
