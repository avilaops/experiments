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

Inspeção somente leitura em `apps-noclient`: API e painel saudáveis nas tags
`sha-57b2418622321f46f6ef34d3a14b3af4b25ea91b`. Essa revisão foi implantada
pela etapa de [correções de revisão](correcoes-review-20261027.md).
O código de ferramentas desta branch não foi implantado por esta continuação.
Annif e Ultralytics não estavam em execução; foram encontrados somente arquivos
de remoção e backup. Nenhum desses serviços foi reinstalado.

## Pendências do aceite remoto

Integrar o adapter com um serviço de staging, obter contexto autenticado e
autorização de empresa, validar o recibo do domínio e executar os mesmos cenários
nesse ambiente. Definir provisão, ACL, backup, restauração e retenção da chave e
do armazenamento antes de adotá-lo operacionalmente. A tarefa permanece em andamento.
