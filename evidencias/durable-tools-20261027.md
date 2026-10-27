# Reservas persistentes de ferramentas — 27/10/2026

Continuação da [AVL-342](https://linear.app/avilaops/issue/AVL-342), sob a
[AVL-329](https://linear.app/avilaops/issue/AVL-329).

## Resultado verificado

O executor aceita um armazenamento de operações em arquivos privados. A reserva
exclusiva é criada antes da ferramenta e permanece após a queda do processo.
Uma operação com efeito desconhecido não é reenviada automaticamente. A consulta
separada ao domínio pode registrar um recibo confirmado, sem executar o comando.

O contexto permanece vinculado à empresa, identidade, ferramenta, chave,
argumentos e versões. O armazenamento usa HMAC-SHA-256 com chave privada estável,
assinatura dos registros e validação do vínculo entre reserva e resultado.
Argumentos, chave de idempotência e respostas comerciais não são persistidos.
O retorno informa `outputAvailable: false` quando a saída não foi recuperada.

Contrato e limites: [TOOL-OPERATION-STORE.md](../docs/TOOL-OPERATION-STORE.md).
Não há garantia de transação conjunta com um produto ou autenticação remota
fornecida por esse armazenamento local.

## Testes

`npm test`: 147 aprovados no núcleo/API, incluindo 12 novos testes de persistência.
O comando inclui o build TypeScript. Foram verificados:

- Reabertura do armazenamento e replay sem gravação de dados brutos.
- Conflito de argumentos, versão de ferramenta, código, instrução, política,
  modelo e referências, sem novo dispatch.
- Reautorização, isolamento de empresa e identidade.
- Disputa de dois armazenamentos independentes e de dois processos pela chave.
- Encerramento de processo após efeito real em arquivo, antes de salvar resultado.
- Efeito HTTP real no loopback com resposta perdida, seguido de consulta de recibo.
- Permissão independente da reconciliação e ausência de confirmação por lookup vazio.
- Chave alterada, registros parciais ou modificados e cópia de resultado de outra reserva.
- Falha de gravação após efeito confirmado e atualização de uma reserva reconciliada
  por outro executor.

O teste de queda termina o processo com código 23 depois da gravação do efeito.
O processo seguinte encontra a reserva desconhecida e não grava outro efeito.
Isso testa queda de processo; não simula perda de energia ou rollback de volume.

Os 11 testes locais do painel/BFF/exportação também passaram. Para o commit de
código `5e205eedda3f6962178539561a5bd617fa913948`, a
[CI de push](https://github.com/avilaops/experiments/actions/runs/40564524943) e a
[CI do PR](https://github.com/avilaops/experiments/actions/runs/40564603608) passaram,
incluindo build e testes de navegador. A CI de push construiu e publicou o
artefato de imagens; isso não representa implantação no servidor.

## Exemplo em três processos

`node examples/durable-tool-execution.mjs` aprovado. Relatório privado:
`reports/durable-tools/86705a63-59b4-45a1-a66f-c6ea6c0b323b/verification.json`.

| Processo | Ação | Estado | Efeito | Saída disponível |
| --- | --- | --- | --- | --- |
| 1 | Executar e perder resposta | `failed` | `unknown` | Não |
| 2 | Consultar recibo | `succeeded` | `confirmed` | Sim, JSON null observado |
| 3 | Reapresentar a chave | `succeeded` | `confirmed` | Não, replay persistente |

O recibo foi criado uma única vez. O exemplo usa dados sintéticos e chave local
exclusiva, em pasta ignorada pelo Git e fora da seleção pública.

## Servidor

Na primeira inspeção somente leitura em `apps-noclient`, API e painel estavam
saudáveis nas tags `sha-57b2418622321f46f6ef34d3a14b3af4b25ea91b`, da etapa
de [correções de revisão](correcoes-review-20261027.md). Uma implantação
independente avançou o servidor durante esta continuação. A verificação final
encontrou ambos saudáveis na revisão `0dba98de0ce1ad04f700a87017d3285d4bb214f2`,
também registrada em `REVISION` na release correspondente.

| Componente | Image ID SHA-256 observado |
| --- | --- |
| API | `20e6191dad9598281bdd9481ff6cf38c2b9168a2d1de4065335ad15183c6603c` |
| Painel | `0db4ae858e7296e0aeedb21944e5c3cf2e78ca3e98416689ceb85eae1e9b32f4` |

Release: `/opt/avila-experiments/releases/sha-0dba98de0ce1ad04f700a87017d3285d4bb214f2`.
O manifesto dessa release declara os hashes
`7203acca82a3637731fa863316bdd6bf8aacc31150ec8d8d634abaf9edd13b19`
para `images.tar.gz` e
`b43a8c8f0a0a5b775894f732137b353653c733174a06488df5f4f36d0b1b2b15`
para `REVISION`. A leitura do manifesto não substitui conferir os bytes do tar.
API `/health`: 200; caderno anônimo no domínio real: 401; evidências públicas: 200.

O código de ferramentas desta branch não foi implantado por esta continuação.
Annif e Ultralytics não estavam em execução; foram encontrados somente arquivos
de remoção e backup. Nenhum desses serviços foi reinstalado.

## Pendências do aceite remoto

Integrar o adapter com um serviço de staging, obter contexto autenticado e
autorização de empresa, validar o recibo do domínio e executar os mesmos cenários
nesse ambiente. Definir provisão, ACL, backup, restauração e retenção da chave e
do armazenamento antes de adotá-lo operacionalmente. A tarefa permanece em andamento.
