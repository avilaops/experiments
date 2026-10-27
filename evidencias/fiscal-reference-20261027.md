# Evidência do executor local de referências

Execução local em 27/10/2026, em `D:\Projetos\avila-experiments`.

- `npm test`: build TypeScript e 116 testes aprovados, zero falhas.
- Nove testes novos do carregador, além dos testes anteriores de entrada e plano.
- `npm run test:fiscal-reference`: código de saída 0; cinco resultados esperados
  reconhecidos; repetição da referência correspondente produziu resultado idêntico.
- Run: `20bc9f62-9625-4660-b8f5-992de44348ea`.
- Artefatos: `reports/fiscal-reference/20bc9f62-9625-4660-b8f5-992de44348ea/`.
- Os 16 artefatos listados no manifesto tiveram tamanho e SHA-256 conferidos
  após a gravação, sem divergências.

| Cenário | Resultado | Última função registrada |
| --- | --- | --- |
| Referência correspondente | planned, um plano | plan_simulation, succeeded |
| Bytes alterados | blocked, nenhum plano | verify_reference_integrity, failed |
| Contexto divergente | blocked, nenhum plano | match_reference_context, failed |
| Data no fim exclusivo do intervalo | blocked, nenhum plano | check_reference_window, failed |
| ST indeterminada | blocked, nenhum plano | plan_simulation, succeeded |

A última linha ilustra que sucesso da chamada do planejador não equivale a plano
aprovado: a função retorna normalmente com status blocked. O consumidor precisa
verificar o resultado final, não apenas o status do registro de chamada.

Os testes cobrem também limites de arquivo, identidade divergente, fonte ausente,
JSON inválido, finalidade incompatível, calendário inválido, intervalo vazio,
início inclusivo, dados fora do intervalo e decisões de linha incompatíveis.

Não houve cálculo tributário, interpretação de norma, autenticação da fonte,
consulta de cadastro oficial, alteração do Rust, exposição de API ou deploy.
As referências são cápsulas sintéticas por operação; o código não reutiliza
esses resultados como regra universal para outras operações.
