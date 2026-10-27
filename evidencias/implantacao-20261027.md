# Implantação verificada em 27/10/2026 UTC

## Endereços

- Público: https://ml.avilaops.com/evidencias/
- Painel privado: https://ml.avilaops.com/experiments/
- Contrato privado: https://ml.avilaops.com/experiments/openapi.json
- Código independente: https://github.com/avilaops/experiments

A conta avilaops foi verificada pela API GitHub como User, não Organization.
O repositório experiments não existia; foi criado público somente com o pacote,
dashboard, documentação e uma seleção sintética explícita.
Nenhum arquivo do ERP, segredo, diretório var, log ou coleção completa de
relatórios foi publicado. A licença permanece pendente; não houve npm publish.

## Testes observados

- Núcleo e API: 66 testes aprovados, zero falhas ou testes ignorados.
- BFF e fronteira da exportação pública: dois testes HTTP aprovados.
- Cálculo: candidata 14/14; base arredondada 6/14, sem regressões nesse conjunto.
- Caminho: seis resultados esperados reconhecidos, incluindo quatro reprovações
  e um inconclusivo; todos os números finais eram aceitos pelo gate numérico.
- Frontend: TypeScript e build esbuild/MDX aprovados.
- Navegador Chrome desktop e móvel (390 px): editor, execução, histórico,
  inspeção de falha/inconclusivo, comparação incompatível, conflito 412 com
  preservação da edição local e recarga foram verificados localmente.
- No domínio real, página pública anônima 200; painel anônimo 401; painel
  autenticado 200, com 14 casos e histórico real. Sem erros JavaScript observados.
- Os seis JSONs públicos foram baixados e seus tamanhos e SHA-256 conferidos
  contra o manifesto público.

## Persistência e recursos

Uma execução real foi criada no container da API com UUID
d7acfbe0-145b-4e48-8084-6e7586e5902a, candidata aprovada em 14 casos.
A API foi reiniciada sem remover o volume e o mesmo registro foi relido,
preservando quantidade de casos e hash do dataset.

Os containers usam usuário node e ficaram healthy:

- avila-experiments-api-1: aproximadamente 17,95 MiB de RAM observada.
- avila-experiments-dashboard-1: aproximadamente 18,83 MiB de RAM observada.

Cada container tem limite de 192 MiB e 0,5 CPU. O host tinha aproximadamente
1,9 GiB de memória disponível e 9,4 GB livres após a implantação.
Esses valores são snapshots de uma execução leve, não um teste de carga.

## Serviços preservados e acesso

DocuSeal, Annif e o healthcheck do Ultralytics responderam 200; MCP principal
respondeu 200 no healthcheck. O MCP GSC respondeu 401 sem credencial, mantendo
sua autenticação. Jupyter recusou consulta anônima de sessões com 403.
Annif e Ultralytics responderam 401 pelo domínio público sem credenciais.
As portas dos novos serviços estão vinculadas somente a 127.0.0.1.
A API também respondeu 401 sem Bearer em consulta direta ao loopback.
A tentativa de ler .env na página pública retornou 404.

NocoDB, RustDesk, Notas e ArxisVR não foram reinstalados. Não foi instalada
a stack Langfuse. Nenhum adapter para ML ou ERP foi anunciado ou fabricado.

## Arquivos e rollback

Release no servidor: /opt/avila-experiments/releases/20261027-v1.
Configuração secreta: /opt/avila-experiments/.env, modo 600, fora do repositório.
O usuário do painel é laboratorio; a senha deve ser consultada por SSH no
arquivo privado, sem copiar tokens para relatórios ou para o navegador.

Arquivos relevantes: dashboard/src, dashboard/content/evidence.mdx,
dashboard/evidence.allowlist.json, dashboard/evidence, dashboard/build.mjs,
Dockerfile, compose.yaml, scripts/select-evidence.mjs e DEPLOYMENT.md.
As versões empacotadas anteriores e alterações existentes no ERP foram preservadas.

Backups do Caddy:

- /opt/avila-experiments/ml.avilaops.com.caddy.before
- /opt/avila-experiments/Caddyfile.before

Para reverter, restaure somente o snippet ml.avilaops.com.caddy a partir do
backup, valide o Caddyfile e recarregue o serviço. Depois execute compose down
no projeto avila-experiments, sem -v, preservando o volume e as credenciais.
As imagens desta release usam tags lab-20261027-v1 e não substituem serviços antigos.

As capturas estão no diretório local evidencias/screenshots: desktop e móvel
do site público e do painel implantado, além do cenário local de conflito.
Elas não contêm senhas ou tokens.

## Limites da conclusão

A página pública é um snapshot estático de evidência sintética selecionada.
O painel consulta o histórico a cada dez segundos; não há streaming de agentes.
Não há runtime THESEUS nem integração TensorFlow/ERP. Os cenários de caminho
testam o avaliador local, não segurança geral. Hash não é log inviolável.
A aprovação não constitui autorização automática para deploys futuros.
