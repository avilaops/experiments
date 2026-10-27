# Reservas persistentes e reconciliação de ferramentas

Continuação da [AVL-342](https://linear.app/avilaops/issue/AVL-342).
Implementação: `src/tool-operation-store.ts`, contrato `tool-operation/1`.
Complementa o [executor instrumentado](TOOL-EXECUTION.md).

## Garantia e contexto

O host pode fornecer `operationStore` ao `createToolExecutor`. A implementação
em arquivos cria uma reserva exclusiva antes de chamar a ferramenta. Outro
executor que encontre a mesma reserva consulta seu estado e não executa o
comando novamente. Não há expiração nem tomada automática de reservas antigas.

O escopo é empresa, identidade, ferramenta e chave de idempotência. Mudança de
argumentos, versão da ferramenta, código, instrução, política, modelo ou referências
com a mesma chave gera conflito. Correlação e executionId podem mudar no reinício.
Uma nova identidade ou uma segunda chave representam outro escopo: o domínio
precisa impedir comandos logicamente duplicados por usuários ou chaves diferentes.

Autorizações são reavaliadas antes de consultar ou reutilizar o estado. O host
recebe `action: execute | reconcile` no autorizador e deve verificar a permissão
correspondente e o acesso ao recurso. Os callbacks não implementam autenticação
ou autorização por empresa em um serviço remoto.

## Arquivos privados

O host provisiona uma chave privada estável de pelo menos 32 bytes aleatórios.
Não gerar outra chave a cada inicialização. A chave deve ter backup protegido
separado do armazenamento. Mudança ou perda da chave bloqueia a abertura; não
existe rotação automática ou reparação que libere comandos desconhecidos.

A pasta solicita modo `0700`; arquivos solicitam `0600`. No Windows, proteger
por ACL. HMAC-SHA-256 produz nomes e hashes vinculados ao escopo e à entrada;
esses valores não são hashes simples de preços ou outros argumentos previsíveis.
Os registros têm integridade vinculada à chave e à reserva original. A chave,
argumentos e respostas não são gravados nos arquivos de operação nem no trace.
Recibos, versões e demais identificadores precisam continuar sendo opacos.

Cada operação usa registros imutáveis:

| Arquivo | Conteúdo |
| --- | --- |
| `store.json` | Versão e vínculo com a chave do armazenamento |
| `<hmac>.claim.json` | Hashes privados, executionId/callId originais e reserva |
| `<hmac>.result.json` | Estado observado e efeito, sem saída bruta |
| `<hmac>.confirmation.json` | Recibo reconciliado e identidade da execução que o observou |

Criação exclusiva e sincronização precedem o reconhecimento da gravação.
Arquivo parcial, assinatura inválida, resultado de outra reserva, falta de
permissão ou falha de I/O bloqueiam o executor. Uma leitura concorrente de um
arquivo ainda parcial também pode ser recusada; não autoriza outro dispatch.

Esse protocolo exige um sistema de arquivos local confiável com criação exclusiva
coerente. Não usar NFS, compartilhamento SMB ou cópias divergentes como coordenação
distribuída. A sincronização de arquivos não é prova de durabilidade de metadados
sob toda falha de energia; o teste de recuperação cobre queda de processo.
O armazenamento não é inviolável: um operador com acesso pode apagar ou restaurar
um conjunto antigo de arquivos. Não apagar reservas para destravar comandos.
Não há detecção de rollback do volume, transação conjunta com o produto ou
garantia universal de execução exatamente uma vez.

## Recuperação sem repetir o efeito

Uma reserva sem resultado permanece `unknown`, inclusive após encerramento do
processo. Uma falha depois de confirmação do domínio, mas antes da gravação do
resultado, também pode deixar essa reserva desconhecida. Timeout ou interrupção
não removem a reserva. Cancelamento anterior à reserva não cria uma operação;
cancelamento posterior conserva o estado registrado sem liberar a chave.

O replay persistente omite a saída original: `outputAvailable: false` e
`output: null`. Esse par não significa que a ferramenta retornou JSON null.
Uma repetição ainda disponível no cache da mesma instância pode devolver a saída
observada. Reservas desconhecidas são relidas para enxergar uma confirmação feita
por outro executor.

Para reconciliar, o host registra `RegisteredTool.reconcile`, uma consulta ao
domínio que usa a mesma chave, contexto e versões da operação original. Chama
`executor.reconcile(tool, arguments, key, signal)`, sob autorização própria.
O adapter deve conferir a identidade do serviço, empresa, recurso e vínculo do
recibo à chave antes de devolver `effect: { status: confirmed, reference }`.
O executor não determina essa autenticidade sozinho.

Somente recibo confirmado resolve um efeito desconhecido. Consulta sem resultado,
efeito `none`, timeout, erro ou resposta inválida mantêm a incerteza. Ausência no
serviço enquanto outra chamada está em andamento não prova que ela nunca será
efetivada. A consulta não repete o comando e não apaga falhas anteriores.

O trace distingue `action: reconcile`; a projeção de caminho usa
`<tool>:reconcile`. Uma consulta de recibo não satisfaz o marco de execução da
ferramenta original. Uma confirmação não converte a origem do trace em autenticada
e não reescreve um relatório anterior que terminou com efeito desconhecido.

## Reprodução local

```powershell
npm test
npm run test:tools:durable
```

O exemplo inicia três processos: o primeiro grava um recibo sintético e perde a
resposta; o segundo consulta o recibo; o terceiro reapresenta a chave e recebe
confirmação persistida sem executar o comando. Evidências e chave exclusivas
desse exemplo ficam na pasta privada `reports/durable-tools/<id>/`, fora da
seleção pública. Não reutilizar a chave do exemplo em produção.

Os testes também encerram um processo após efeito real em arquivo, disputam a
mesma chave entre dois processos e consultam recibo em um servidor HTTP real no
loopback. Esses testes não constituem integração de staging ou de um produto.

As APIs utilizadas estão na documentação oficial de
[arquivos do Node.js 24](https://nodejs.org/docs/latest-v24.x/api/fs.html) e
[HMAC do Node.js 24](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehmacalgorithm-key-options).
