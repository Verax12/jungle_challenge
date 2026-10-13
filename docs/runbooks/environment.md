# Ambiente e comandos

## Pré-requisitos

Use Git e a versão exata de Bun em [.bun-version](../../.bun-version). O package.json
e a CI usam a mesma versão. Node não é necessário para os comandos do projeto:
ESLint, Prettier e TypeScript são executados pelo Bun.

Instale Bun pelo [guia oficial](https://bun.com/docs/installation) caso não esteja
disponível. Uma instalação local pode ser feita com o instalador oficial, explicitando
a versão: `curl -fsSL https://bun.com/install | bash -s "bun-v1.4.3"`. Esse comando
instala software; leia o script se desejar revisá-lo antes de executá-lo. Confirme
que o diretório de binários do Bun está no PATH e confira `bun --version`.

Docker e Compose serão necessários para PostgreSQL e o broker a partir da T01.
Nenhum container é necessário para os testes atuais do harness. Não há dependência
de conta corporativa, provedor remoto ou credencial de produção.

## Instalação reproduzível

Na raiz do repositório:

```sh
bun --version
bun install --frozen-lockfile
bun run doctor
bun run check
```

O `doctor` retorna código 1 se houver pré-requisito ausente ou versão Bun divergente,
inclusive Docker indisponível. Isso não impede executar os checks do harness. Ele
apenas diagnostica; não instala pacotes nem inicia serviços.

## Comandos direcionados

```sh
bun run check:docs
bun run check:architecture
bun run lint
bun run format:check
bun run typecheck
bun run test:harness
```

`bun run format` é a ação explícita de formatação. README.md é excluído para preservar
o enunciado. O hash do conteúdo original é conferido pelo check documental.

## Alterações de ferramentas

Mudanças de versão Bun exigem atualizar `.bun-version`, `packageManager`, `engines`
e os documentos pertinentes. O workflow lê `.bun-version`. Atualize dependências
com Bun, versione o lockfile e valide uma instalação congelada. Nunca edite o lockfile
manualmente para simular uma resolução.

## CI

O [workflow](../../.github/workflows/harness.yml) roda em pushes e pull requests com
permissão de leitura do repositório. Executa instalação congelada e `bun run check`.
Não publica, não faz deploy, não requer segredos configurados pelo usuário e não
executa o backend inexistente. O setup-bun lê a versão de `.bun-version`, conforme
a [documentação da action](https://github.com/oven-sh/setup-bun#using-version-file).
