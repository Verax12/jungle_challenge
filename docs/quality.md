# Qualidade e rastreabilidade

## Estado das garantias

A T01 implementa a base executável do backend, sem processamento financeiro. O
catálogo registra o estado individual de cada requisito. Sucesso do harness e dos
smoke tests não significa correção financeira ou distribuída.

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
ou esperas arbitrárias como prova de paralelismo. Injeção de falha será planejada na T09.

## Gates atuais e evolução

`bun run check` executa documentos, arquitetura, lint, formato, tipos, build e testes
do harness/aplicação, inclusive após uma verificação falhar. Qualquer falha torna o
resultado final diferente de zero. O build recria apenas `dist/`, ignorado pelo Git.
O comando não instala dependências nem modifica arquivos versionados.

T01 adiciona smoke tests com PostgreSQL e LocalStack reais, executados separadamente
por `test:smoke`/`stack:smoke` e pelo job `stack` na CI. T03 e T07 acrescentarão
persistência financeira e mensageria; T09 completará a validação distribuída. Não usar testes vazios,
skips ou stubs como aceitação dos requisitos futuros. Não enfraquecer um gate para
ocultar uma falha financeira ou um teste instável.

## Checklist de revisão

- A mudança respeita o escopo da tarefa e as regras do README?
- Dependências, planos, requisitos e ADRs continuam coerentes?
- Os testes exercitam falhas e invariantes relevantes, além do caminho feliz?
- Logs e relatórios evitam segredos e payloads financeiros completos?
- Comandos e evidências relatados foram realmente executados?
- A próxima sessão consegue localizar o próximo passo sem ler o chat?
