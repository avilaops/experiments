# Importação revisada de fichas pelo painel

## Entrega implantada

- Revisão: `bf2b9a974bdc5939e52f8cd2c6e488a2257b71fa`.
- CI da main: <https://github.com/avilaops/experiments/actions/runs/40574013333>.
- Artefato utilizado, do mesmo commit:
  <https://github.com/avilaops/experiments/actions/runs/40573323465>.
- Servidor: `apps-noclient`; API e painel saudáveis após a atualização.
- Painel privado: <https://ml.avilaops.com/experiments/policies>.

## Comportamento

"Importar fichas JSON" aceita uma lista de fichas ou a exportação do próprio
caderno. Arquivo e requisição são limitados a 1 MiB; cada lote contém de uma a
500 fichas e o cadastro permanece limitado a 500 códigos distintos.

A prévia valida todas as fichas antes de qualquer gravação e mostra quais códigos
serão cadastrados ou preservados. Dados diferentes para um código existente são
indicados e a ficha atual é preservada integralmente. O motivo e a conferência
explícita são obrigatórios. Enquanto houver uma operação pendente, os controles
ficam bloqueados. Editor e importador não ficam abertos simultaneamente.

O If-Match vincula a confirmação à revisão da prévia. Um conflito 412 exige
atualizar a prévia e conferir novamente, conservando o documento e o motivo.
Não há repetição automática de gravações. Um lote válido cria todos os códigos
novos por uma única substituição atômica do catálogo e incrementa sua revisão
uma vez. Cada ficha nova começa na versão 1 e recebe um registro de histórico.

Reimportar somente códigos existentes não grava o catálogo nem altera revisão,
versões ou histórico. Importar uma exportação transfere os campos atuais das
fichas, sem restaurar revisão, versões ou histórico antigos. O CLI anterior
continua sequencial e tem comportamento documentado separadamente.

## Falha de transporte corrigida

A conferência inicial em produção encontrou uma resposta de prévia com ETag
`"1-zstd"`. A confirmação enviou esse valor em If-Match e recebeu 400, pois a API
aceita o ETag numérico da revisão. O proxy havia transformado o ETag durante a
compressão. Nenhum registro foi criado nessa tentativa.

Respostas JSON da API e do BFF agora enviam
`Cache-Control: no-store, no-transform`, preservando o ETag esperado. A resposta
real após a correção trouxe `"1"`, sem Content-Encoding. O comportamento do Caddy
e o respeito a no-transform foram conferidos no
[código oficial do módulo encode](https://github.com/caddyserver/caddy/blob/master/modules/caddyhttp/encode/encode.go).

O teste de regressão usa um proxy HTTP que comprime respostas e modifica ETags
quando no-transform está ausente. Verifica leitura e gravação da suíte, leitura
do catálogo, prévia e confirmação da importação. O contrato de revisão permanece
estrito; a correção não modifica o If-Match recebido nem a configuração do proxy.

## Verificação

- CI: 127 testes do núcleo/API, 13 do painel/BFF e 11 no Chrome, todos aprovados.
- Lotes inválidos, códigos repetidos, capacidade, autorização, origem e limites
  de transporte são recusados antes de persistir alterações.
- Criação atômica, preservação de fichas, persistência após reinício, concorrência,
  renovação da confirmação e reimportação da exportação foram testadas com dados
  temporários, usando API e BFF reais.
- No domínio implantado, a conferência autenticada selecionou a exportação das
  oito fichas existentes, conferiu a prévia e enviou a confirmação real. Resultado:
  zero fichas criadas, oito preservadas, revisão 1 antes e depois. Catálogo e
  histórico foram comparados integralmente e permaneceram iguais.
- Prévia e importação sem autenticação retornaram 401. Uma prévia inválida
  autenticada retornou 400. A especificação OpenAPI expôs a nova operação.
- Navegador móvel em 390 px: sem overflow horizontal e sem erros JavaScript.
  A captura após a confirmação e o JSON da verificação ficaram somente em
  `var/policy-import-live-47aff4fe-18b0-44a7-979c-503c25940f4b/`, no checkout de
  revisão, fora do Git e da exportação pública.
- Os seis artefatos públicos conservaram seus hashes e as fronteiras de acesso
  pública e privada passaram na verificação HTTP.
- O checkout principal recebeu as alterações preservando o executor de
  ferramentas da outra sessão; seus 154 testes do núcleo/API passaram localmente.
  Esse executor não foi incluído nas imagens desta publicação.

## Dados e recuperação

As imagens foram construídas na CI. Os três hashes do pacote foram conferidos
localmente e no servidor antes de carregar as imagens e usar Compose com
`--no-build`. Nenhum build foi executado no servidor.

O backup foi criado com API e painel parados e seu arquivo foi validado antes da
troca. Após a atualização e novamente após a importação sem mudanças, os hashes
de `policies.json`, `suite.json`, `runs-index.json` e do run
`d7acfbe0-145b-4e48-8084-6e7586e5902a` permaneceram iguais.

Backup:

`/opt/avila-experiments/backups/before-bf2b9a974bdc5939e52f8cd2c6e488a2257b71fa/data.tar.gz`

A revisão anterior `0ad07f21b9aac9b74581f7043aaf67b666b1d60f`, suas imagens e seu
Compose continuam disponíveis. O retorno usa API_IMAGE e DASHBOARD_IMAGE com
as tags `sha-<revisão anterior>` e o Compose anterior no projeto
`avila-experiments`, com `up -d --no-build --wait`, preservando os volumes.
O script preparou esse retorno automático e concluiu sem acioná-lo.

## Limites e continuidade

O cadastro registra declarações manuais; importar não executa testes, autentica
fontes ou aplica regras nos produtos. A produção continua com as oito fichas
iniciais. Inventários de Mail, CMS, CRM e TMS e a atribuição de responsáveis
dependem de fontes conferidas; nenhum registro foi inventado para preenchê-los.
O piloto de contrato, autorização e CI de uma capacidade do ERP continua pendente.
