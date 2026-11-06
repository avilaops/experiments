# Avaliação de prontidão de release por commit

A API autenticada `GET /api/v1/release-assessments` transforma o inventário já existente do GitHub Actions em um **relatório conservador**, por repositório e por SHA de commit. O BFF privado fornece a visualização no dashboard.

## Contrato

- `schema: avila-release-assessments/1`;
- `repository`, `sourceSha`, `evaluatedAt`, `sourceCollectedAt`;
- `decision: review | rejected | approved` (a versão atual **não emite approved**, por ausência de comprovação dos demais gates);
- `gates`: `ci`, `contract`, `security`, `humanApproval`, `deployment`, `postDeployHealth`;
- cada gate possui `passed | failed | unknown` e URL de evidência, quando comprovada.

CI aprovada é **necessária, mas não suficiente**. `CI=failed` resulta em `rejected`; `CI=passed` mantém `review` enquanto contrato, segurança, aprovação humana e saúde pós-deploy não tiverem fonte verificável. Inventário desatualizado, workflow sem conclusão, `skipped` e repositório inacessível são `unknown`, jamais um falso sucesso.

Os workflows são agrupados por `sourceSha`; evidência de outro commit não é misturada ao commit escolhido.

## Limites atuais

O relatório não envia status ao GitHub, não aprova PR, não realiza merge e não publica imagem. Histórico de decisões e aprovações humanas imutáveis ainda exige um contrato de evento autenticado com identificação de ator, escopo, branch, tenant e hash de evidência. A suíte demonstrativa do Experiments permanece distinta das avaliações reais dos produtos. Para implantar um gate bloqueante, será preciso definir políticas por repositório e conferir a proteção de branch no GitHub.

A implantação é aditiva, sem novos bancos ou credenciais.
