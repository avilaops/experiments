# Implantação do executor e do inventário de rotas — 27/10/2026

## Revisão e validação

- Revisão implantada: `5b89544c9589aa322b805298e4d328b6515d4e3a`.
- Integração: [PR #3](https://github.com/avilaops/experiments/pull/3), incorporado à main.
- [CI da main](https://github.com/avilaops/experiments/actions/runs/40600115055):
  200 testes núcleo/API, 14 painel e 12 Chromium aprovados, sem falhas.
- O roteiro adicional `scripts/ui-check.mjs` também passou na CI.
- Artefato GitHub `12777429684`, `release-5b89544c9589aa322b805298e4d328b6515d4e3a`.
- Hashes de `images.tar.gz`, `compose.yaml` e `REVISION` conferidos localmente
  e novamente no servidor antes de carregar as imagens.
- Os PRs anteriores #1 e #2 estão contidos na integração. O #2 foi encerrado
  após a conferência de que não havia commits novos em relação à main.

A integração preserva a prévia e a importação atômica de políticas, os registros
de inventário dos produtos e `Cache-Control: no-store, no-transform`. Os testes
do proxy verificam a preservação do ETag usado em `If-Match`.

## Implantação e preservação

Destino: `/opt/avila-experiments`, host `apps-noclient`. O acesso SSH direto
expirou durante a preparação; a implantação usou `orchestrator` como salto SSH,
sem alterar firewall ou configuração dos servidores.

As imagens foram construídas no GitHub. O servidor executou `docker load` e
`docker compose ... up -d --no-build --wait`; API e painel ficaram saudáveis.
Os dois contêineres usam tags da revisão implantada, conferidas após a atualização.

- Revisão anterior: `bf2b9a974bdc5939e52f8cd2c6e488a2257b71fa`.
- Backup: `/opt/avila-experiments/backups/before-5b89544c9589aa322b805298e4d328b6515d4e3a/data.tar.gz`.
- O arquivo de backup foi listado e seu SHA-256 foi conferido.
- `suite.json`, `runs-index.json`, a execução persistida e `policies.json`
  mantiveram os hashes registrados antes da troca de imagens.
- O script de implantação mantém rollback para a revisão anterior em caso de
  falha durante a atualização; as imagens e o compose anterior foram preservados.

A transmissão inicial pelo pipeline PowerShell acrescentou um CR após o fim do
script, produzindo código 127 depois de concluída a atualização. Não se repetiu
a implantação. Uma conferência SSH independente confirmou revisão, imagens,
saúde dos serviços e os hashes dos dados e do backup, todos corretos. O helper
local de transporte passou a usar stdin binário com LF para próximas execuções.

## Conferência autenticada em produção

Tela: <https://ml.avilaops.com/experiments/routes>.

Foi importada a captura real de fontes do checkout do ERP, sem modificar seu código:

- Execução: `4562ac31-30e6-4fcc-b357-1800824ca2c5`.
- Commit observado: `4eaff3a7dbf7fee985335f99fbb8f0723a078eff`.
- Checkout com alterações, declarado no relatório e no painel.
- Fingerprint das fontes capturadas:
  `ed106053bcc70bed5c352ba9f58257bbc79b7ce3ea3304867095d5c37e871b25`.
- 166 páginas, 30 caminhos BFF e 50 métodos BFF declarados: 216 registros no painel.
- API não capturada; todos os registros mantêm `verification: not_run`.
- Inventário do ERP na revisão 1; arquivo persistido com permissão 600.
- SHA-256 de `route-inventories/erp.json` após a importação:
  `63e416ca3f96571209066224eeb2e5aeaffc9cf6ac63770313894605b15a6cee`.

O navegador autenticado conferiu importação real pelo BFF, ETag `"1"`, filtros
por camada e método, busca sem resultados, recarga e CMS ainda sem captura.
Foram conferidos desktop e viewport de 390 px, sem overflow horizontal e sem
erros de página. Acesso anônimo à tela, leitura e importação retorna 401.

A reimportação de conferência do próprio caderno criou zero fichas e preservou
as 16 fichas, revisão 2, catálogo e histórico completos. O ETag `"2"` atravessou
o proxy sem transformação; prévia inválida retornou 400. O hash de
`policies.json` permaneceu
`0215d4a9a4d9cf1136a11c310582badc0003933165bd05d2ba8cfd1fe3f16018`.
As seis evidências públicas também foram conferidas por tamanho e SHA-256,
com as fronteiras privadas mantendo autenticação.

Relatórios brutos de captura e screenshots autenticados ficam nos diretórios
privados ignorados `reports/flow-verification/` e `var/routes-live-*` do checkout
de verificação, sem integrarem a seleção pública de evidências.

## Limites e continuação

O fingerprint cobre arquivos de páginas/rotas capturados e eventual contrato
OpenAPI; não cobre todos os componentes, helpers, código Rust ou banco de dados.
As leituras repetidas conferem consistência nos intervalos observados, sem
representar snapshot atômico ou teste de comportamento do ERP.

O executor instrumentado e o armazenamento de reservas integram a biblioteca.
Os testes incluem efeitos reais locais de HTTP e filesystem, reinício de
processos, concorrência, falha após efeito e reconciliação autorizada. Não foi
configurado adaptador de produto em produção ou staging por esta implantação.

Continuam pendentes integrações reais autorizadas de ferramentas, captura de
contratos das APIs e evidências funcionais por fluxo e produto. Presença de uma
rota, export sintático de handler e importação de um relatório não aprovam um
fluxo empresarial. Esta etapa permaneceu no laboratório.
