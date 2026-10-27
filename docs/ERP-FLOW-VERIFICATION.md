# Inventário reproduzível de rotas e verificação de fluxos

Referência: [Levantamento backend no Linear](https://linear.app/avilaops/document/027651cb-8e29-4917-8bc6-0c442eaf8985).
O inventário é a entrada da verificação. Encontrar uma rota, um método exportado
ou uma referência literal não comprova que uma operação funciona.

## Executar

```powershell
npm ci
npm run inventory:erp -- D:\Projetos\SaaS\erp-next
npm run inventory:erp -- D:\Projetos\SaaS\erp-next --openapi-url http://127.0.0.1:18081/openapi.json
npm run inventory:erp -- D:\Projetos\SaaS\erp-next --openapi-file C:\contratos\openapi.json
```

A API é opcional. Sem contrato, as contagens da API permanecem `null`.
O modo HTTP aceita apenas IP literal de loopback, HTTP e `/openapi.json`, sem
credenciais, query, fragmento ou redirecionamento. A captura só faz GET desse
contrato. Não executa CRUD, não inicia serviços nem acessa dados empresariais.

Cada execução grava um diretório privado novo em
`reports/flow-verification/<runId>/`. O `inventory.json` usa
`route-inventory/2`. Se houver contrato, `openapi.json` preserva exatamente os
bytes recebidos: o hash no relatório corresponde ao arquivo arquivado. Não há
publicação automática desses artefatos; descrições e exemplos do contrato podem
conter informações internas. Proteger a pasta por ACL no Windows.

## Consultar no laboratório

O link **Rotas por produto**, em `/experiments/routes`, permite escolher ERP,
CMS, CRM, Lojas, Mail, TMS ou Experiments. A tela lista todos os registros
importados, com filtros de camada, método e busca por caminho, operação ou fonte.
Uma linha de BFF/API representa um método; páginas aparecem separadamente.
As contagens pertencem à captura importada, não a uma descoberta contínua.

Para o ERP, gere o relatório com o comando acima, abra o laboratório autenticado,
selecione **Ávila ERP** e escolha `inventory.json` em **Importar inventário JSON
para este produto**. A seleção determina o produto de destino; o coletor atual
é específico da árvore Next.js do ERP. Outros produtos precisam de coletores
compatíveis antes de terem seus próprios inventários.

Produtos sem captura aparecem como **Inventário pendente**. Um contrato ausente
aparece como **API não capturada**, mesmo quando existem páginas e BFF. Todos os
registros importados recebem **Não testado**. Não são importados verdicts de
fluxos declarados no arquivo. Reexportações pendentes também exigem revisão.

A API privada expõe `GET /api/v1/route-inventories` e
`GET /api/v1/route-inventories/{product}`. `PUT` no segundo caminho importa uma
projeção do relatório, com JSON de até 1 MiB e `If-Match` da leitura anterior
(`"0"` quando não há captura). Resposta `412` preserva a versão atual. A captura
mais recente substitui a anterior; não há histórico de inventários nesta versão.
O serviço persiste apenas os campos necessários à consulta, em arquivos privados
sob `LAB_DATA_DIR/route-inventories/`. Não inclui a raiz absoluta do checkout,
corpos de contrato ou campos arbitrários do relatório. Usar uma única instância
do escritor no volume, conforme o restante do armazenamento local do laboratório.
As credenciais do laboratório têm acesso administrativo a todos os produtos;
isso não implementa os papéis ou o isolamento entre empresas do ERP.

## Consistência da captura

1. Registrar HEAD, estado dirty e SHA-256 do status Git completo, incluindo
   arquivos não rastreados.
2. Inventariar arquivos de página e handlers com SHA-256 e metadados de identidade,
   tamanho, modo, mtime e ctime. Conferir esses metadados antes/depois da leitura
   e pelo descritor aberto. Conferir também os diretórios visitados.
3. Capturar e validar o contrato opcional.
4. Repetir a varredura das fontes e a captura do contrato; fazer uma terceira
   varredura das fontes e comparar o estado final do Git.
5. Recusar a captura quando houver divergência, sem declarar o relatório estável.

Essas verificações observam intervalos de leitura. Não travam o checkout nem
produzem um snapshot atômico do sistema de arquivos. Para uma reprodução mais
controlada, usar checkout exclusivo de commit fixado e contrato arquivado.
Não usar um checkout que esteja sendo modificado por outros processos para
afirmar uma captura imutável.

O fingerprint de conteúdo cobre arquivos `page`/`route` nas extensões padrão
TS/JS e o contrato opcional. Não cobre componentes importados, helpers,
implementação Rust, dependências, banco ou todos os arquivos do repositório.
O fingerprint dos metadados é separado: timestamps não alteram o fingerprint de
conteúdo. O status Git detecta mudanças de estado/caminho fora das rotas, mas
pode não mudar quando o conteúdo de um arquivo já dirty é novamente editado.
Esse limite aparece no próprio relatório.

## Identificação das rotas

Grupos como `(privado)` são retirados do caminho público. A normalização mantém
distintas as formas `[id]`, `[...partes]` e `[[...partes]]`, mas remove o nome
do parâmetro para comparar padrões equivalentes. Assim, `[id]` e `[slug]`
geram conflito quando representam o mesmo padrão na mesma camada.

Fontes conflitantes são preservadas, com `conflicts` e suas origens; não são
silenciosamente fundidas. `pages` conta arquivos candidatos, enquanto
`uniquePagePatterns` conta padrões normalizados. Isso não afirma que um build
do Next.js aceitaria a árvore. Rotas paralelas/interceptadas e symlinks
encontrados recebem aviso e não são percorridos como rotas comuns.

Middleware, rewrites, métodos implícitos do Next.js, `pageExtensions` customizado
e todas as regras de precedência do roteador exigem análise adicional.

## Handlers: declaração e função identificável

A análise usa a AST TypeScript, sem executar os módulos:

| Situação | Resultado |
| --- | --- |
| Função, arrow ou alias local resolvido até função | `callable`, apenas por análise sintática |
| Número, objeto ou outra expressão claramente não funcional | `not_callable` |
| Binding importado, factory, expressão calculada ou reexportação externa | `needs_review` |
| Wildcard, destructuring, erro sintático ou exportação duplicada | Aviso explícito |

`declaredMethods` e `methods` têm funções diferentes. O primeiro registra nomes
HTTP exportados; o segundo contém somente as funções identificadas na fonte.
As contagens também distinguem métodos declarados dos estaticamente chamáveis.
Assinatura aceita pelo framework, autorização e comportamento continuam dependendo
de build e testes. Uma função que lança erro ainda pode ser sintaticamente chamável.

## OpenAPI

O validador está fixado em `@apidevtools/swagger-parser@13.1.0`, no lockfile.
Ele valida a estrutura do documento OpenAPI 3.0/3.1, resolve referências internas
para extrair as operações e mantém referências circulares de schemas quando
necessário. Referências externas são recusadas antes da resolução e os resolvers
de HTTP e arquivo estão desativados. Não há leitura automática de arquivos ou
URLs apontados pelo contrato.

As operações são registradas individualmente por caminho, método e `operationId`.
IDs repetidos são recusados; IDs ausentes e caminhos equivalentes geram avisos.
Validação de schema não garante toda a semântica da especificação, todos os
formatos JSON Schema, a regra de negócio ou o comportamento do backend. O contrato
de um processo local também não identifica sozinho o commit que gerou seu binário.

## Relações entre camadas

O relatório distingue o inventário das relações e dos resultados funcionais:

| Confiança | Interpretação nesta versão |
| --- | --- |
| `confirmed` | Referência literal na fonte de uma página ao caminho/método declarado de um BFF chamável |
| `probable` | Método/URL compatível, argumento literal de `forwardErp` ou convenção de prefixo do ERP |
| `unidentified` | Não há correspondência estática suficiente ou o contrato não foi capturado |

`confirmed` confirma uma referência literal observada, não a execução da chamada
ou a resolução do símbolo em todos os contextos. Código morto ou uma função
local chamada `fetch` também exige revisão. Componentes importados e caminhos
construídos dinamicamente não são seguidos. BFF → API permanece uma relação
provável: o inventário não prova a implementação do helper de encaminhamento.

## Matriz funcional e ML

O plano inicial de produto está em `examples/flows/erp-products.json`, com oito
dimensões: interface, requisição, autorização, domínio, persistência, efeitos,
falhas e resposta. Sem observações executadas, o resultado é `not_run`.

`assessFlow` exige vínculo entre plano, execução, fingerprint e ambiente.
Evidência estática ou `model_suggestion` não aprova um check que exige
`runtime_assertion`. A avaliação de observações declaradas não autentica sua
origem nem comprova a veracidade de um hash de artefato fornecido pelo chamador.
`verifyFlowArtifact(observation, bytes)` recalcula o SHA-256 dos bytes fornecidos
e detecta divergências. Esse helper não autentica a origem nem interpreta o
conteúdo. Adapters confiáveis precisam capturar e verificar os artefatos de
testes reais antes de fornecer as observações. Os testes unitários de
`assessFlow` usam evidências simuladas para conferir essas regras; não testam
autorização, dados ou persistência do ERP real.

ML pode futuramente sugerir cenários, agrupar falhas e priorizar investigações.
Não há modelo treinado ou executado nesta entrega. Os próximos adapters devem
capturar navegador, HTTP, autorização e consultas ao banco em um ambiente de
teste controlado, preservando cenários negativos, revisão e efeito esperado.

## Diagnóstico e testes

Uma falha do CLI produz JSON `inventory-error/1`: etapa, código, tipo de causa
permitido, código de sistema conhecido e indicação de nova tentativa quando
aplicável. Mensagens brutas, corpos, URLs e segredos da exceção não são impressos.

```powershell
npm test
node --test test/flow-verification.test.mjs test/route-inventory.test.mjs
```

Os testes cobrem grupos, parâmetros equivalentes, catch-all, paralelas,
interceptadas, symlinks, aliases, factories, reexportações, contratos inválidos,
referências internas/externas, mudanças durante a captura, diagnóstico seguro
e a separação entre inventário e verificação funcional.

## Teste de integração da interface local

```powershell
npm run test:ui:local
```

O comando gera os dois builds antes de executar `scripts/ui-check.mjs`.
Instale o Chromium com `npm --prefix dashboard exec -- playwright install chromium`
após instalar as dependências. `PLAYWRIGHT_CHANNEL=chrome` é uma opção explícita
para máquinas com Chrome. O CI instala o Chromium do Playwright.

O teste inicia API e BFF em portas atribuídas pelo sistema, sem fechar/reabrir
uma porta reservada. Sem origem configurada, o BFF aceita somente a origem
HTTP exata do seu endereço de loopback; não deriva confiança do cabeçalho Host.
A implantação continua usando `PUBLIC_ORIGIN` explícita.

Cada execução salva screenshots e `result.json` em `reports/ui-check/<runId>/`,
com commit, indicador dirty, ambiente local, IDs das execuções, `pageErrors` e
`consoleErrors` separados. O conflito `412` é esperado e registrado. Dados
temporários são removidos mesmo quando a inicialização falha. `KEEP_UI_DATA=1`
preserva os dados para diagnóstico e registra seu diretório no resultado privado.
`ERP_INVENTORY_REPORT` pode apontar para uma captura real para testar também sua
importação pela interface e salvar screenshots da listagem.

Esse teste cobre o laboratório local. Os cenários negativos do ERP (sem sessão,
sem permissão e empresa diferente), persistência e efeitos reais do ERP exigem
um adapter e um ambiente isolado com identidades/dados de teste autorizados.
Permanecem não executados nesta entrega.
