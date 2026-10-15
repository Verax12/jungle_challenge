# Diagnóstico das verificações

## Bun ou dependências indisponíveis

Confirme `.bun-version`, PATH e `bun --version`. Execute `bun install --frozen-lockfile`
na raiz. Em falha de rede, corrija o acesso ao registro de pacotes; não remova o
lockfile nem altere versões como tentativa de mascarar o problema.

## Falha documental

O diagnóstico identifica arquivo, ID ou seção. Corrija links e âncoras, inclua novos
documentos no índice e confira o formato em [PLANS](../PLANS.md). IDs devem ser únicos;
tarefas referenciadas precisam existir e não podem formar ciclos.

Evidências `verified` exigem arquivo existente e revisão dos resultados reais. Se a
implementação não existe, mantenha `planned`. O check não executa testes citados no
catálogo e não verifica páginas externas na internet.

Se o hash do enunciado mudou, confira `git diff -- docs/challenge.md` e restaure
seu texto. O arquivo arquivado inteiro entra no hash; não atualize o hash para
ocultar alterações. O catálogo deve apontar sourcePath para docs/challenge.md.
O README pode ser editado livremente para documentar a implementação; seus links
locais e âncoras continuam verificados.

## Falha arquitetural

Consulte [arquitetura](../../ARCHITECTURE.md). Mova I/O para adapters e exponha contratos
na aplicação. Corrija aliases em tsconfig; não substitua um import proibido por um
import dinâmico. Reexports também são dependências. Quebre ciclos extraindo contratos.

## Falha de lint, tipos, formato ou testes

Execute isoladamente o comando indicado por `bun run check`. Use `bun run format`
para corrigir formatação e revise o diff. Adicione um caso de regressão quando corrigir
um verificador; não desative uma regra somente para fazer a execução passar.

## Docker indisponível

O harness pode ser validado sem Docker. Para etapas de integração, instale uma
distribuição comum de Docker/Compose, inicie o daemon e repita `bun run doctor`.
Com Colima, selecione `DOCKER_CONTEXT=colima-backend-challenge` no terminal antes
dos comandos Docker. Execute `bun run stack:up` e `bun run stack:smoke` conforme
o [runbook do backend](backend.md). Buildx também precisa estar disponível.

## Testes HTTP em ambiente restrito

Os testes da aplicação abrem uma porta temporária em `127.0.0.1`. Um sandbox que
proíba listeners pode produzir EADDRINUSE mesmo usando a porta dinâmica 0. Nesse
caso, execute os testes em um ambiente autorizado a abrir sockets locais; não
substitua o teste HTTP real por mocks para contornar a restrição.
