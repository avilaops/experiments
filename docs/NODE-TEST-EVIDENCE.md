# Evidências do executor node:test

O módulo liga resultados do executor real do Node 24 a checks de `flow-plan/1`.
O reporter descarta logs e payloads; o adapter confere o hash dos bytes, o
manifesto e o vínculo a plano, execução, fingerprint das fontes e ambiente.
Depois projeta os resultados no avaliador existente `assessFlow`.

## Registrar casos antes de executar

O manifesto `node-test-manifest/1` identifica cada teste por arquivo relativo
ao diretório de execução e nome exato. Cada caso pertence a somente um check;
um check pode exigir vários casos. Todos precisam passar para aprová-lo.

```json
{
  "schemaVersion": "node-test-manifest/1",
  "cases": [{"id":"isolation","file":"test/access.test.mjs","name":"refuses another tenant"}],
  "bindings": [{"checkId":"authorization","caseIds":["isolation"]}]
}
```

Os checks devem existir no plano e exigir `runtime_assertion`. O adapter recusa
IDs duplicados, seletores ambíguos, reutilização de caso, caminhos absolutos,
travessia de diretórios, campos desconhecidos e referências a arquivos `.env`.
O manifesto declara quais testes um revisor precisa conferir; seu vínculo não
prova que as asserções cobrem integralmente o critério do check.

Nesta versão, somente testes folha de nível superior podem verificar um check.
Suites e pais com subtestes não são promovidos a aprovação. Reexecução de falhas,
watch e execução interrompida exigem uma nova execução limpa; não se combinam
tentativas de forma implícita. O produtor suportado é Node 24.

## Capturar resultados

Grave um arquivo de configuração com os campos `run` e `manifest`. `run` contém
`runId`, `sourceFingerprint`, `environment` e `planHash`, conforme `FlowRun`.
Use ID opaco, fingerprint dos arquivos/revisão realmente testados e
`fingerprint(plan)` para o hash do plano. Os metadados não devem conter segredos.

O adapter aceita `local_isolated`, `staging` ou `production`. Uma execução da
CI isolada deve usar `local_isolated`; inventário de fontes não é runtime.

```bash
EXPERIMENTS_NODE_TEST_CONFIG=./ci/evidence-config.json \
  node --test \
  --test-reporter @avilaops/experiments/node-test-reporter \
  --test-reporter-destination ./events.jsonl \
  test/access.test.mjs
```

Em um checkout ainda não empacotado, use `./dist/node-test-reporter.js` após o
build. Neste projeto, builds e testes são executados exclusivamente no GitHub CI.

O reporter escreve JSONL `node-test-evidence/1`: cabeçalho, IDs/status dos casos
registrados e resumo global final. Nomes, arquivos, stdout, stderr, diagnósticos,
erros brutos, valores das asserções e motivos textuais de skip/todo não são
exportados. O arquivo de configuração/manifesto continua sendo privado e deve
usar nomes de testes não sensíveis. Falhas fora do manifesto são contabilizadas.

Ao iniciar um executor filho de dentro de outro teste, remova `NODE_TEST_CONTEXT`
do ambiente do filho. Essa variável interna mudaria o comportamento de isolamento;
os testes deste adapter iniciam processos independentes dessa forma.

## Verificar os bytes

```js
import { readFile } from 'node:fs/promises';
import { assessNodeTestEvidence } from '@avilaops/experiments';

const bytes = await readFile('events.jsonl');
const result = assessNodeTestEvidence(plan, run, manifest, {
  artifactSha256: digestRegistradoPelaCI,
  bytes
});
console.log(result.flow.verdict);
```

O digest esperado deve vir do registro da execução que está sendo conferida.
Alterar bytes e digest juntos não é autenticação: `originAuthenticated` permanece
`false`. O módulo também não verifica sozinho que o checkout corresponde ao
fingerprint declarado, nem que uma asserção demonstra uma regra de negócio.
O consumidor precisa preservar fontes, revisão, testes e o canal de origem.

Limites: artefato UTF-8 de até 4 MiB e 20 mil linhas; manifesto com até 10 mil
casos. Estrutura desconhecida, UTF-8 inválido, hash divergente, resumo ausente,
mistura de run/plano/ambiente/fontes/manifesto, casos repetidos, falha não
vinculada e inconsistências do resumo são recusados com códigos estáveis.
Não há leitura de caminhos ou execução de código dentro do adapter puro.

Resultados preservados:

| Situação dos casos exigidos pelo check | Resultado |
| --- | --- |
| Todos aprovados | `passed` |
| Alguma falha | `failed` |
| Algum erro de execução/cancelamento reconhecido | `error` |
| Skip, todo, resultado de pai/suite ou ausência parcial | `inconclusive` |
| Todos ausentes | `not_run` |

Checks sem binding também permanecem `not_run`. Nenhum deles sai do denominador.
Uma falha fora do manifesto ou erro global sem caso correspondente recusa o
artefato inteiro. Uma suíte verde não aprova automaticamente os checks do plano.

## Exemplo e CI

`node examples/node-test-flow.mjs` gera quatro cenários sintéticos com leituras e
gravações exclusivas de arquivos temporários: aprovado, falho, pulado e ausente.
Também comprova rejeição de bytes adulterados e de outra execução. O comando
termina com sucesso somente se reconhecer os resultados esperados, inclusive
as falhas deliberadas.

O workflow existente executa o exemplo depois da suíte e preserva os artefatos
em `node-test-evidence-<sha>-<attempt>` por 14 dias. Eles não entram na seleção
pública do laboratório. O exemplo não verifica o fluxo do ERP/Lojas, autorização,
produção ou a interface B2B. Os oito checks do produto continuam exigindo suas
próprias evidências reais e revisão.

Referência do produtor: [TestsStream do Node 24](https://nodejs.org/docs/latest-v24.x/api/test.html#class-testsstream).
