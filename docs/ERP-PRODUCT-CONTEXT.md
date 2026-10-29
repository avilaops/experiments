# Importação de contexto do ERP

`GET/PUT /api/v1/product-contexts/erp` aceita o token administrativo da API ou
o token exclusivo `LAB_ERP_CONTEXT_TOKEN`. O segundo só autoriza GET e PUT nesse
endpoint; não permite ler suítes, políticas ou alterar outros dados do laboratório.
O token da integração deve ser diferente do token administrativo.

O PUT exige `If-Match` com a revisão do GET e corpo
`{ "context": { ... }, "confirmPublication": false }`. O contexto completo
`erp-product-context/1` é validado com os schemas de intercâmbio distribuídos em
`schemas/erp`, referências internas e SHA-256 canônico. Não aceita a captura
parcial de uma funcionalidade nem verdicts de execução inventados.

Capturas são criadas exclusivamente em `product-contexts/erp/<sha256>.json` no
volume de dados. Os recibos e a revisão ficam juntos em `catalog.json`, trocado
por rename após a escrita da captura. Uma única instância deve escrever o volume.
Uma captura ainda sem recibo, deixada por interrupção, não aparece como importada.
Recibos e capturas anteriores são preservados, com limite operacional de 5.000
recibos antes de revisão da capacidade e do arquivamento.

Consultas com `?requestId=<sha256>` recuperam o recibo; `?sha256=<sha256>`
recuperam uma captura já importada, conferindo novamente seu conteúdo. Repetir
uma solicitação confirmada devolve o mesmo recibo, sem incrementar a revisão ou
trocar a cabeça por uma captura antiga. Dados divergentes não são substituídos.

`confirmPublication: true` exige `dirty: false`. O laboratório consulta
`https://erp.avilaops.com/api/health`, sem redirecionamento e com timeout, e
compara `ok`, `application` e `commit`. Só então registra `version_observed`
no recibo. O contexto continua com publicação e execução `not_observed` porque
é um artefato de fontes. A observação histórica da versão não testa o produto.

O proxy pode expor exclusivamente esse caminho à automação, preservando o
Bearer e a proteção dos demais caminhos. Segredos não pertencem ao código.
O cliente no ERP gera arquivos por hash, importa com revisão e confirma tanto
o recibo quanto os bytes lidos de volta antes de relatar sucesso.
