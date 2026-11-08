# Catálogo de arquitetura em PostgreSQL

O Experiments mantém um catálogo de arquitetura do portfólio, separado dos dados
operacionais de cada aplicação. Auth continua responsável por identidade; ERP,
CRM, Lojas e demais produtos continuam autoridades dos respectivos dados.
Este catálogo não substitui os cadastros de clientes, produtos ou usuários.

## Modelo

Schema: `experiments_architecture`. PostgreSQL 18 ou superior, Node.js 24.

| Tabela | Responsabilidade |
| --- | --- |
| applications | Produtos e responsáveis declarados |
| components | Componentes pertencentes a uma aplicação |
| interfaces | Contratos oferecidos por componentes e sua versão |
| dependencies | Consumidores ligados aos contratos oferecidos |
| data_assets | Dados e componente responsável na mesma aplicação |
| standards | Padrões compartilhados ou específicos de uma aplicação |
| evidence | Fontes declaradas, commit/hash e data de observação |
| assessments | Resultado registrado para uma versão de padrão |
| deployments | Publicações declaradas com componente, commit, artefato e evidência |
| source_snapshots | Arquivo dos JSONs legados, deduplicado por caminho e hash |
| changes | Histórico de alterações com motivo e revisão |
| catalog_revision | Revisão global usada para controle de concorrência |
| schema_migrations | Versão e checksum da migração aplicada |

As views `dependency_map` e `coverage` mostram dependências entre aplicações e
cobertura dos padrões. Cobertura sem avaliação é `not_assessed`; alteração do
padrão invalida a avaliação anterior, exibida como `stale`. Padrões retirados não
entram no relatório. Evidências, avaliações e publicações são somente de inserção
na API. Registrar `passed` documenta a conclusão do operador; não executa testes
nem comprova automaticamente o conteúdo da fonte.

O catálogo é administrativo e abrange todo o portfólio. Não é um banco multi-tenant
para acesso por clientes finais. O token administrativo existente tem acesso ao
catálogo inteiro. Tokens restritos ao contexto ERP não recebem esse acesso.

## Provisionamento e migração explícitos

1. Provisione um banco dedicado, backups e uma conexão privada/TLS conforme a
   infraestrutura. Use um proprietário de migração separado da role da API.
2. Disponibilize `LAB_ARCHITECTURE_ADMIN_DATABASE_URL` somente no processo
   administrativo. Não inclua esse segredo no `.env` compartilhado do Compose.
3. Construa a aplicação e execute:

```sh
npm ci
npm run build
npm run architecture:db -- migrate
npm run architecture:db -- status
```

Na imagem API, o equivalente é `node dist/lab/architecture/cli.js migrate`.
A migração é transacional, bloqueia migradores concorrentes e verifica checksum.
Nunca edite uma migração já aplicada. Crie uma nova versão e atualize o runner.
O servidor HTTP não cria tabelas nem executa migrações ao iniciar.

4. Provisione uma role de login exclusiva da API, sem privilégios administrativos
   nem propriedade do schema. Execute como proprietário:

```sh
psql -v ON_ERROR_STOP=1 -v runtime_role=experiments_architecture_api -f migrations/architecture/grants.sql
```

5. Configure `LAB_ARCHITECTURE_DATABASE_URL` apenas no serviço API, usando a role
   restrita. Não use `sslmode=no-verify`; valide o certificado do banco remoto.
   Sem essa variável, o catálogo retorna HTTP 503, enquanto os recursos anteriores
   continuam disponíveis. `/health` permanece uma checagem do processo; valide
   também uma leitura autenticada de `/api/v1/architecture/applications`.
6. Inicialize opcionalmente as oito aplicações conhecidas por `ROUTE_PRODUCTS`:

```sh
npm run architecture:db -- seed-applications
```

O comando preserva IDs existentes. Novas entradas começam com estado `unknown`,
sem responsável ou repositório inventado. Cada inserção tem histórico próprio;
se interrompido, pode ser repetido. `shared` é escopo de padrão (`applicationId:
null`), não uma aplicação. Componentes e dependências exigem levantamento real.

## Arquivamento dos JSONs atuais

```sh
npm run architecture:db -- preview /data
npm run architecture:db -- status
npm run architecture:db -- import /data HASH_DA_PREVIA REVISAO "Preservar fontes existentes"
```

Prévia não exige conexão ao banco e não imprime conteúdo dos arquivos. Importação
exige o mesmo hash e a revisão atual; grava tudo em uma transação. Nova importação
dos mesmos arquivos não duplica registros nem avança a revisão. Arquivos alterados
geram novas capturas. Os JSONs originais não são modificados, e seus consumidores
continuam usando os armazenamentos atuais.

A lista permitida inclui `policies.json`, `suite.json`, `client-contracts.json`, `runs-index.json`,
`route-inventories/`, `product-contexts/` e `runs/`. Links simbólicos e arquivos
fora da raiz são rejeitados. Limites: 10 mil arquivos, 16 MiB por arquivo e 128 MiB
por importação. O hash é dos bytes originais; JSONB preserva o conteúdo semântico,
não a formatação. A cópia de segurança dos arquivos continua necessária para
recuperação byte a byte. Fontes podem conter dados privados e exigem o mesmo
controle de acesso e retenção do volume original.

## API e consultas parametrizadas

Contrato completo: `/openapi.json`; schemas dos registros:
`GET /api/v1/architecture/schemas`.

| Método e caminho | Uso |
| --- | --- |
| GET /api/v1/architecture/{entidade} | Busca `q`, paginação `limit` e `offset` |
| PUT /api/v1/architecture/{entidade} | Criação/atualização com `record` e `changeNote` |
| GET /api/v1/architecture/{entidade}/{id}/history | Histórico paginado |
| GET /api/v1/architecture/reports/coverage | Cobertura por aplicação/padrão |
| GET /api/v1/architecture/reports/dependency_map | Contratos e consumidores |

Entidades usam os nomes das nove primeiras tabelas. Campos JSON são camelCase;
IDs são slugs de até 80 caracteres. Campos anuláveis devem ser enviados com `null`.
Consultas retornam `revision`, `total`, `limit`, `offset` e `items`, além de ETag.
Escritas exigem `If-Match: "<revision>"`; falta de cabeçalho retorna 428 e revisão
desatualizada retorna 412. Releia o catálogo antes de repetir. Campos extras,
referências inválidas e vínculos entre aplicações incompatíveis são rejeitados.

Todas as entradas SQL são parâmetros `$1`, `$2`, etc. Identificadores vêm de uma
lista fixa no código, nunca da entrada SQL enviada pelo usuário. Transações usam
uma única conexão. Escritas bloqueiam a revisão global; leituras de página usam
snapshot consistente. O histórico identifica `shared-api-credential`, sem atribuir
falsamente a alteração a uma pessoa. Não há exclusão via API.

Exemplo de consulta direta, usando node-postgres e a conexão restrita:

```js
const result = await pool.query(
  'SELECT * FROM experiments_architecture.coverage WHERE application_id=$1 ORDER BY standard_id LIMIT $2 OFFSET $3',
  ['erp', 25, 0],
);
```

A busca atual é uma busca textual simples sobre o registro e não um índice de
busca para milhões de itens. É adequada ao catálogo de arquitetura; cadastros
operacionais volumosos continuam nos bancos das aplicações.

## Verificação e recuperação

`npm test` executa validação de contrato e regressões existentes. Para integração,
use um banco descartável vazio e configure `ARCHITECTURE_TEST_DATABASE_URL` antes
de executar `node --test test/architecture.test.mjs`. O teste não apaga schemas e
recusa catálogo já populado. O CI possui um job obrigatório no empacotamento com
PostgreSQL 18, independente do teste local opcional.

Antes de aplicar em produção, faça backup e valide restauração. Para desativar o
recurso, retire a variável da API e restaure a imagem anterior; preserve banco e
JSONs. Não há migração destrutiva de retorno. Alterações futuras precisam de
migrações novas e plano de recuperação próprio. Publicação e execução da migração
no servidor são etapas operacionais explícitas, separadas do merge.
