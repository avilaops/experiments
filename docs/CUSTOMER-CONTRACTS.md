# Contratos com clientes no laboratório

O cadastro privado fica em `/experiments/contracts`, acessível pela navegação do
laboratório. Uma instalação nova começa vazia. O usuário informa código único,
título, nome do cliente, referência externa opcional, produto, situação, vigência,
valor em reais, periodicidade e observações. A referência externa permite anotar
um identificador de cliente de outro sistema sem importar dados desse sistema.

A situação é declarada manualmente: rascunho, ativo, concluído ou cancelado.
O término pode ficar vazio. Quando informado, deve ser igual ou posterior ao
início. As datas precisam existir no calendário. O valor é armazenado como texto
decimal com duas casas, de `0.00` até `9999999999.99`. O formulário aceita vírgula
ou ponto decimal e não aceita separador de milhar.

## Alterações e histórico

Cada criação ou edição exige um motivo. O servidor atribui UUID, versão e datas,
e grava um snapshot completo no histórico. Um código duplicado é recusado; criar
um registro nunca substitui um contrato existente. O histórico é paginado, com
20 versões por página na interface, da mais recente para a mais antiga.

O ETag representa a revisão global do cadastro. Se outra tela salvar primeiro,
o servidor responde `412` e a edição local permanece aberta. O usuário pode
copiar seus campos, cancelar e recarregar antes de editar a versão atual. O
formulário permanece bloqueado enquanto a gravação está em andamento.

## API e persistência

| Método e caminho | Comportamento |
| --- | --- |
| `GET /api/v1/client-contracts` | Revisão e contratos atuais, com ETag; sem histórico completo. |
| `PUT /api/v1/client-contracts` | Corpo `{id, contract, changeNote}` e `If-Match` obrigatório. `id: null` cria; UUID existente edita. |
| `GET /api/v1/client-contracts/{id}/history?limit=20&offset=0` | Snapshots, total e paginação. Máximo de 100 por página. |

O [OpenAPI](../src/lab/client-contract-openapi.ts) descreve os campos e erros.
O BFF encaminha essas rotas com a autenticação já existente do laboratório,
sem enviar o token da API ao navegador. O token restrito de contextos ERP não
autoriza ler ou gravar contratos. As respostas usam `no-store, no-transform`
para preservar o ETag em proxies.

Os registros ficam em `LAB_DATA_DIR/client-contracts.json`, no volume existente
da API. Cada gravação é serializada dentro do processo e usa arquivo temporário
seguido de rename. Execute uma única instância escritora por volume. Dados
inválidos no arquivo impedem leitura e gravação, preservando os bytes para
revisão técnica. O limite é de 500 contratos e 5000 alterações; atingir o limite
recusa uma nova gravação sem apagar o histórico.

O histórico usa o acesso compartilhado do laboratório e não identifica uma
pessoa editora. Este cadastro não inclui assinatura eletrônica, anexos,
cobrança, sincronização de clientes ou alterações no ERP/CRM. Nenhum dado de
contrato é incluído na exportação pública de evidências.
