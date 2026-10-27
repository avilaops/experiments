# Experiments 0.3.0

O [setup e ponto de continuidade](SETUP.md) registra as decisões e o estado atual.
O [caderno de políticas](POLICIES.md) organiza regras, fontes e evidências por produto.
A [coleta automática do Siscomex](docs/SISCOMEX-COLLECTION.md) arquiva a documentação
pública, inventaria contratos e gera propostas de integração com fontes e hashes.
O [contrato fiscal experimental](docs/FISCAL-INPUT-CONTRACT.md) define o primeiro
JSON de contexto com validador e exemplos, sem cálculo ou autorização fiscal.
O [planejamento de execução fiscal](docs/FISCAL-EXECUTION-CONTRACT.md) acrescenta
rotas condicionais e cenários sintéticos para o pathFidelity.
O [executor local de referências](docs/FISCAL-REFERENCE-EXECUTOR.md) confere
arquivos, hashes, intervalos e vínculo ao contexto antes de produzir uma resolução.
O [executor instrumentado de ferramentas](docs/TOOL-EXECUTION.md) registra chamadas
reais locais, autorização e efeitos, com payloads redigidos e repetição controlada.
As [reservas persistentes](docs/TOOL-OPERATION-STORE.md) conservam resultados
desconhecidos após reinício e permitem reconciliação por recibos do domínio.
O [inventário de rotas do ERP](docs/ERP-FLOW-VERIFICATION.md) captura fontes e
contrato, aponta ambiguidades e mantém a verificação funcional separada.

Pacote local para experimentos versionados, avaliadores explícitos e relatórios
comparáveis. Requer Node.js 24 ou superior. Não executa deploys.

## Executar

```powershell
npm test
npm run test:custom
npm run test:path
npm pack
```

`test:custom` compara uma calculadora que arredonda com outra que preserva
frações. O conjunto inclui dízimas, operandos negativos e valores próximos dos
limites. Os relatórios ficam em `reports/custom-tests/<runId>/`.

`test:path` executa seis cenários locais instrumentados. O verificador precisa
reconhecer um caminho aprovado, quatro reprovados e um inconclusivo. Por isso,
o relatório do experimento contém falhas deliberadas, enquanto o comando termina
com sucesso somente quando identifica todos os resultados previstos. Os arquivos
ficam em `reports/path-policy/<runId>/`. Execuções novas preservam relatórios antigos.

## Precisão e limites

`numericTolerance` aceita a diferença quando o erro absoluto **ou** o relativo
está dentro da tolerância inclusiva declarada. As tolerâncias não são somadas.
Referência ausente ou inválida é inconclusiva; saída inválida reprova.

`numberRange` aplica os limites separadamente da precisão numérica. Os extremos
são inclusivos por padrão; `includeMinimum: false` e `includeMaximum: false`
permitem fronteiras exclusivas. Limites idênticos com alguma exclusão são
inválidos. Tolerância numérica não amplia uma faixa comercial permitida.

```typescript
numberRange({ minimum: 0, maximum: 100, includeMaximum: false });
```

A versão do avaliador `number-range` passou de `1` para `2`; os relatórios
registram as opções de inclusão. Comparações com definições diferentes são
recusadas, inclusive com relatórios antigos. A representação e o arredondamento
de moeda continuam sendo responsabilidade explícita da aplicação.

## Política de execução

`pathFidelity(options)` avalia `output.trace` neste formato:

```typescript
{
  value: 12,
  trace: {
    complete: true,
    steps: [
      { node: "fiscal", status: "succeeded" },
      { node: "margin", status: "succeeded" },
      { node: "discount", status: "succeeded" }
    ]
  }
}
```

Opções:

- `requiredNodes`: etapas obrigatórias bem-sucedidas em ordem de subsequência.
  Uma etapa repetida na política exige outra ocorrência no trace.
- `forbiddenNodes`: qualquer tentativa nesses nós reprova, mesmo se falhou.
- `allowedTransitions`: quando presente, cada par consecutivo precisa ser uma
  aresta dirigida permitida. Sem esta opção, não há validação de arestas.

Etapas adicionais podem ocorrer entre marcos obrigatórios; com uma lista de
transições, precisam respeitá-la. Qualquer etapa com falha reprova; a política
atual não autoriza recuperação por repetição. Trace ausente ou incompleto é
inconclusivo, mas uma violação já observada reprova mesmo em trace incompleto.
Registros malformados reprovam. Nomes de nós são comparados exatamente.

```typescript
pathFidelity({
  requiredNodes: ["fiscal", "margin", "discount"],
  forbiddenNodes: ["bypass"],
  allowedTransitions: [["fiscal", "margin"], ["margin", "discount"]]
});
```

O avaliador numérico continua recebendo um número. Para saída composta, adapte
o contexto para `output.value`, como em `examples/path-policy.mjs`, e execute
os dois gates. As opções de caminho são copiadas e sua proveniência é congelada.

Este é um gate determinístico inspirado na distinção entre resposta correta e
caminho correto do [THESEUS](https://github.com/HalcyonSolutions/THESEUS).
Não implementa as métricas PED/F1 do artigo nem integra seu runtime.
O executor precisa capturar chamadas reais; um trace escrito pelo modelo não
comprova sua execução. O campo `complete` é uma declaração do produtor do trace,
não uma prova criptográfica de completude.

## Limites de evidência e distribuição

A extensão HTTP do laboratório está descrita em [API.md](API.md). Para iniciar,
execute `npm run api` e abra <http://127.0.0.1:3300/>. A implantação do painel
React/BFF e da exportação MDX está descrita em [DEPLOYMENT.md](DEPLOYMENT.md).

O isolamento atual é por cópia de valores JSON em memória; não é uma sandbox.
Os avaliadores nativos e seus parâmetros são imutáveis. Para criar um avaliador
adaptado, declare outro objeto com identidade e versão próprias; alterar os
metadados de um avaliador nativo não modifica seus critérios de execução.
A aprovação dos testes não basta para autorizar um deploy. Os exemplos são de
desenvolvimento, sem conexão real com ERP, Annif, Ultralytics ou Langfuse.

O manifesto do pacote permanece privado e sem licença de distribuição pública
definida; consulte [LICENSE-PENDING.md](LICENSE-PENDING.md). Não houve npm publish.
O código deste pacote está em um repositório independente do ERP.
Os artefatos 0.1.0, 0.2.0 e 0.3.0 existentes não foram substituídos.

## Acessos implantados

- [Evidências públicas selecionadas](https://ml.avilaops.com/evidencias/):
  exportação estática, sem edição ou execução.
- [Laboratório privado](https://ml.avilaops.com/experiments/): autenticação
  obrigatória, editor com revisão, histórico e comparação.
- [Código e documentação](https://github.com/avilaops/experiments).

O núcleo continua independente do frontend. O dashboard React e TypeScript está
em dashboard; o BFF mantém o token da API fora do navegador. A página MDX usa
apenas os JSONs sintéticos enumerados em dashboard/evidence.allowlist.json.
