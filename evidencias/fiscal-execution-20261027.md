# Verificação do planejamento fiscal experimental 0.1

Executado localmente em 27/10/2026, em `D:\Projetos\avila-experiments`.

## Comandos observados

- `npm test`: build TypeScript e 107 testes aprovados, zero falhas.
- `node scripts/fiscal-plan.mjs examples/fiscal/domestic-sale.context.json examples/fiscal/domestic-sale.resolution.json`:
  código 0, status planned, simulationOnly true, um plano com dez marcos.
- `npm run test:fiscal-path`: código 0, cinco resultados esperados reconhecidos.

Relatório preservado em
`reports/fiscal-paths/8920b228-5349-4ba0-899a-c4eeb7fa86f2/report.json`.

| Cenário sintético | Resultado observado |
| --- | --- |
| Caminho declarado | passed |
| Ausência da etapa NCM | failed |
| ST antes do ICMS próprio | failed |
| Tentativa de emissão na simulação | failed |
| Trace interrompido | inconclusive |

Todos devolvem o mesmo marcador `fixture-12`; não existe valor tributário calculado.

## Cobertura nova

Oito testes do planejamento cobrem seleção das oito combinações declaradas de
tributos, ordem, passos ausentes, emissão/ativação proibidas, registro explícito
de não aplicável, aplicabilidade indeterminada, classificação rejeitada, entrada
pendente, vínculo à entrada e ao snapshot, linhas ausentes/duplicadas/externas,
campos inesperados, bloqueio integral do documento, interrupção e falha de etapa.

Os testes não verificam regras oficiais. As declarações matched/applicable são
fixtures, e referências de evidência não são resolvidas pelo planejador.
Não houve alteração do Rust, instalação de serviço, consulta operacional ou
implantação remota. Traces sintéticos não comprovam execução fiscal real.
