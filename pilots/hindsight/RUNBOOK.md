# AVL-419 — piloto Hindsight no Experiments

## Escopo e arquitetura

O alvo escolhido para este piloto é o agente de avaliação sintética do
`avilaops/experiments`. O pacote acrescenta MCP stdio para `retain`, `recall` e
`reflect`, traduzidos para a API HTTP do Hindsight 1.1.0. Não altera o servidor
do laboratório, o portal, as rotas existentes ou configurações de agentes locais.

O agente inicia um adaptador confiável com um único banco configurado:
`avl419-ci-a` ou `avl419-ci-b`. O adaptador não oferece seleção de banco, URLs,
ferramentas administrativas ou metadados arbitrários. O PostgreSQL 16 usa
pgvector, volume persistente e rede Docker interna. O Hindsight tem rede separada
para inferência, autenticação Bearer obrigatória e MCP upstream desabilitado.
O Compose não publica portas. Somente a CI descartável acrescenta porta loopback.

A chave upstream é administrativa, não uma credencial de tenant. O isolamento
do piloto é lógico, imposto pelo adaptador confiável e conferido entre dois bancos;
não comprova isolamento contra administradores ou agentes com shell/acesso ao
Docker/segredos. Para uso multiempresa, exigir instâncias/credenciais/DBs separados
ou autorização por banco verificada no serviço. Nenhum agente não confiável deve
receber a chave upstream nem acesso à rede administrativa.

## Dados, retenção e exclusão

- Entradas aceitas: exclusivamente os dois textos sintéticos e a pergunta
  enumerados em `policy.mjs`. A validação compara o valor completo antes do HTTP.
- Segredos, dados pessoais, transacionais, fiscais/financeiros e instruções livres
  não pertencem ao corpus e são recusados. Não há ingestão de Git, logs ou chats.
- A inspeção adicional da saída bloqueia padrões conhecidos e marcadores do outro
  banco. É defesa adicional, não detector geral de dados sensíveis.
- Memória recuperada é dado não confiável. Não autoriza ferramentas, deploys,
  vendas, decisões fiscais/financeiras ou substituição de fontes oficiais.
- `PILOT_ENABLED` inicia desligado. `PILOT_EXPIRES_AT` é obrigatório, no máximo
  14 dias à frente; vencido, todas as operações são recusadas. Cada processo admite
  até 12 chamadas, sem retries automáticos; timeout máximo de 15 segundos por padrão.
- Expiração de acesso não remove dados. O operador deve excluir os bancos e os
  backups até o fim dos 14 dias; não ampliar o piloto sem comprovar a exclusão.
- Na CI, os volumes e dumps são destruídos ao terminar. Artifacts contêm somente
  código, imagem, checksums e métricas sintéticas; retenção de 14 dias. Nenhum dump
  ou arquivo de configuração de provedor deve ser enviado como artifact.
- Em uma implantação futura aprovada, exclusão deve alcançar documentos, fatos,
  observações/modelos derivados e backups. Remover o banco inteiro pela API é a
  unidade preferida para estes bancos exclusivos; conferir recall vazio e registrar
  apenas banco/horário/resultado, sem conteúdo. Exigir expurgo do backup antes de
  reutilizar uma cópia restaurada. Não restaurar dados já sujeitos a exclusão.

## Configuração de CI e evidências

O workflow `Hindsight pilot` tem jobs independentes, todos com
`timeout-minutes: 1`. Timeout é falha; não aumentar o limite ou executar no servidor.
O workflow geral preexistente possui jobs com limites maiores; esta entrega não
certifica sua conformidade com a política de 90 segundos do projeto MLOps.

| Evidência | O que comprova | Limite |
| --- | --- | --- |
| `contract` | MCP stdio real, cliente HTTP, negativas, dois bancos simulados | Upstream é fixture, não Hindsight |
| `storage` | pgvector real, persistência após reinício, dump/checksum, restore e troca para cópia recuperada | Schema sintético, não schema Hindsight |
| `package` | Imagem do adaptador, smoke stdio sem rede, Compose e digests upstream | Não inicia Hindsight |
| `live` | Retain/recall/reflect, negativas de auth, isolamento, recuperação e reflexão após restore real | Requer provedor aprovado e conferência de custo |

O pacote `hindsight-release-<sha>` contém imagem do adaptador, `images.env` com
digests de Hindsight/PostgreSQL, Compose, revisão, este runbook e SHA256SUMS.
Upstreams são imagens prontas; nenhum build ocorre no destino. O Hindsight é
fixado em `1.1.0-slim` e travado por digest pela CI. O adaptador usa imagem Node 24
resolvida por digest e é identificado pelo SHA Git. Conferir SHA256SUMS antes de
qualquer aprovação de uso. Isso garante integridade do pacote, não assinatura.

Para a integração real em runner descartável:

1. Aprovar provedor/modelo, embeddings/reranker compatíveis com a imagem slim,
   teto monetário e credencial exclusiva com limite de gasto imposto no provedor.
   O contador local não limita jobs internos, embeddings ou outros processos.
2. Criar o environment `hindsight-pilot-ci` com revisor obrigatório. As proteções
   do environment são configuração do GitHub; o YAML sozinho não as cria.
3. Configurar as variáveis `HINDSIGHT_PILOT_PROVIDER`, `HINDSIGHT_PILOT_MODEL`,
   `HINDSIGHT_PILOT_COST_LIMIT_USD` e `HINDSIGHT_PILOT_LIVE=true`.
4. Armazenar exclusivamente em secrets do environment:
   `HINDSIGHT_PILOT_API_KEY`, `HINDSIGHT_PILOT_DB_PASSWORD` (aleatórios, ao menos
   24 caracteres; senha DB apenas letras, números, `_` e `-`) e
   `HINDSIGHT_PILOT_RUNTIME_ENV` (configuração aprovada de provedor/modelo,
   embeddings/reranker e respectivas credenciais segundo o upstream 1.1.0).
   Não copiar chaves de produção. Não enviar valores por Linear/chat/Git.
5. Após integrar o workflow na branch padrão, executar `workflow_dispatch` na
   revisão aprovada. O job usa somente instância/volume recém-criados no runner.
   Se download/inicialização/inferência exceder um minuto, registrar timeout e
   otimizar/distribuir a execução em runners aprovados; não declarar aceite.
6. Conferir `seed.json`, `restored.json` e `container-resources.jsonl`. O fluxo
   restaura o banco inteiro em `hindsight_restored`, troca a API para essa cópia
   e repete recall/reflect sem nova ingestão. O job termina destruindo volumes.
7. Anexar ledger de uso do provedor sanitizado e confrontar com o teto aprovado.
   Nenhuma decisão de ampliação é automática.

O relatório registra latência por chamada, CPU/RSS do adaptador e uso de tokens
quando fornecido pelo upstream; Docker registra CPU/memória dos serviços.
`actual_total_cost_usd` e `estimated_cost_usd` ficam `null` enquanto não houver
evidência do provedor. Tokens reportados podem excluir embeddings, reranking e
consolidação; não inferir custo total ou custo zero a partir deles. A qualidade
usa presença do marcador esperado e ausência do marcador estrangeiro em recall
e reflect; esse corpus mínimo não mede qualidade geral nem valida uso real.

## Integração MCP e API alternativa

O cliente MCP confiável inicia a imagem do adaptador com stdin/stdout conectados,
sem TTY, rede `avl419-hindsight-pilot_data`, banco fixo e configuração injetada
pelo secret store. Exemplo de comando de lançamento, após autorização operacional:

```sh
docker compose --env-file images.env --env-file runtime.env \
  --profile agent run --rm -T agent
```

O protocolo negociado é MCP `2025-03-26`. Primeiro enviar `initialize`, depois
`notifications/initialized` e `tools/list`; os schemas retornam exatamente os
valores aprovados para `tools/call`. Só mensagens JSON-RPC vão para stdout.
Erros operacionais retornam código genérico, sem corpos upstream ou segredos.

A API alternativa usa os mesmos controles de `createMemoryClient().call()`:

| Operação | Endpoint Hindsight |
| --- | --- |
| retain | `POST /v1/default/banks/{bank}/memories`, `async: false` |
| recall | `POST /v1/default/banks/{bank}/memories/recall` |
| reflect | `POST /v1/default/banks/{bank}/reflect` |

Não expor esses endpoints diretamente ao agente: a chave tem privilégios maiores
que o adaptador. A integração no portal/SSO é trabalho separado em AVL-428.

## Backup, restauração e rollback operacional

Este procedimento é uma proposta para aprovação, não autorização de implantação.
A CI testa o mecanismo sintético automaticamente e o runtime real somente no job
opt-in. Não executar scripts do checkout no servidor `applications`.

1. Registrar operador, janela, revisão/digests anterior e candidata e bancos
   exclusivos. Desabilitar o adaptador e parar escritas/consolidação no Hindsight.
2. Usar ferramenta de backup aprovada: `pg_dump -Fc`, checksum e cópia cifrada em
   destino autorizado. Registrar versão PostgreSQL/extensões e retenção de 14 dias.
   Não colocar senhas na linha de comando nem publicar dumps ou logs de conteúdo.
3. Restaurar com `pg_restore --exit-on-error --no-owner` em banco/volume separado,
   com a mesma versão major do PostgreSQL, extensão vector e imagem Hindsight.
   Não usar `--clean` no banco original. Verificar schema e ambos os bancos de
   memória, autenticação negativa e recall/reflect dos marcadores, sem reter de novo.
4. Só após aprovação e checks, trocar a conexão da API para o banco recuperado.
   Guardar a configuração anterior em secret store. Não misturar novas escritas
   entre cópias; registrar ponto de recuperação e eventual perda de dados.
5. Para rollback, desligar o adaptador, parar API, selecionar a imagem anterior
   pelo digest e o banco/volume anterior intacto, ou a cópia do backup validado.
   Migração de schema não é presumida reversível; nunca apontar imagem antiga para
   banco já migrado sem compatibilidade comprovada. Repetir auth e isolamento.
6. Se falhar, manter o adaptador desligado. O Experiments continua utilizável sem
   memória; esta camada não participa de transações oficiais.

## Desinstalação

Desabilitar e remover a entrada MCP do agente, parar os containers exclusivos,
revogar suas credenciais e remover redes/volumes somente após autorização de
exclusão e confirmação do destino do backup. Apagar backups ao vencer a retenção,
incluindo cópias recuperadas, e registrar a verificação. Não alterar containers,
rotas, volumes ou Basic Auth do Hindsight já existente no ecossistema.

## Responsabilidades e decisão

O implementador entrega código, CI e evidências; o mantenedor MLOps revisa a
integração; um operador designado pelo responsável do projeto executa e acompanha
qualquer implantação/restore/exclusão autorizada. O dono operacional, a janela e
o prazo do piloto ainda precisam ser nomeados pelo projeto. Não atribuir essas
responsabilidades automaticamente a alguém pelo estado de uma issue.

Ampliar somente com jobs aprovados na revisão exata, fluxo real e restore
comprovados, custo conferido, responsável e política de exclusão executável.
Encerrar se isolamento/auth/filtragem falharem, se o teto for excedido ou se
as evidências não couberem nas restrições aprovadas. Estado inicial desta entrega:
**preparação para revisão; sem deploy e sem aceite integral do AVL-419**.

## Fontes verificadas

- [Issue AVL-419](https://linear.app/avilaops/issue/AVL-419/pilotar-hindsight-como-memoria-de-longo-prazo-para-agentes-mlops)
- [Política CI do projeto MLOps](https://linear.app/avilaops/project/mlops-d5c4c72bf4ac)
- [HTTP upstream 1.1.0](https://github.com/vectorize-io/hindsight/blob/v1.1.0/hindsight-api-slim/hindsight_api/api/http.py)
- [Configuração upstream 1.1.0](https://github.com/vectorize-io/hindsight/blob/v1.1.0/hindsight-api-slim/hindsight_api/config.py)
- [Autenticação/configuração](https://hindsight.vectorize.io/developer/configuration)
- [Imagens oficiais](https://hindsight.vectorize.io/developer/installation)
- [Transporte MCP stdio](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
