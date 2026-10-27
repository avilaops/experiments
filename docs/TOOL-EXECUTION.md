# Execução instrumentada de ferramentas

Primeira entrega local da [AVL-342](https://linear.app/avilaops/issue/AVL-342),
parte da [AVL-329](https://linear.app/avilaops/issue/AVL-329).
Contrato exportado pelo pacote em `src/tool-execution.ts`: `tool-execution/1`.

## Fronteira de autoridade

O host registra funções confiáveis e fornece um autorizador obrigatório.
`createToolExecutor` copia o contexto e os argumentos, autoriza cada tentativa,
aguarda a gravação privada do início e somente então chama a função registrada.
Não lê uma lista de etapas produzida por um modelo. Ferramentas desconhecidas,
negação, exceção ou retorno diferente do booleano `true` não são executados.

O contexto contém `executionId` gerado pelo executor, `correlationId`, execução
pai opcional, IDs opacos de empresa e identidade, produtor, versões de código,
instrução, política e modelo e referências versionadas. Ausência de instrução,
modelo ou execução pai é `null`, sem inventar uma versão.

O host deve obter identidade e empresa da autenticação real e verificar acesso
ao recurso no autorizador e no domínio. O callback não implementa Auth nem RLS.
O adapter recebe correlação, executionId, callId, chave de idempotência e signal;
precisa propagá-los ao serviço quando seu contrato permitir. Nenhuma credencial
é incluída nesses metadados.

## Dados e gravação

Argumentos e respostas são integralmente substituídos por `[REDACTED]` no trace
e nos eventos. Mensagens de exceção e motivos de aborto não são registrados;
somente códigos estáveis. A chave de idempotência e hashes de argumentos ficam
fora da telemetria. A saída bruta é devolvida apenas ao chamador: ele continua
responsável por não publicá-la ou registrá-la indiscriminadamente.

Os identificadores, versões, nomes de ferramenta e referência de confirmação
são metadados confiáveis do adapter. Devem ser opacos, sem nomes de clientes,
tokens, URLs com credenciais ou dados comerciais. A validação de formato não
descobre um segredo colocado deliberadamente nesses campos. Não há coleta de
raciocínio interno, prompt, cadeia de pensamento ou mensagem do modelo.

`createFileExecutionJournal` cria um arquivo novo com `wx`, solicita modo `0600`,
serializa JSONL e sincroniza cada gravação antes de confirmá-la. Permissões
efetivas dependem do sistema; no Windows, o operador deve proteger a pasta por
ACL. Falha de armazenamento interrompe o executor. Após dispatch, uma falha de
gravação não desfaz um efeito que o serviço já tenha confirmado.

Eventos sequenciais: `call_started`, `call_finished`, `execution_finished`.
Uma negação, interrupção anterior ao dispatch ou repetição do cache gera apenas
`call_finished`. Início sem fim após queda exige reconciliação; não é sucesso.
Um arquivo interrompido pode conter a última linha parcial. Não deve ser
reutilizado como uma execução nova ou tratado como recibo de transação.

## Efeitos, interrupção e repetição

Cada chamada distingue estado de execução de efeito:

| Efeito | Significado |
| --- | --- |
| `none` | O adapter declarou uma operação sem efeito transacional |
| `confirmed` | O adapter recebeu confirmação do domínio e uma referência opaca |
| `unknown` | Não existe confirmação suficiente para concluir o efeito |

Erro de ferramenta, resposta inválida ou interrupção após dispatch conserva
efeito desconhecido. Timeout não equivale a rollback. O AbortSignal é entregue
ao adapter, mas código que ignora cancelamento pode continuar após o retorno.

As chamadas são serializadas por instância. Repetição com a mesma chave e mesmos
argumentos reutiliza o resultado; argumentos diferentes são recusados. A
autorização é reavaliada inclusive antes de devolver um resultado do cache.
Efeitos desconhecidos também ficam reservados para impedir redispatch automático.
Negação e cancelamento antes do dispatch não reservam uma operação não executada.

Sem `operationStore`, essa proteção vale apenas para a instância em memória e
sua empresa/identidade fixadas. Com `createFileToolOperationStore`, a reserva
persiste entre execuções, processos e reinícios que compartilhem a mesma pasta
local e chave. Não coordena uma segunda chave para o mesmo comando. O domínio
continua responsável pela sua transação, autorização e idempotência própria.
O [contrato de reservas persistentes](TOOL-OPERATION-STORE.md) descreve a
recuperação e a consulta de recibos pela ação separada `reconcile`.

O contrato recebe os campos aditivos `action` no registro e na autorização,
`outputAvailable` no retorno privado e o método `reconcile` no executor.
Um replay persistente devolve `output: null`, `outputAvailable: false`: os dados
originais não são armazenados nem reconstruídos. Uma saída JSON `null` realmente
observada continua distinguível por `outputAvailable: true`.

## Uso e evidência

```powershell
npm test
npm run test:tools
```

O exemplo chama `readFile` sobre um caminho fixo de dados sintéticos, produz
registro privado, repete a chave sem outra leitura e verifica o caminho. Os
arquivos ficam em `reports/tool-execution/<id>/`, fora da exportação pública.
O relatório identifica o HEAD e se há alterações locais; HEAD sozinho não
identifica código ainda não commitado.

Os testes incluem um servidor HTTP real no loopback que efetiva uma operação e
derruba a conexão antes da resposta. Isso verifica a fronteira local e o estado
desconhecido, sem representar integração com um produto ou serviço de staging.

`toolExecutionPath` projeta o registro para `pathFidelity` sem alterar seu
contrato existente. Erros e negações continuam reprovando; interrupções e efeitos
desconhecidos deixam o caminho incompleto. Como o formato legado só distingue
sucesso e falha, tentativas sem sucesso confirmado são projetadas como falhas.
Isso reprova conservadoramente o gate e preserva tentativas em nós proibidos;
o estado desconhecido original continua distinguível no registro completo.
Repetições continuam visíveis e podem
violar uma política de transições que não autoriza repetição.

Conformidade do caminho não autentica a origem nem confirma a transação.
`originAuthenticated` permanece `false`: código local confiável produz o
registro, mas arquivos e hashes não são prova criptográfica de origem remota.
`complete` exige encerramento explícito, gravação reconhecida e ausência de
chamadas interrompidas ou efeitos desconhecidos. Não é uma prova de completude
de todas as ações possíveis do processo, que continua fora de uma sandbox.

## Aceite restante da AVL-342

Selecionar um serviço de staging e integrar sua identidade verificável,
autorização de empresa, idempotência do domínio e consulta de reconciliação.
Repetir os cenários contra esse serviço e revisar a retenção dos registros.
Esta entrega não conclui o aceite remoto da tarefa, não instala observabilidade
e não publica traces na seleção de evidências públicas.

A sincronização de arquivos usa as APIs documentadas de
[FileHandle no Node.js 24](https://nodejs.org/docs/latest-v24.x/api/fs.html#class-filehandle).
