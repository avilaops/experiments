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

## Consulta visual e para agentes

A tela privada `/experiments/flows` lê o mesmo endpoint pelo BFF autenticado,
somente com GET. Mostra as funcionalidades da captura, sequência quando
declarada, árvore de dependências navegável, ações, telas, permissões e
decisões pendentes. A cor de uma declaração não comprova execução do produto.

`view=flows` produz `erp-product-flow-view/1`. `sha256` fixa uma captura antiga;
sem hash, usa a última importação. `mode=published` seleciona apenas a última
observação registrada de publicação; não encontrar uma retorna 404. O seletor
mostra no máximo 50 capturas recentes, preservando a leitura por hash das antigas.
Uma observação é histórica, com data, e não garante a versão servida agora.

`view=index` omite os contratos das ações. Para preparar uma tarefa, consulte o
índice e use `view=context&sha256=<hash>&flow=<id>`. A projeção inclui os
contratos canônicos da funcionalidade e suas dependências transitivas. O SHA
e o manifesto de fontes identificam a captura completa original. Não são um
novo hash da projeção nem um grafo completo de dependências de execução.

`LAB_ERP_CONTEXT_READ_TOKEN`, quando configurado, só permite GET nesse endpoint.
Precisa ser diferente dos tokens administrativo e de importação. Serve para
conectores de consulta; não pode publicar contextos ou acessar suítes e políticas.
Os campos de dados continuam vindo do contexto canônico, sem inventar schemas
dos tipos Rust referenciados pelas ações.

Os grupos `pendingFlows` são exibidos separadamente. Não existe uma associação
explícita de cada grupo com as funcionalidades, portanto o consumidor não cria
essa associação por similaridade de nomes nem acusa falhas no Auth por inferência.

Para a revisão local com uma captura real e sem executar o ERP, compile núcleo e
dashboard e execute `node scripts/review-product-flows.mjs CAMINHO/context.json`.
Os screenshots e o resultado ficam em uma pasta exclusiva de `reports/flows-review`.
