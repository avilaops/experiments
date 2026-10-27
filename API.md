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
