# Coleta reproduzível da documentação do Siscomex

## Executar

```powershell
cd D:\Projetos\avila-experiments
npm run collect:siscomex -- D:\Projetos\Docs\Siscomex
```

O coletor começa pela raiz do portal, pela documentação da Sefaz e pelo contrato
da nova API. Descobre links HTML, iframes e referências `url` dos wrappers Swagger.
Aceita apenas o domínio oficial por HTTPS, sem credenciais ou query strings.
Não chama os serviços operacionais, não envia certificados e não executa scripts.
Redirecionamentos do próprio domínio que apontam para HTTP são convertidos para
HTTPS antes de qualquer requisição. Destinos externos são recusados.

Cada execução cria uma pasta nova, sem sobrescrever as anteriores:

- `README.md`: índice de contratos e falhas com links locais e oficiais.
- `manifest.json`: origem, status, tamanho, SHA-256, arquivo e pendências por URL.
- `objects/`: bytes originais, nomeados pelo hash com extensão correspondente.
- `contracts.json`: operações, parâmetros, respostas e segurança declarada.
- `changes.json`: comparação de hashes com a última coleta completa.
- `policies.proposed.json`: propostas de avaliação por contrato para o caderno.

`latest.json` aponta para a última coleta completa. Uma falha ou o limite de
1.200 endereços resulta em código de saída 1 e não substitui esse checkpoint.
Há quatro requisições simultâneas, até três tentativas por endereço, timeout de
30 segundos por tentativa e limite de 12 MiB por documento.

## Limites de interpretação

Completa significa que os links descobertos foram processados sem falhas. Não
significa que todo conteúdo existente no portal foi encontrado: links gerados
somente por JavaScript e áreas autenticadas ficam fora desta coleta. HTML bruto
pode depender de recursos remotos para ser exibido; não é um site offline completo.

A comparação registra alterações nos bytes e contratos anteriormente encontrados
que não apareceram na execução atual. Não classifica compatibilidade ou validade
fiscal. Referências `$ref` permanecem no inventário; o JSON original guarda as
definições completas. Ausência de `securityDefinitions` não comprova acesso
anônimo: os contratos podem exigir cabeçalhos de autenticação como parâmetros.

As fichas geradas são propostas para revisão, com fonte e hash. Não representam
regras já adotadas no ERP nem conformidade verificada. A importação é explícita:

```powershell
node scripts/import-policies.mjs D:\Projetos\Docs\Siscomex\<execucao>\policies.proposed.json --preview
```

O importador preserva identificadores existentes, inclusive suas edições. Por
isso, uma coleta posterior não atualiza automaticamente uma ficha já cadastrada.
O relatório `changes.json` orienta a revisão. Não há agendamento ou implantação
remota adicionados por esse comando.

## Referências de domínio

A [documentação da Sefaz](https://docs.portalunico.siscomex.gov.br/api/dimp/sefaz/)
trata de DUIMP e recomenda a API nova; novos atributos não são incorporados à
versão legada. Isso não a transforma em uma API geral de NF-e ou de tabelas de
impostos. Perfil e autorização operacional precisam ser analisados para cada
integração. A coleta inclui também os contratos de intervenientes privados,
catálogo de produtos, classificação fiscal, tabelas Comex e tratamento tributário,
descobertos na navegação pública.
