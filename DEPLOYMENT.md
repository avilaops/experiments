# Implantação do laboratório

São três fronteiras independentes:

- Código e documentação: repositório independente do ERP.
- Evidências públicas: exportação estática MDX de JSONs sintéticos selecionados.
- Painel e API: autenticação obrigatória, token da API somente no BFF.

## Construir e verificar

Requer Node.js 24 ou superior.

    npm ci
    npm test
    npm run test:custom
    npm run test:path
    node scripts/select-evidence.mjs
    cd dashboard
    npm ci
    npm run build
    npm test
    cd ..
    node scripts/ui-check.mjs

A seleção inicial usa apenas os três exemplos determinísticos conhecidos.
dashboard/evidence.allowlist.json enumera os arquivos permitidos.
O script select-evidence preserva a seleção existente; uma nova seleção requer
revisão explícita dos artefatos. A exportação MDX acontece no build, a partir
de fonte confiável versionada. O servidor não compila conteúdo enviado.

## Exportação limpa e falhas de build

O build público usa `dashboard/public-export.mjs`. Cada exportação nasce em um
diretório temporário novo dentro de `dashboard`, sem copiar a saída anterior.
Antes da promoção, a validação exige exatamente `index.html`, `style.css`,
`manifest.json` e `data/`; em `data/`, somente os nomes permitidos. Links
simbólicos são rejeitados. Tamanhos e SHA-256 são conferidos contra o manifesto.

Após a validação, a saída anterior é reservada e a nova assume `public/`.
Se a promoção falhar, a rotina tenta restaurar a anterior; se a restauração
também falhar, preserva o backup e informa seu caminho no erro. Falhas de
renderização ou validação não substituem a exportação anterior.

Uma trava exclusiva recusa exportações concorrentes. Se o processo for encerrado
abruptamente, a trava pode permanecer. Antes de remover `.public-build.lock`,
confirme que nenhum build está ativo e confira os diretórios `.public-build-*`;
eles podem conter uma saída anterior necessária para recuperação.

A substituição local usa duas renomeações com restauração; não é uma operação
atômica de troca de árvores e não garante continuidade para um servidor que
sirva diretamente essa pasta durante o build. Em produção, construa em uma nova
pasta de release, valide a árvore inteira e só então altere a referência servida
para a release validada. Preserve a referência anterior para rollback. Não rode
o build diretamente na árvore que o Caddy está servindo.

Os testes de exportação cobrem sentinelas na raiz e em subpastas, remoção de um
artefato da lista, reconstrução equivalente, renderização com falha, corrupção
de evidência, arquivos inesperados e disputa entre exportadores.

## Docker

O workflow `.github/workflows/ci.yml` executa os testes do núcleo, o build e os
testes do painel e três regressões no Chrome já instalado no runner Ubuntu 24.04.
Em eventos de push, somente após
essas verificações, constrói as duas imagens no GitHub e disponibiliza o artefato
`release-<commit>`, com imagens, Compose, revisão e SHA-256. Pull requests executam
as verificações sem produzir imagens para implantação.

Para atualizar um servidor existente, confira o resultado da CI e os hashes do
artefato antes de carregar as imagens com `docker load`. Use uma nova pasta de
release e um link `.env` para a configuração privada já existente. Defina
`API_IMAGE=avila-experiments-api:sha-<commit>` e
`DASHBOARD_IMAGE=avila-experiments-dashboard:sha-<commit>` e execute Compose com
`up -d --no-build --wait`. Não execute builds no servidor de aplicações.
Faça backup verificável do volume antes da atualização e preserve as imagens e
o Compose anteriores para rollback. O índice do histórico é derivado e migra o
volume existente sem substituir os arquivos de evidência em `runs/`.

O Compose deve rodar como um único projeto avila-experiments, com uma réplica
da API. Configure o arquivo .env privado, modo 600, com LAB_API_TOKEN,
DASHBOARD_USER e DASHBOARD_PASSWORD (senha aleatória de ao menos 16 caracteres).

    sha256sum -c SHA256SUMS
    docker load --input images.tar.gz
    export API_IMAGE="avila-experiments-api:sha-$(cat REVISION)"
    export DASHBOARD_IMAGE="avila-experiments-dashboard:sha-$(cat REVISION)"
    docker compose -p avila-experiments up -d --no-build --wait
    docker compose -p avila-experiments ps

O Dockerfile inclui os 14 casos iniciais. O volume evidence armazena revisões
e runs; não use down -v. Os processos usam usuário sem root, limites de
memória/CPU, healthcheck e logs rotacionados. Portas 3300 e 3301 são vinculadas
somente a 127.0.0.1. O painel usa HTTP Basic sobre TLS, verificado no BFF.
O BFF injeta o Bearer apenas depois de autenticar o usuário. O navegador
nunca recebe o token da API.

No Caddy, /experiments/* encaminha ao BFF; /evidencias/* serve somente a
exportação estática. As exceções de autenticação do portal aplicam-se a esses
dois caminhos: o BFF exige sua própria autenticação. Jupyter conserva seu
token próprio; Annif e Ultralytics continuam sob autenticação do portal.

## Persistência, limites e rollback

Após criar um run, reinicie a API sem remover o volume e consulte seu UUID.
HTTP 201 é registro; o resultado está no verdict do relatório.
Hashes verificam correspondência de conteúdo, não tornam os arquivos
invioláveis. timingSafeEqual protege a comparação dos hashes de credenciais;
não torna todo o serviço imune a ataques.

Para rollback desta primeira implantação:

1. Restaure o backup Caddy da implantação e valide antes de recarregar.
2. Execute docker compose -p avila-experiments down, sem remover volumes.
3. Preserve .env, o volume e a pasta de release para recuperação.

Em atualizações futuras, use uma nova pasta de release e novas tags de imagem,
faça backup do volume e mantenha as imagens anteriores para reversão.
Não reinicie os serviços ML ou bancos não relacionados.
