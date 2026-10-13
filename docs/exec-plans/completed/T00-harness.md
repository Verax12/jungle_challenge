# T00 — Harness de engenharia

```json
{
  "id": "T00",
  "status": "completed",
  "requirements": [],
  "dependsOn": [],
  "updatedAt": "2026-10-13"
}
```

## Objetivo

Preparar documentação rastreável e verificações executáveis antes do backend,
conforme o plano da etapa 0 aprovado pelo usuário.

## Requisitos atendidos

Esta etapa atende ao pedido de preparação do harness, não às funcionalidades do
challenge. O [catálogo](../../requirements.json) mapeia as obrigações do README para
T01 a T10, inicialmente sem evidências executadas.

## Dependências

Checkout com README original, Git e Bun na versão fixada. Docker não é necessário
para validar o harness. Nenhuma etapa anterior do roadmap.

## Limites

Sem worktrees, endpoints, entidades financeiras, migrations, filas ou implementação
do backend. Sem publicação remota. O enunciado permanece intacto.

## Passos

- [x] Inspecionar o repositório e registrar o hash do README.
- [x] Fixar ferramentas e criar scripts e workflow.
- [x] Organizar documentação, roadmap, requisitos e decisões.
- [x] Testar verificadores com entradas válidas e inválidas.
- [x] Executar instalação congelada e todos os checks.
- [x] Revisar diff, registrar evidências e concluir o plano.

## Critérios de aceite

- Requisitos obrigatórios associados a tarefas e verificações previstas.
- Links, planos e catálogo validados com diagnósticos acionáveis.
- Imports proibidos e ciclos detectados por análise sintática e resolução de módulos.
- Testes demonstram aceitação e rejeição pelos verificadores.
- Instalação reproduzível e checks executáveis localmente e no workflow.
- README preservado; nenhuma garantia do backend declarada pronta.

## Comandos de validação

`bun install --frozen-lockfile`, `bun run doctor`, `bun run check`,
`git diff --check` e `git diff --exit-code -- README.md`.

## Decisões

Ver [ADR 0001](../../decisions/0001-development-harness.md) para escolhas do harness
e [ADR 0002](../../decisions/0002-backend-options.md) para propostas futuras.

## Resultados e limitações

Validação executada em 2026-10-13, em macOS com Bun 1.4.3:

| Verificação                                                                          | Resultado                                                                                    |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `bun run check`                                                                      | Aprovado: documentos, arquitetura, ESLint, Prettier, TypeScript e testes                     |
| `bun run test:harness`                                                               | 44 testes passaram, zero falhas, 66 asserções                                                |
| Cópia limpa, sem node_modules, com `bun install --frozen-lockfile` e `bun run check` | 123 pacotes instalados pelo lockfile; todos os checks passaram                               |
| `bun run doctor`                                                                     | Código 1 esperado: Bun/Git disponíveis, Docker/daemon/Compose ausentes                       |
| `git diff --check` e `git diff --exit-code -- README.md`                             | Sem erros e sem alteração do enunciado                                                       |
| Revisão do catálogo                                                                  | 78 requisitos distribuídos por todas as seções numeradas do README; todos permanecem planned |

O SHA-256 do README permaneceu
`47795fce2fc38cae5f1b91368ebaf80b7a2ed1fe147f36704b665faf0613812e`.
As primeiras execuções detectaram uma seção não associada no catálogo e problemas
de tipagem do diagnóstico; ambos foram corrigidos antes da execução final.

Bun foi instalado no diretório de usuário e seu PATH adicionado ao zsh, conforme
autorização para instalar ferramentas. Dependências do projeto ficam em node_modules.
Não houve conexão a contas corporativas, instalação de Docker ou publicação remota.
A CI foi configurada, mas ainda não executada no GitHub. Nenhuma funcionalidade do
backend está implementada ou testada; os checks atuais não comprovam garantias financeiras.

## Próximo passo

T00 concluída. Aguardar seleção do usuário para detalhar T01 e preparar o ambiente
e a estrutura do backend, começando pela disponibilidade de Docker/Compose.
