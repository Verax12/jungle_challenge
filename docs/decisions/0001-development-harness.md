# ADR 0001 — Harness de desenvolvimento

## Estado

Aceito em 2026-10-13, conforme o plano da etapa 0 aprovado para implementação.

## Contexto

O repositório começou apenas com o enunciado. Antes do backend, precisamos de
orientações navegáveis, tarefas retomáveis e verificações executáveis.

## Decisão

Preservar o README, usar um AGENTS curto, indexar os documentos e manter catálogo
de requisitos, roadmap, planos e evidências no repositório. O trabalho ocorre no
checkout atual, uma etapa por vez, sem worktrees. Autenticação completa e demais
opcionais ficam fora da primeira entrega; a decisão e o ponto de extensão exigidos
pelo README permanecem no backlog.

O harness usa Bun 1.4.3, TypeScript 5.9.3, ESLint 9, typescript-eslint, Prettier e
markdown-it, com versões exatas no package.json e resolução no bun.lock. TypeScript
5.9 está dentro da faixa suportada pelo typescript-eslint selecionado. A análise de
imports utiliza o compilador TypeScript; Markdown é analisado por tokens.

GitHub Actions executa os mesmos checks locais em pushes e pull requests. O
diagnóstico do ambiente é separado dos gates porque Docker ainda não é necessário
para testar o harness. Não há conexão de contas ou serviços corporativos.

## Consequências

Há ferramentas pequenas para manter, testadas com entradas válidas e inválidas.
O catálogo evita depender do chat, mas exige revisão de cobertura semântica. Nenhuma
verificação desta etapa certifica o processamento financeiro.

## Verificação

`bun install --frozen-lockfile` e `bun run check`, com resultados registrados no
plano T00. A CI remota só pode ser afirmada após a execução real do workflow.
