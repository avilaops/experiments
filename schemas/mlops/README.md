# Contratos oficiais do Ávila MLOps

Este diretório é a fonte canônica dos contratos estruturais compartilhados
entre GitHub, Ávila Experiments, Langfuse, LangGraph, Hindsight, ONNX, n8n e
os consumidores de publicação.

Os contratos são JSON Schemas Draft 2020-12 e usam versões explícitas no campo
`schemaVersion`. Eles descrevem a forma dos documentos; não autenticam a origem
dos artefatos, não provam que um teste cobre um requisito e não concedem
permissão de deploy.

## Schemas

| Arquivo | Documento | Responsabilidade |
| --- | --- | --- |
| `evaluation-request.v1.schema.json` | `evaluation-request/1` | Solicitar uma avaliação para projeto, revisão e suíte determinados |
| `evidence-envelope.v1.schema.json` | `evidence-envelope/1` | Encapsular evidência produzida por um executor, com hash e observações |
| `evaluation-result.v1.schema.json` | `evaluation-result/1` | Consolidar checks, cobertura, veredito e referências de evidência |
| `policy-decision.v1.schema.json` | `policy-decision/1` | Registrar a decisão da política e eventual aprovação humana |
| `deployment-gate.v1.schema.json` | `deployment-gate/1` | Registrar se uma revisão pode avançar para um alvo de publicação |

## Relação com os contratos existentes

`flow-plan/1`, `flow-verification/1`, `node-test-manifest/1` e
`node-test-evidence/1` continuam sendo contratos internos dos módulos de
verificação já implementados. O `evidence-envelope/1` referencia esses
documentos por `kind` e `schemaVersion`; ele não os substitui.

Os schemas fiscais permanecem em `schemas/` e os schemas de intercâmbio do ERP
permanecem em `schemas/erp/`. A definição canônica dos schemas de domínio do
ERP continua no repositório `erp-next`; as cópias locais são distribuição.

## Limites de segurança

- `originAuthenticated` precisa ser informado pelo produtor. O primeiro
  contrato não presume autenticação: hash confirma bytes, não a identidade do
  produtor.
- `policy-decision/1` pode registrar `approved`, mas a aplicação do check
  obrigatório deve ocorrer no GitHub ou no orquestrador autorizado.
- Mudanças em autenticação, OIDC, MFA, permissões ou migrações sensíveis devem
  permanecer com `humanApproval.status = approved` antes da publicação.
- Um workflow acionado por `workflow_run` não deve executar código ou artefatos
  não confiáveis de um Pull Request com permissões elevadas.

## Validação

Os schemas são compilados pelo teste `test/mlops-schemas.test.mjs` com Ajv
2020-12. Regras relacionais, como conferir que todos os hashes pertencem à
mesma revisão e que `completedAt` ocorre depois de `startedAt`, continuam
responsabilidade do consumidor porque não são garantidas apenas pela estrutura
JSON.

O job `core` de `.github/workflows/ci.yml` gera, em cada execução, os arquivos
`reports/mlops-ci/evaluation-request.json`,
`reports/mlops-ci/evidence-envelope.json` e
`reports/mlops-ci/evaluation-result.json`. O conjunto é preservado como
artefato do workflow por 14 dias. O status do próprio job continua sendo o
check que pode ser tornado obrigatório nas regras da branch; o artefato não
concede aprovação fora do GitHub.
