# Contrato de entrada fiscal 0.1

Estado: proposta executável de engenharia. Recorte inicial: simulação de venda
doméstica de mercadorias, em BRL, com modelo documental 55. Não é leiaute oficial
de NF-e, motor de impostos, contrato do Siscomex ou integração implantada no ERP.

O [JSON Schema](../schemas/fiscal-input.v0.1.schema.json) é a definição estrutural.
O [validador](../scripts/validate-fiscal-input.mjs) acrescenta verificações de
calendário, quantidade positiva, identificação única de linhas e contexto pendente.
Usa Ajv 8.20.0 como dependência de desenvolvimento; o núcleo do pacote não ganhou
dependência de execução nem novo endpoint fiscal.

## Campos e autoridade

| Grupo | Conteúdo | Limite |
| --- | --- | --- |
| Identificação | Versão, modo, requestId e tenantId | Declarados na entrada; autorização deve ser conferida no executor |
| Operação | Venda doméstica, documento, data, moeda, UFs da circulação e consumidor final | Data não é data da coleta; desconhecido é null onde permitido |
| Partes | Referências de cadastro, UF, contribuinte, regime e snapshot do perfil | Enumerações internas; não substituem CRT, IE, cadastros ou enquadramento oficial |
| Mercadoria | SKU, descrição, NCM, CEST, origem, CFOP e snapshot da classificação | Formato de código não comprova validade ou enquadramento |
| Valores | Quantidade, preço unitário, frete, seguro, desconto e outras despesas por linha | Strings decimais; não há soma, rateio, base tributária ou arredondamento implementados |
| Regras | Identificador, versão e SHA-256 do snapshot selecionado | Hash recebido não comprova existência, integridade, vigência ou aprovação da fonte |

`exempt_registration` representa uma declaração referente à inscrição, não
isenção de ICMS. O executor precisará resolver e validar referências dentro da
empresa autorizada; o validador local não consulta cadastro, banco ou rede.

São permitidas de uma a 10 mil linhas por documento experimental, com `lineId`
único. Um catálogo de 3 mil produtos não exige enviar os 3 mil em cada pedido:
o teste de 3 mil linhas verifica apenas o comportamento do validador nesse volume.
Não é benchmark de checkout, banco, cálculo ou carga concorrente.

## Dinheiro e dados desconhecidos

Quantidade e preço unitário aceitam até seis casas decimais e 18 dígitos inteiros.
Despesas e desconto aceitam duas casas, como `"0.00"`. São limites escolhidos para
este piloto, não afirmações sobre a precisão permitida em todos os documentos
fiscais. Importadores não devem arredondar dados silenciosamente para caber aqui;
um recorte com outra precisão exige revisão e versão do contrato.

Não são aceitos números JSON, notação exponencial, vírgula decimal ou valores
negativos nesses campos. A quantidade deve ser estritamente positiva. O programa
não converte dinheiro para Number e não decide como arredondar um tributo.

NCM, origem, classificação, perfil ou regras ausentes podem produzir pendências.
CEST e CFOP nulos são preservados para a futura resolução condicional: null não
significa não aplicação de ST, isenção ou uma operação já classificada. Informar
um código também não comprova que ele se aplica.

## Resultados da inspeção

| Status | Significado |
| --- | --- |
| `invalid` | Estrutura, valor ou consistência local rejeitados |
| `needs_context` | Estrutura aceita, com informações explicitamente pendentes |
| `context_recorded` | Contexto declarado passou nas verificações locais deste piloto |

Nenhum status autoriza faturamento ou significa `fiscal_approved`. O estágio
seguinte ainda precisa validar identidade, cadastros, fontes e regras, resolver
aplicabilidade e exigir os dados adicionais previstos por cada regra. A entrada
não contém flags confiáveis como `applyST: true` enviadas pelo navegador.

O exemplo usa NCM `00000000`, referências e hash fictícios deliberados. Ele serve
para provar o transporte e a validação estrutural; não representa mercadoria
classificada, norma disponível ou cálculo aprovado. O preço `"0.333333"` apenas
verifica preservação da precisão declarada; não é fixture de DIFAL ou partilha.

## Reproduzir

```powershell
cd D:\Projetos\avila-experiments
node scripts/validate-fiscal-input.mjs examples/fiscal/domestic-sale.context.json
node --test test/fiscal-input.test.mjs
npm test
```

O CLI retorna código 0 apenas para `context_recorded`. Entrada inválida, contexto
pendente, JSON malformado ou erro de leitura retornam código 1. A inspeção não
altera o objeto recebido nem fornece valores padrão para omissões.

## Continuação

O [contrato experimental de execução](FISCAL-EXECUTION-CONTRACT.md) acrescenta
resolução declarada e planejamento de caminhos com fixtures. Ele ainda não resolve
a aplicabilidade real, verifica fontes ou implementa as fórmulas.

Antes de adotar fórmulas ou um caminho fiscal em execução real, escolher uma
operação com referência revisada e resolver a aplicabilidade. As rotas de ICMS
próprio, ST e DIFAL devem ser condicionais às regras desse recorte, com regras
versionadas, evidência e tratamento de não aplicável. O contrato 0.1 ainda precisa
ser refinado com esses requisitos; não é a promessa de contexto universal completo.
