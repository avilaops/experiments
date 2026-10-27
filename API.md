# API do laboratório

Extensão em desenvolvimento sobre o núcleo 0.3.0. Os arquivos `.tgz` e ZIP já
existentes não foram substituídos e não contêm necessariamente esta extensão.

## Executar

Requer Node.js 24 ou superior. Dentro de `experiments`:

```powershell
npm ci
npm test
npm run api
```

Acesse <http://127.0.0.1:3300/>. A página inicial contém links para os dados JSON.
O contrato completo está em <http://127.0.0.1:3300/openapi.json>.

## Rotas

| Método | Caminho | Uso |
| --- | --- | --- |
| GET | `/` | Página inicial com links |
| GET | `/health` | Saúde e indicação de autenticação |
| GET | `/openapi.json` | Contrato OpenAPI 3.1 |
| GET | `/api/v1/suite` | Suíte atual, parâmetros e cabeçalho ETag |
| POST | `/api/v1/policies/import/preview` | Validar arquivo de fichas sem gravar; retorna prévia e ETag |
| POST | `/api/v1/policies/import` | Importar somente códigos novos com If-Match e motivo, em uma única gravação |
| PUT | `/api/v1/suite` | Salvar suíte usando o ETag no cabeçalho If-Match |
| POST | `/api/v1/runs` | Executar base e candidata; corpo `{"revision":1}` |
| GET | `/api/v1/runs?limit=25&offset=0` | Histórico paginado |
| GET | `/api/v1/runs/{id}` | Evidência completa com snapshot da suíte |
| POST | `/api/v1/comparisons` | Comparar variantes de execuções persistidas |

```powershell
$labBase = 'http://127.0.0.1:3300'
$suite = Invoke-RestMethod "$labBase/api/v1/suite"
$run = Invoke-RestMethod "$labBase/api/v1/runs" -Method Post `
    -ContentType 'application/json' `
    -Body (@{ revision = $suite.revision } | ConvertTo-Json)
$run.candidate.summary
Invoke-RestMethod "$labBase/api/v1/runs/$($run.id)"
```

Para comparar, envie `baseline` e `candidate`, cada um com `runId` e `variant`
(`baseline` ou `candidate`). Se as premissas diferirem, `comparable` será `false`.
Um HTTP 201 confirma o registro da execução; a aprovação está em `summary.verdict`.

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| LAB_HOST | `127.0.0.1` | Interface de escuta |
| LAB_PORT | `3300` | Porta |
| LAB_DATA_DIR | `experiments/var/lab` | Persistência de suíte e execuções |
| LAB_API_TOKEN | Ausente | Bearer exigido em todas as rotas de dados quando definido |
| LAB_ALLOWED_ORIGINS | Vazio | Origens HTTP(S) exatas, separadas por vírgula |

A CLI exige token ao escutar fora do loopback. Em Docker, use `LAB_HOST=0.0.0.0`,
token injetado como segredo e volume persistente em `LAB_DATA_DIR`. Publique a porta
somente no loopback do host e use proxy autenticado. Nunca coloque o token no bundle
do navegador. Saúde, contrato e página inicial não retornam dados de experimentos.

## Limites

- Um processo de API e uma execução por vez. Não use réplicas compartilhando estes
  arquivos: a coordenação de edições ocorre apenas dentro do processo.
- O histórico usa `runs-index.json`, um índice derivado de resumos. Na inicialização,
  volumes antigos e gravações interrompidas são reconciliados com `runs/`, lendo
  sequencialmente apenas os relatórios ausentes do índice. Consultar uma página
  não abre os relatórios completos. O backup deve preservar o volume inteiro;
  o índice pode ser reconstruído a partir das evidências originais.
- Até 200 casos, 10 repetições e corpo de requisição de até 1 MiB.
- Revisão desatualizada ao salvar retorna 412; ao executar, 409. Recarregue os dados.
- O laboratório executa apenas operações numéricas predefinidas. Não aceita código
  arbitrário, prompts ou acesso remoto a Annif, Ultralytics, TensorFlow ou THESEUS.
- O cenário `pathFidelity` continua disponível em `npm run test:path`; não há rota
  HTTP para executar esse cenário nesta extensão.
- Relatórios preservam entradas e referências. O arquivo local não tem proteção
  contra alteração por um administrador do disco e não equivale a um log inviolável.
- Custos e tokens ausentes permanecem `null`. Estes casos são de desenvolvimento,
  sem evidência de generalização ou benchmark estatístico de latência.

Para o painel e a publicação, consulte [DEPLOYMENT.md](DEPLOYMENT.md).

## Importação de políticas

Envie `{ "document": [...] }` à prévia. `document` aceita uma lista de fichas
sem metadados ou a exportação completa do caderno. A resposta contém `revision`,
`createCount`, `preserveCount` e itens com `policy`, `action` e `different`.
`different` informa que o arquivo difere da ficha existente, que será preservada.

Para gravar, envie o mesmo `document` e `changeNote` para `/api/v1/policies/import`,
com o ETag da prévia em If-Match. A resposta contém `catalog`, `created` e
`preserved`, com o ETag resultante. Cada lote com fichas novas aumenta a revisão
uma vez e registra um snapshot por ficha. Lote só com códigos existentes não
grava nem altera a revisão. A API valida todos os registros novamente no commit.

Sem If-Match: 428; revisão desatualizada: 412; ficha, motivo, limite ou formato
inválido: 400. Os limites continuam sendo 1 MiB por requisição e 500 fichas no
caderno. A recusa de um lote não cria nenhuma de suas fichas. Versões e histórico
de uma exportação não são restaurados. Os endpoints exigem a mesma autenticação
das políticas e o BFF conserva o token fora do navegador.
