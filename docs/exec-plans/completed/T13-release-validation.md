# T13 — Validação integral e publicação

```json
{
  "id": "T13",
  "status": "completed",
  "requirements": [
    "REQ-SYSTEM",
    "REQ-SCHEMA-INVARIANTS",
    "REQ-FINAL-INVARIANT",
    "REQ-ELIMINATORY",
    "REQ-DELIVERY-DOCS"
  ],
  "dependsOn": ["T12"],
  "updatedAt": "2026-10-15"
}
```

## Objetivo

Conferir todos os requisitos obrigatórios, testar o fluxo completo e corrigir defeitos comprovados antes de integrar e publicar main, conforme autorização explícita do usuário.

## Requisitos atendidos

Todos os 78 itens do catálogo foram revisados, com prioridade para invariantes financeiras, transações, idempotência, concorrência e recuperação.

## Dependências

T12 em e26c247; branch codex/t13-release-validation no checkout atual. Bun 1.4.3, Docker/Colima e ferramentas existentes. Stack exclusiva backend-challenge-t13-20261015, HTTP 13013, PostgreSQL 15443 e SQS 4566.

## Limites

Preservar enunciado, dados/volumes anteriores, SQL Server e alterações alheias. Sem worktrees. Não implementar opcionais sem relação com defeitos. Não prometer ausência universal de bugs: evidências devem delimitar o que foi exercitado. Publicação main autorizada, sem force push nem coautor.

## Passos

- [x] Conferir checkout e criar branch da etapa.
- [x] Revisar README e implementação com investigações independentes.
- [x] Ampliar verificações dos entrypoints de produção e repetir falhas reais.
- [x] Corrigir defeitos confirmados, incorporar regressões e executar gates completos.
- [x] Atualizar evidências, revisar diff e limpar recursos descartáveis.
- [x] Commitar, preservando as evidências aprovadas.
- [x] Integrar main, fazer push autorizado e conferir CI remota.

## Critérios de aceite

Nenhum achado de negócio/lógica conhecido pendente. Suítes obrigatórias passam com PostgreSQL/SQS reais; fluxos da imagem de produção e recuperação têm asserções financeiras e de eventos. README original intacto. Resultado remoto e eventuais limitações registrados com precisão.

## Comandos de validação

Executados: doctor, install congelado, build Docker sem cache, check host/Linux, stack:migrate repetido, persistência, mensageria, distribuídos, smoke, workers, novos fluxos de produção e probes de indisponibilidade. Git fetch antes de integrar; push normal de main e consulta ao workflow.

## Decisões

Três revisões focadas em negócio/HTTP, schema/persistência e mensageria/recuperação. Infraestrutura e publicação centralizadas para evitar interferência. Testes adicionais devem verificar comportamento observável e não espelhar implementações.

## Resultados e limitações

Validação local: 477 testes distintos aprovados, zero falhas/skips, quatro probes
reais de recuperação aprovados. Unicode malformado corrigido com regressões.
[Relatório completo](../../audits/T13-release-validation.md) e
[resultados nominais](../../audits/T13-test-results.json). Main publicada em 939690e após cd44d83. CI remota aprovou os dois jobs:
[execução em main](https://github.com/Verax12/jungle_challenge/actions/runs/38791985589). Histórico inicial remoto preservado por merge; sem force push/coautor.
Nenhuma garantia de homologação AWS, múltiplos hosts, carga ilimitada ou perda de disco. O README exige emulação SQS local; infraestrutura externa não será criada desnecessariamente.

## Próximo passo

Entrega encerrada; aguardar seleção explícita de uma nova tarefa. Opcionais e
homologação externa não são etapas iniciadas automaticamente. O registro final
de evidências é publicado junto da entrega, preservando o código validado.
