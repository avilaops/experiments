# Contrato experimental de caminhos fiscais 0.1

Estado: especificação executável de planejamento, sem resolução fiscal real,
cálculo, emissão, integração Rust ou alteração das regras do ERP/Lojas.

## Artefatos

- [Resolução declarada](../schemas/fiscal-resolution.v0.1.schema.json): schema
  para vincular uma resolução à entrada e ao snapshot de regras.
- [Planejador](../scripts/fiscal-plan.mjs): compila resoluções declaradas em
  políticas compatíveis com o avaliador pathFidelity existente.
- [Fixture](../examples/fiscal/domestic-sale.resolution.json): dados fictícios
  para exercitar o contrato, sem interpretação fiscal.
- [Exemplo executável](../examples/fiscal-paths.mjs): registros sintéticos com
  violações deliberadas e relatórios separados por runId.

## Vínculo entre entrada e resolução

Uma resolução declara o fingerprint canônico da entrada e o mesmo identificador,
versão e SHA-256 do snapshot de regras. Toda linha da entrada deve ter exatamente
uma resolução; linhas duplicadas, ausentes ou externas são rejeitadas.

O fingerprint é produzido pela função `fingerprint` do núcleo sobre o JSON.
Modificar preço, perfil, UF ou qualquer outro campo exige uma resolução nova.
Esse vínculo detecta divergências de conteúdo; não autentica quem produziu a
resolução e não comprova a existência ou integridade da fonte referenciada.

Para cada linha, a resolução contém:

- Classificação: matched, rejected ou undetermined, com referência de evidência.
- ICMS próprio, ST e DIFAL: applicable, not_applicable ou undetermined, cada um
  com regra referenciada e justificativa obrigatória.

São resultados declarados de uma futura resolução de regras, separados do JSON
recebido do comprador. O planejador local não consulta normas nem verifica essas
declarações. Um adaptador real deverá executar essas verificações no servidor e
não aceitar resoluções controladas pelo cliente como autoridade.

## Estados e bloqueios

| Resultado | Comportamento |
| --- | --- |
| invalid | Estrutura inválida, conteúdo divergente ou linhas incompatíveis; nenhum plano |
| blocked | Contexto pendente, classificação rejeitada/indeterminada ou tributo indeterminado; nenhum plano |
| planned | Caminho experimental compilado para todas as linhas; sem autorização fiscal |

Uma linha bloqueada impede o planejamento de todo o documento. Não há execução
parcial silenciosa. Um tributo indeterminado não vira não aplicável ou valor zero.

## Caminho proposto por linha

```text
validate_context
  → verify_rule_snapshot
  → resolve_profiles
  → validate_ncm
  → validate_cest_scope
  → resolve_applicability
  → calculate_icms_own OU record_icms_own_not_applicable
  → calculate_icms_st OU record_icms_st_not_applicable
  → calculate_difal OU record_difal_not_applicable
  → record_simulation
```

Essa ordem é uma proposta de engenharia do piloto, não uma sequência legal
universal. Quando ICMS próprio e ST forem declarados aplicáveis, ela exige que
a etapa do primeiro preceda a do segundo. Outras operações podem exigir outro
grafo e outra versão. O plano não contém fórmulas, bases, alíquotas ou rateios.

`validate_cest_scope` significa verificar a pertinência da classificação e os
dados exigidos pelas regras. Não equivale a exigir CEST para toda mercadoria.
A fixture declara matched com códigos/referências fictícios e CEST nulo para
expor o limite: o planejador confere o contrato, não faz essa validação fiscal.

Cada política exige os marcos na ordem proposta e permite apenas as transições
da rota selecionada. Calcular um tributo declarado não aplicável é proibido.
Os nós issue_document, activate_rules e bypass_validation são sempre proibidos
neste piloto de simulação. Um nó necessário que falhou reprova o caminho.
Um trace interrompido é inconclusivo, salvo violação já observada.

As referências, hashes e a versão da política acompanham o plano. O relatório
do exemplo preserva plano, entrada, resolução e fingerprints das fontes de código
selecionadas. Não há assinatura criptográfica, atestado de identidade ou prova
de completude de um trace remoto.

## Executar

```powershell
cd D:\Projetos\avila-experiments
npm run build
node scripts/fiscal-plan.mjs examples/fiscal/domestic-sale.context.json examples/fiscal/domestic-sale.resolution.json
npm run test:fiscal-path
npm test
```

O planejador retorna código 0 somente para planned. O exemplo de caminhos retorna
0 quando os resultados esperados dos cinco cenários são reconhecidos, mesmo
havendo reprovações deliberadas no relatório. Os relatórios são gravados em
`reports/fiscal-paths/<runId>/report.json`.

Todos os cenários emitem o mesmo marcador `fixture-12`, sem valor tributário:
um caminho aprovado, três reprovados e um inconclusivo. As chamadas gravadas são
callbacks de fixtures; elas não validam NCM/CEST nem calculam ICMS, ST ou DIFAL.

## Próxima fronteira

O [executor local de referências](FISCAL-REFERENCE-EXECUTOR.md) já lê arquivos,
confere bytes e contexto e produz resoluções de fixtures. Essa implementação
substitui a passagem manual da resolução no exemplo novo, sem resolver normas.

Um recorte fiscal revisado deverá especificar regras, vigência, valores de
referência, precisão e arredondamento antes de implementar cálculo determinístico.
O executor real precisará resolver cadastros e regras, registrar os resultados de
cada etapa e vincular o trace à execução. Aprovação desse trace permanece separada
de correção numérica, conformidade fiscal e autorização para emitir documentos.
