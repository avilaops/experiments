# Experiments 0.3.0

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
execute `npm run api` e abra <http://127.0.0.1:3300/>. O plano executável para painel,
evidências públicas e implantação está no [prompt do Copilot](COPILOT-PAINEL-ML.md).

O isolamento atual é por cópia de valores JSON em memória; não é uma sandbox.
A aprovação dos testes não basta para autorizar um deploy. Os exemplos são de
desenvolvimento, sem conexão real com ERP, Annif, Ultralytics ou Langfuse.

O pacote permanece privado e sem licença de distribuição pública definida.
Relatórios podem conter entradas e saídas: publicar resultados exige escolher
conteúdo e destino adequados. Os artefatos 0.1.0 e 0.2.0 são preservados; a nova
versão produz `avilaops-experiments-0.3.0.tgz`.
