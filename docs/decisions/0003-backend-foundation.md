# ADR 0003 — Ambiente e bootstrap do backend

## Estado

Aceito em 2026-10-13 para a T01, autorizada na branch `codex/t01-backend-foundation`.

## Contexto

A base precisa iniciar com Bun, NestJS, PostgreSQL e SQS local, ser reproduzível e
permitir verificar conectividade antes de introduzir entidades e transações financeiras.
Não há necessidade de contas remotas ou de montar arquivos pessoais nos containers.

## Decisão

- Bun 1.4.3 continua como runtime, gerenciador e test runner. TypeScript 5.9 emite
  JavaScript ESM com decorators e metadados. Produção e `start:dev` executam o build;
  não dependemos de metadados emitidos pelo transpiler do Bun.
- NestJS 11.2.7 e Express são a base HTTP; somente `/health/live` está implementado.
  As versões exatas estão no lockfile. Não instalar CLI global nem plataforma de telemetria.
- MikroORM 6.6.17 com driver PostgreSQL segue a preferência do enunciado. Nesta etapa,
  é usado para conexão real, sem entidades e sem geração automática de schema. Mapeamento
  de Money, Unit of Work e garantias transacionais continuam pendentes da T03.
- PostgreSQL 17 Alpine, Bun e LocalStack usam imagens oficiais fixadas por digest.
  O banco usa volume nomeado; as portas publicadas ficam somente em loopback.
- LocalStack Community 4.14.0 executa apenas SQS, com eventos de telemetria desabilitados,
  sem token, Docker socket ou diretórios do host. As versões atuais exigem autenticação;
  a Community legada não recebe as atualizações da distribuição nova. Esta escolha é
  limitada ao ambiente local do challenge, não é uma recomendação de produção.
- AWS SDK v3 usa credenciais fictícias explícitas e endpoint validado como local.
  Não consulta perfis AWS pessoais nem credenciais da máquina. Os três retries de
  transporte do SDK não definem a política de tentativas de negócio da T07.
- Um serviço Compose de execução única cria as duas filas FIFO idempotentemente.
  Redrive, política de DLQ, consumidores e outbox continuam na T07; uma fila chamada
  DLQ existir não significa que o fluxo de falhas esteja implementado.
- Configuração vem de variáveis de ambiente; senha vazia, portas inválidas e endpoint
  SQS fora do ambiente local são rejeitados antes do listener HTTP. Erros de configuração
  identificam a chave, sem reproduzir o valor. `.env.example` contém somente valores públicos locais.
- A aplicação não conecta ao banco/broker no bootstrap desta etapa: liveness informa
  apenas que o processo atende HTTP. Readiness e métricas ficam na T08.

## Consequências

A imagem final executa como usuário `bun` e contém apenas JavaScript compilado e
dependências de produção. O smoke usa um estágio separado com as ferramentas de teste.
O build por TypeScript prioriza comportamento previsível, sem adicionar bundler.
O Dockerfile limita downloads do Bun a 16 conexões por instalação: o primeiro build
apresentou conexões pendentes na rede da VM com a concorrência padrão. O lockfile
permanece congelado; não houve relaxamento de integridade ou troca de registro.

No Mac desta sessão, Colima fornece uma VM dedicada com 2 CPUs, 4 GiB de memória e
20 GiB de disco virtual, sem mounts do host ou forwarding de SSH. O contexto é
selecionado explicitamente; a escolha não é imposta a usuários de Linux/Docker Desktop.

SQS não persiste mensagens entre recriações nesta etapa. O provisionamento recria
as filas; persistência/recuperação de operações será desenhada e testada nas etapas
de mensageria. O volume PostgreSQL é preservado por `stack:down`.

## Verificação

Testes de configuração e HTTP, build, smoke em PostgreSQL/LocalStack reais, repetição
do provisionamento e reinício dos serviços. Evidências registradas no plano T01.

## Referências

- [NestJS — primeiros passos](https://docs.nestjs.com/first-steps).
- [Transição da distribuição LocalStack](https://blog.localstack.cloud/the-road-ahead-for-localstack/).
- [Colima](https://github.com/abiosoft/colima).
