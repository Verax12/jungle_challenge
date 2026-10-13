# T01 — Ambiente e estrutura do backend

```json
{
  "id": "T01",
  "status": "completed",
  "requirements": ["REQ-STACK"],
  "dependsOn": ["T00"],
  "updatedAt": "2026-10-13"
}
```

## Objetivo

Entregar uma base NestJS executável com Bun, configuração validada, build, PostgreSQL
e SQS locais em Docker Compose, antes de implementar o domínio financeiro.

## Requisitos atendidos

REQ-STACK, seção 4 do [README](../../../README.md). A escolha de MikroORM começa nesta
etapa, mas REQ-ORM permanece pendente dos mapeamentos e estratégia transacional da T03.

## Dependências

T00 concluída no commit `e9a1909`. Bun 1.4.3, Docker CLI, Compose e daemon local.
No Mac desta sessão, usar perfil Colima dedicado, sem montagem da pasta pessoal,
encaminhamento SSH ou alteração do contexto Docker ativo.

## Limites

Sem wallet, transação financeira, entidades ORM, migrations, consumidor, outbox,
autenticação ou métricas. Implementar somente liveness para smoke HTTP; readiness e
observabilidade completas continuam na T08. Não alterar o enunciado, publicar ou usar worktrees.

## Passos

- [x] Commitar o harness sem coautor e criar `codex/t01-backend-foundation`.
- [x] Configurar ferramentas locais e fixar dependências e imagens.
- [x] Criar bootstrap NestJS, configuração validada e build TypeScript.
- [x] Definir Compose com PostgreSQL, LocalStack e provisionamento idempotente de filas.
- [x] Testar configuração, HTTP e conectividade real de banco/broker.
- [x] Atualizar documentação e CI e validar a entrega para commit na branch.

## Critérios de aceite

- `bun run check` inclui build e testes da base, além do harness.
- `bun run stack:up` sobe a aplicação e dependências com healthchecks.
- `bun run test:smoke` comprova liveness HTTP, SELECT via MikroORM e envio/recebimento SQS real.
- Configuração inválida falha antes de abrir listener, sem expor valores sensíveis.
- Instalação congelada e imagem de execução usam a mesma versão Bun.
- README preservado e garantias financeiras não apresentadas como implementadas.

## Comandos de validação

`bun run doctor`, `bun install --frozen-lockfile`, `bun run check`,
`docker compose config --quiet`, `bun run stack:up`, `bun run test:smoke`,
reinício da stack, `git diff --check` e `git diff --exit-code -- README.md`.

## Decisões

NestJS 11 com Express, MikroORM 6/PostgreSQL e AWS SDK v3. TypeScript emite JavaScript
com decorators/metadados; Bun executa o resultado. LocalStack Community fixado para
rodar sem conta; não usar latest. Justificativas na [ADR 0003](../../decisions/0003-backend-foundation.md). Políticas financeiras e
limite de tentativas de negócio continuam para suas etapas.

## Resultados e limitações

Validação executada em 2026-10-13, no macOS e em containers Linux com Colima:

| Verificação                                    | Evidência observada                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Instalação congelada                           | Lockfile aceito no host e nas etapas de build e produção da imagem.                                                                  |
| `bun run check`                                | Documentação, 8 arquivos de arquitetura, lint, formatação, tipos e build aprovados; 45 testes do harness e 19 da aplicação passaram. |
| `bun run doctor`                               | Bun 1.4.3, Git, Docker CLI/daemon, Compose e Buildx disponíveis com a VM ativa.                                                      |
| `bun run stack:up`                             | PostgreSQL, LocalStack e aplicação saudáveis; provisionamento concluído.                                                             |
| Smoke no host e no container                   | 4 testes passaram: HTTP, consulta PostgreSQL via MikroORM, provisionamento repetível e ciclo real de mensagem SQS.                   |
| Reinício de PostgreSQL, LocalStack e aplicação | Stack voltou saudável, filas reprovisionadas e os 4 testes smoke passaram novamente.                                                 |
| Verificações completas no container Linux      | Mesmos checks e 64 testes sem falha, após o reinício.                                                                                |
| Revisão do diff                                | `git diff --check` sem erros; README preservado byte a byte.                                                                         |

São 68 testes distintos nesta entrega. Configurações inválidas, ausência de endpoints
financeiros e falha de inicialização sem vazamento de valores também estão cobertas.
Os testes HTTP precisaram de permissão para abrir portas locais fora da sandbox do
executor; o procedimento está no runbook de diagnóstico. Downloads simultâneos no
build inicial demoraram; a concorrência de rede do Bun foi limitada a 16, preservando
lockfile e validação de integridade.

Ao concluir a T01, um teste documental expôs dependência do estado antigo do roadmap.
Seu cenário passou a criar tarefas próprias na fixture, mantendo a rejeição de uma
tarefa ativa cuja dependência não foi concluída, independentemente do progresso real.

O workflow foi atualizado, mas ainda não executado no GitHub. LocalStack Community
4.14.0 é uma escolha de desenvolvimento sem conta, com manutenção limitada. Não há
persistência de mensagens, consumidor, redrive, migrations ou garantias financeiras.
Somente REQ-STACK foi marcado como verificado; os demais requisitos seguem planejados.

## Próximo passo

Apresentar esta entrega e seu commit. Próxima tarefa disponível: T02, domínio
financeiro. Aguardar sua seleção antes de detalhar e implementar o plano.
