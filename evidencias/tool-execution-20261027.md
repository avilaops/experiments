# Executor instrumentado e inspeção de implantação — 27/10/2026

Vínculos: [AVL-329](https://linear.app/avilaops/issue/AVL-329),
[AVL-342](https://linear.app/avilaops/issue/AVL-342) e
[AVL-339](https://linear.app/avilaops/issue/AVL-339).

## Entrega local

Branch: `codex/avl-342-tool-execution`, criada sobre
`eaf8a169bf5d1f9821dcebb05c1c988fc7f00492`. Os quatro commits locais anteriores
e o arquivo de sessão existente foram preservados.

- Contrato `tool-execution/1`, identidade/contexto, versões e referências.
- Autorização obrigatória antes da chamada e de cada repetição.
- Ferramentas registradas, chamadas reais e registro privado antes do dispatch.
- Argumentos e resultados integralmente redigidos; códigos de erro estáveis.
- Sucesso, negação, falha, interrupção e efeito desconhecido distintos.
- Idempotência por instância, sem redispatch de resultado desconhecido.
- Journal JSONL exclusivo e sincronizado, com bloqueio em falha de gravação.
- Projeção conservadora para `pathFidelity`, preservando tentativas proibidas.

Implementação e limites: [contrato de execução](../docs/TOOL-EXECUTION.md).

## Verificações locais

O exemplo `npm run test:tools` executou uma leitura real de arquivo sintético e
preservou uma única leitura após repetição. Artefatos privados em
`reports/tool-execution/3cdb88ba-07d8-4367-9fd1-27f6f5f5b906/`.
Execution ID: `c79c852d-8c85-42b8-af69-ff9937b9f781`.

O teste de integração HTTP usa servidor real no loopback: efetiva uma operação,
perde a resposta e confere que repetir a chave não duplica o efeito. Outros
testes cobrem autorização, mutação de contexto, respostas inválidas, interrupção,
falha do journal antes/depois do efeito e tentativa de forjar caminho por payload.

Os sete testes do painel/exportação passaram, preservando a fronteira pública.
`npm test` passou com 131 testes no núcleo/API, incluindo 15 novos testes do
executor. O build TypeScript integra esse comando e também passou.

## Servidor inspecionado

Acesso SSH a `apps-noclient` realizado por solicitação do usuário, somente leitura.
Nenhum build, instalação, alteração de serviço ou implantação foi executado.

Na inspeção, a VM apresentou 3.814 MiB de RAM total, 2.453 MiB disponíveis,
540 MiB de swap usados e 15 GiB livres na raiz, com uso de disco de 60%.
É uma leitura pontual, não um dimensionamento de observabilidade.

API e painel estavam saudáveis, nas portas `127.0.0.1:3300` e
`127.0.0.1:3301`. API `/health`: 200. API `/api/v1/policies`, painel local
e URL pública `/experiments/` sem credenciais: 401. `/evidencias/`: 200.
Esses resultados verificam os acessos consultados; não são auditoria completa.

Imagens observadas:

| Componente | Tag | Image ID SHA-256 |
| --- | --- | --- |
| API | `avila-experiments-api:lab-20261027-v1` | `cb47fc970098fa1aede941d1fdebf37c8b35c138e466c49a8ed475dd465d6562` |
| Painel | `avila-experiments-dashboard:lab-20261027-v1` | `e914ab75ce0a99e213ea63f35f35acbfe722b46b83aaed6bf19914e74cc290cd` |

As imagens não contêm `org.opencontainers.image.revision`. O volume da API
é `avila-experiments_evidence`, montado em `/data`. Seu conteúdo não foi lido.

## Correspondência entre API e Git

Reprodução local, com SSH somente leitura:

```powershell
node scripts/audit-deployment.mjs
```

Relatório JSON gerado em
`reports/deployment-audit/7ca62cab-3fb2-487a-bfa8-e79ad23dbc91/audit.json`.
O script compara o conjunto completo de 13 arquivos JavaScript da API em execução
com a transpilação local das fontes rastreadas em cada commit. Confere também
que o container e a imagem não mudaram durante a leitura.

Os 13 arquivos e seus bytes coincidem com estes commits:

- `3da3dd412c88bfe98a3a4a603724af5f24ed2132`
- `1880afaa046d488a7106f709205a1ab09976eb05`
- `5eec1b76d35d013d8f5cc0e9db600f94c2e6bc8f`

O código da API é equivalente nesses três commits. Isso não determina qual
commit ou árvore suja produziu a imagem. Não cobre dependências, camadas,
configuração, source maps, painel nem exportação pública. Não é atestação de CI.

Os commits a partir de `7f45da6` contêm módulos adicionais do caderno e diferem
da API implantada. O HEAD local `eaf8a16` e o novo executor não estão demonstrados
em produção. A release usa JavaScript compilado; fontes TypeScript não são
copiadas para a imagem final.

## Aceite pendente

AVL-342: integrar serviço real de staging com identidade verificável,
idempotência persistente e reconciliação. O servidor HTTP local não satisfaz
esse aceite remoto. Argumentos e resultados não têm coleta seletiva nesta versão:
o conteúdo é omitido integralmente.

AVL-339: revisão/publicação, proveniência de build, CI, backup/restauração e
implantação com rollback continuam pendentes. O registro da equivalência do
código implantado não autoriza marcar a implantação como concluída.
