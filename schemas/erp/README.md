# Contrato de intercâmbio do ERP

Os dois JSON Schemas são cópias de distribuição de
`avilaops/erp-next@efe00f7f895b3bf50724724ab36a6b08d2eca89c`, diretório
`verification/schemas/`. A definição canônica continua no ERP. Não redefinem
campos dos tipos Rust nem contratos de negócio neste repositório.

O laboratório compila essas referências localmente com Ajv, sem carregar URLs
ou referências de rede fornecidas pelo importador. Mudanças de versão do
contrato exigem atualizar e revisar as duas cópias juntas.
