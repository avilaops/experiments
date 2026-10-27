# Verificação do contrato de entrada fiscal 0.1

Execução local em 27/10/2026, no repositório `D:\Projetos\avila-experiments`.

- `npm test`: build TypeScript concluído; 99 testes aprovados, zero falhas.
- `node --test test/fiscal-input.test.mjs`: 19 testes aprovados, zero falhas.
- `node scripts/validate-fiscal-input.mjs examples/fiscal/domestic-sale.context.json`:
  código de saída 0, status `context_recorded`, sem issues ou pending.

Foram cobertos dados desconhecidos, valores decimais preservados sem mutação,
rejeição de números JSON e notação exponencial, excesso de escala, valores
negativos, campos desconhecidos, códigos malformados, UF e calendário inválidos,
quantidade zero, identificadores duplicados, versão/operação/modo incompatíveis,
omissão de perfil e uma entrada com 3 mil linhas.

A fixture contém classificação e referências fictícias deliberadas. O teste de
3 mil linhas é validação local de contexto, sem consulta a catálogo ou benchmark
do ERP. Não houve cálculo tributário, verificação de regra vigente, consulta
Siscomex/SEFAZ, emissão de documento, alteração do Rust ou implantação remota.

O contrato e o validador são experimentais, executados como ferramentas de
desenvolvimento. Aceitação estrutural não significa aprovação fiscal.
