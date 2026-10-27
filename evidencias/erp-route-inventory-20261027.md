# Inventário de rotas do ERP — 27/10/2026

Entrega vinculada à [AVL-329](https://linear.app/avilaops/issue/AVL-329), usando
como referência o [levantamento backend](https://linear.app/avilaops/document/027651cb-8e29-4917-8bc6-0c442eaf8985).
O documento original foi preservado. Contrato, execução e limites do novo
inventário estão em [ERP-FLOW-VERIFICATION.md](../docs/ERP-FLOW-VERIFICATION.md).

## Captura observada

Comando: `node scripts/inventory-erp-routes.mjs D:\Projetos\SaaS\erp-next`.
Data UTC: `2026-10-27T20:01:42.682Z`.
Execução: `80a00013-c13d-43cc-8f7a-500f765aabb8`.

| Medida | Resultado |
| --- | ---: |
| Arquivos de página | 166 |
| Padrões de página distintos | 166 |
| Caminhos BFF | 22 |
| Métodos HTTP declarados | 33 |
| Métodos sintaticamente chamáveis | 33 |
| Conflitos detectados pelos critérios implementados | 0 |
| Itens de revisão de fontes detectados | 0 |
| Caminhos e métodos da API | `null`: contrato não capturado |
| Checks funcionais obrigatórios executados | 0 de 8 |
| Resultado do fluxo de produtos | `not_run` |
| Modelo de ML executado | Não |

HEAD do ERP: `4eaff3a7dbf7fee985335f99fbb8f0723a078eff`. O checkout estava
dirty antes e depois. HEAD, indicador dirty e hash do status Git coincidiram
nas duas observações. Os arquivos e metadados capturados coincidiram nas três
varreduras. O ERP foi somente lido por esta captura.

Fingerprint de conteúdo:
`6ce1737a84ece397855400fe10c9445f830aa4571aed0def77b1a0a27df3edb5`.
SHA-256 do relatório completo:
`80848173eea71095f3e3b6ec8d1ca31729b3a92b74cfe61f3c757470e89c2fa9`.
O relatório fica em `reports/flow-verification/<runId>/inventory.json`, excluído
do Git. Esta evidência registra o resultado observado e seu hash; não publica
as fontes ou os artefatos privados completos.

## Validação do código

`npm test`: 188 testes aprovados, sem falhas ou testes ignorados, incluindo o
build TypeScript. Desses, 37 cobrem inventário/avaliação de fluxos e quatro cobrem
o catálogo privado de rotas. A suíte
inclui alterações durante a leitura, mudanças de Git fora das rotas, symlinks,
parâmetros equivalentes, rotas especiais, aliases, reexportações, exportação
default, opções dinâmicas de fetch, referências OpenAPI, extensões `x-*`,
diagnóstico seguro e captura completa com contrato local de teste. Um servidor
HTTP de teste cobre status e tipo de conteúdo inválidos, redirecionamento sem
seguir destino, timeout e limite de tamanho. Evidências contraditórias, plano
alterado, IDs/status inválidos e hashes malformados são recusados. A verificação
dos bytes do artefato recalcula seu digest separadamente.

Os 12 testes do dashboard/BFF/exportação e oito testes Playwright passaram.
Os testes do catálogo conferem autenticação ausente/inválida, projeção dos
campos permitidos, persistência após reinício, produtos sem captura e conflito
de revisão. Os testes no navegador conferem a importação, os filtros, a troca
de produto, recarga e ausência de overflow em viewport mobile.

`npm run test:ui:local` também passou. O cenário valida IDs de novas execuções,
resultados adversariais por caso, gravação da edição concorrente, resposta 412
sem sobrescrita, preservação da edição local e comparação de dois IDs com
datasets diferentes. A inicialização e a limpeza ficam protegidas por finally,
incluindo falhas antes de abrir o navegador. Screenshots têm diretório único;
pageErrors e consoleErrors são campos separados.

Na execução local `3a160e76-4367-4708-883f-5a7915c15422`, a captura real acima
foi importada pela interface do laboratório: 199 registros, correspondentes
às 166 páginas e 33 métodos BFF. A API permaneceu não capturada. A importação
foi feita em dados temporários isolados, removidos ao final. O código estava
dirty nessa observação; não é uma evidência de implantação.

## Consulta por produto

A nova página privada `/experiments/routes` seleciona produto e filtra por
camada, método, caminho, operação ou fonte. Produtos sem captura ficam pendentes.
Uma importação mantém todos os registros como não testados e usa If-Match para
evitar substituir uma revisão mais recente. O inventário anterior é substituído;
esta versão não mantém histórico de inventários.

## Limites

O fingerprint cobre as fontes de página/handler capturadas e o contrato opcional.
Não cobre componentes importados, helpers, implementação Rust, banco ou todo o
checkout. A captura usa observações repetidas; não constitui snapshot atômico.
Um arquivo já dirty fora das rotas pode mudar de conteúdo sem mudar o status Git.

Contagens e relações estáticas não aprovam autenticação, autorização, domínio,
persistência, efeitos ou apresentação. A suíte do inventário usa fixtures para
testar o analisador; esses testes não são uma execução funcional do ERP.
Não houve implantação desta alteração ou geração de PDF fiscal nesta entrega.
