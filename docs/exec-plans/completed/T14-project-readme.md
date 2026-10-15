# T14 — README de apresentação do projeto

```json
{
  "id": "T14",
  "status": "completed",
  "requirements": ["REQ-DELIVERY-DOCS"],
  "dependsOn": ["T13"],
  "updatedAt": "2026-10-15"
}
```

## Objetivo

Atender ao pedido explícito de remover o enunciado do README e apresentar apenas o projeto entregue, sua execução e suas verificações.

## Requisitos atendidos

REQ-DELIVERY-DOCS: documentação para avaliação, mantendo catálogo e evidências consultáveis.

## Dependências

Entrega T13 publicada em 67ab8af; branch codex/t14-project-readme no checkout atual.

## Limites

Sem mudança no backend, dependências ou regras financeiras. O pedido atual substitui a regra anterior de manter o enunciado no README. Seu conteúdo será arquivado intacto em docs/challenge.md apenas para rastreabilidade. Sem worktrees.

## Passos

- [x] Separar apresentação e fonte histórica de requisitos.
- [x] Adaptar verificador, regressões e links para a nova organização.
- [x] Executar check, revisar diff e registrar resultados.
- [x] Publicar a documentação em main conforme autorização de entrega vigente e preparar texto de observações.

## Critérios de aceite

README contém somente documentação do projeto. Fonte arquivada mantém o hash original. Verificador aceita editar README e rejeita alteração da fonte ou links inválidos. Instruções de execução permanecem reproduzíveis.

## Comandos de validação

bun run check; comparação byte a byte do arquivo arquivado com o prefixo anterior; git diff --check. CI remota após publicação.

## Decisões

Manter readmeSections no catálogo como nome histórico do campo, usando sourcePath explícito para identificar o enunciado arquivado. Atualizar links sem reescrever os resultados históricos das auditorias.

## Resultados e limitações

bun run check aprovado: documentos, arquitetura, lint, formato, tipos, build e
267 testes (49 harness, 87 aplicação, 131 domínio), sem falhas. O arquivo arquivado
é byte a byte igual ao prefixo anterior e mantém SHA-256
47795fce2fc38cae5f1b91368ebaf80b7a2ed1fe147f36704b665faf0613812e.
Git diff --check aprovado. Não há alteração em src, migrations, dependências ou
workflow. Os resultados financeiros T13 permanecem como registro daquela execução.
A publicação dispara novamente a [CI](https://github.com/Verax12/jungle_challenge/actions/workflows/harness.yml);
seu histórico registra o resultado por commit.

## Próximo passo

Apresentar a documentação publicada e o texto de observações ao usuário. Aguardar seleção de nova tarefa; o formulário não é enviado automaticamente.
