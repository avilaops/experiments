# Inventário GitHub CI — Experiments

O coletor é somente leitura: consulta `GET /repos/{owner}/{repo}/actions/runs?branch=main` e registra **estados declarados pelo GitHub**, nunca supostos resultados de testes. Não dispara workflows, merge ou deploy.

## Evidência persistida

O script `collect_ci.py` gera `/data/github-ci/latest.json` e arquivos históricos em `/data/github-ci/snapshots/`, com escrita atômica e lock exclusivo. Por repositório, conserva ID do workflow, nome, commit SHA, status, conclusão, URL, evento e digest SHA-256 da resposta de origem. Indisponibilidade/404/rate-limit geram `available=false` sem atribuir aprovação.

`GET /api/v1/github-ci` exige o Bearer do Experiments; o BFF autenticado fornece a tela. Evidência com mais de duas horas fica `stale` e nunca é apresentada como decisão atual.

## Instalação no servidor `apps-noclient`

1. Executar CI e publicar a versão da API/dashboard primeiro. Preservar o volume `avila-experiments_evidence`.
2. Copiar `collect_ci.py` **do commit aprovado** para `/opt/avila-experiments/github-ci/collect_ci.py`. Comparar SHA-256 do arquivo com o commit.
3. Criar o diretório `/var/lib/docker/volumes/avila-experiments_evidence/_data/github-ci` com modo `0755`. Não colocar chaves no repositório.
4. Copiar as unidades versionadas para `/etc/systemd/system/`, verificar com `systemd-analyze verify`; realizar uma execução manual da unidade com `systemctl start avila-github-ci-evidence.service` e validar o JSON.
5. Habilitar `avila-github-ci-evidence.timer` com o systemd. A coleta é horária; os requests são limitados a sete repositórios e seis runs por repositório.
6. Verificar API autenticada `/api/v1/github-ci` e painel em `/experiments/`. Os resultados devem conservar data, SHA e URL de origem e exibir indisponibilidade corretamente.

Opcional: injetar `GITHUB_READONLY_TOKEN` por um EnvironmentFile root-only (recomendado se algum repositório for privado ou houver rate-limit). Essa credencial nunca entra em dados persistidos, navegador ou logs.

## Limites

O inventário **não** é um gate de deploy; use checks obrigatórios e artefatos do workflow de cada aplicação. Não mede contagem de testes, qualidade de IA, Langfuse, aprovação humana, custo ou saúde pós-deploy. Essas propriedades exigem integrações posteriores com evidência separada. Não instalar novo PostgreSQL, Redis ou serviço público para esta coleta.
