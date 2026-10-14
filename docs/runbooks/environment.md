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

Docker, Compose e Buildx são necessários para a stack e seus smoke tests na T01.
`bun run check` pode rodar sem containers e inclui testes HTTP em loopback.
Veja [execução da stack](backend.md). Não há dependência de conta corporativa,
provedor remoto ou credencial de produção.

## Instalação reproduzível

Na raiz do repositório:

```sh
bun --version
bun install --frozen-lockfile
bun run doctor
bun run check
```

O `doctor` retorna código 1 se houver pré-requisito ausente ou versão Bun divergente,
inclusive Docker indisponível. Isso não impede executar os checks sem containers. Ele
apenas diagnostica; não instala pacotes nem inicia serviços.

## Comandos direcionados

```sh
bun run check:docs
bun run check:architecture
bun run lint
bun run format:check
bun run typecheck
bun run test:harness
bun run test:domain
```

`bun run format` é a ação explícita de formatação. README.md é excluído para preservar
o enunciado. O hash do conteúdo original é conferido pelo check documental.

## Alterações de ferramentas

Mudanças de versão Bun exigem atualizar `.bun-version`, `packageManager`, `engines`,
as imagens/digests no Dockerfile e os documentos pertinentes. O workflow lê `.bun-version`. Atualize dependências
com Bun, versione o lockfile e valide uma instalação congelada. Nunca edite o lockfile
manualmente para simular uma resolução.

## CI

O [workflow](../../.github/workflows/harness.yml) roda em pushes e pull requests com
permissão de leitura do repositório. Executa instalação congelada e `bun run check`,
mais um job que sobe a stack real, executa smoke tests e limpa os containers.
Esse job também aplica migrations e executa testes de persistência em bancos descartáveis.
Não publica, não faz deploy e não requer segredos configurados pelo usuário.
O setup-bun lê a versão de `.bun-version`, conforme
a [documentação da action](https://github.com/oven-sh/setup-bun#using-version-file).
