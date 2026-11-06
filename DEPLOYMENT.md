# Implantação do laboratório

## Entrada institucional do MLOps

A raiz `https://ml.avilaops.com/` é pública e serve `site/index.html`.
Somente `/experiments/*` e `/auth/*` encaminham para o dashboard na porta 3301.
O domínio principal não deve usar o dashboard como fallback. As rotas de
Memória, Onnix e evidências mantêm seus encaminhamentos específicos.

O job `public-home` valida a página em Chromium desktop/mobile, valida o
fragmento Caddy e publica o artefato `public-home-<sha>` com `SHA256SUMS`.
Após verificar o CI e os hashes no destino, execute como root:

```text
python3 scripts/deploy-public-home.py /caminho/do/artefato <sha-completo>
```

O publicador guarda backup da configuração, instala uma release estática em
`/srv/avila-mlops/releases/<sha>`, valida o Caddy e recarrega o serviço.
Falha de validação ou reload restaura a configuração e a release anteriores.
Nenhum build é executado no servidor; a publicação não altera a autenticação
nem reinicia os serviços privados. Confirme anonimamente a raiz com HTTP 200
e `/experiments/` ainda exigindo autenticação após a publicação.

São três fronteiras independentes:

- Código e documentação: repositório independente do ERP.
- Evidências públicas: exportação estática MDX de JSONs sintéticos selecionados.
- Painel e API: autenticação obrigatória; token da API somente no BFF. Basic temporário ou OIDC completo, sem modo público.

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

## SSO com Auth Ávila Ops

O dashboard usa OIDC Authorization Code com PKCE, implementado no BFF. O navegador
recebe somente uma sessão HTTP-only; o access token fica na memória do BFF e nunca
é enviado ao bundle React. O provedor é `https://auth.avilaops.com`.

Configure no ambiente privado do dashboard:

| Variável | Uso |
| --- | --- |
| `OIDC_ISSUER` | `https://auth.avilaops.com` |
| `OIDC_CLIENT_ID` | Client ID registrado no Auth para `ml.avilaops.com` |
| `OIDC_CLIENT_SECRET` | Segredo privado do client; nunca entra no repositório |
| `OIDC_REDIRECT_URI` | URI exata registrada no Auth, terminando em `/auth/callback` |

O login começa em `/auth/login`, o retorno chega em `/auth/callback` e o logout
usa o endpoint de sessão do Auth. `state` expira em dez minutos e o fluxo exige
`S256`. O BFF exige Basic Auth completo ou OIDC completo antes de iniciar.
Para manter Basic temporário, configure DASHBOARD_USER/DASHBOARD_PASSWORD e retire
todas as variáveis OIDC do ambiente ativo. Uma configuração OIDC parcial causa
erro de inicialização, mesmo com Basic configurado; não é interpretada como modo
público. OIDC_CLIENT_ID e OIDC_CLIENT_SECRET são obrigatórios quando OIDC é
solicitado; issuer e redirect URI mantêm os padrões definidos no entrypoint.
A exportação estática /evidencias/ continua pública, separada do BFF privado.

O registro do client no Auth deve aceitar somente a origem e o callback de produção
necessários. Não coloque `OIDC_CLIENT_SECRET` em `.env` versionado, imagem Docker,
logs ou documentação pública.

## Entrada pelo navegador

Com Basic temporário, o navegador abre /auth/login e usa as credenciais privadas
já configuradas. O formulário cria uma sessão opaca no BFF, com cookie HttpOnly,
SameSite=Lax e Secure quando PUBLIC_ORIGIN usa HTTPS. A sessão dura no máximo
oito horas e é invalidada por saída ou reinício do BFF. Nenhuma senha ou Bearer
interno é incluído no cookie.

Navegação HTML sem sessão redireciona à entrada; endpoints de API continuam
respondendo JSON401 para clientes sem autenticação. Clientes que já enviam Basic
por Authorization continuam funcionando. Login, logout e mutações autenticadas
por cookie exigem Origin exato; os aliases com e sem /experiments usam a mesma
barreira. OIDC mantém seu fluxo próprio quando configurado.

## Docker

O workflow `.github/workflows/ci.yml` executa os testes do núcleo, o build e os
testes do painel e regressões de interface no Chrome já instalado no runner Ubuntu 24.04.
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
da API. Configure o arquivo .env privado, modo 600, com LAB_API_TOKEN e um mecanismo completo de autenticação. Para Basic temporário, defina DASHBOARD_USER e DASHBOARD_PASSWORD (senha aleatória de ao menos 16 caracteres), sem variáveis OIDC parciais.

    sha256sum -c SHA256SUMS
    docker load --input images.tar.gz
    export API_IMAGE="avila-experiments-api:sha-$(cat REVISION)"
    export DASHBOARD_IMAGE="avila-experiments-dashboard:sha-$(cat REVISION)"
    docker compose -p avila-experiments up -d --no-build --wait
    docker compose -p avila-experiments ps

O Dockerfile inclui os 14 casos iniciais. O volume evidence armazena revisões
e runs; não use down -v. Os processos usam usuário sem root, limites de
memória/CPU, healthcheck e logs rotacionados. Portas 3300 e 3301 são vinculadas
somente a 127.0.0.1. O painel exige autenticação no BFF: Basic por cabeçalho, sessão criada pelo formulário ou OIDC completo. Sem mecanismo válido, o servidor recusa inicialização.
O BFF injeta o Bearer apenas depois de autenticar o usuário. O navegador
nunca recebe o token da API.

No Caddy, /experiments/* e /auth/* encaminham ao BFF; /evidencias/* serve somente a
exportação estática. As exceções de autenticação do portal aplicam-se a esses
dois caminhos: o BFF exige sua própria autenticação. Jupyter conserva seu
token próprio; Annif e Ultralytics continuam sob autenticação do portal.

### Dashboard separado no host applications

Quando o API do laboratório está em outro host, use
`deploy/dashboard-applications.compose.yaml`. Esse Compose executa somente o
BFF do dashboard em `applications`, encaminha as consultas para
`http://10.10.0.4:3300` e publica somente `127.0.0.1:3301`. O arquivo
`deploy/dashboard-applications.caddy` deve ser instalado como configuração
ativa do Caddy; valide a configuração antes do reload.

Crie `/etc/avila-experiments/dashboard.env` com modo `600`, pertencente ao
usuário que executa o deploy, contendo somente os valores privados do BFF:

```text
LAB_API_TOKEN=<token do API remoto>
OIDC_ISSUER=https://auth.avilaops.com
OIDC_CLIENT_ID=experiments
OIDC_CLIENT_SECRET=<segredo mostrado uma única vez pelo cadastro do Auth>
OIDC_REDIRECT_URI=https://ml.avilaops.com/auth/callback
```

Não grave esse arquivo no repositório, no Hindsight, na imagem Docker ou em
logs. O client `experiments` deve existir no Auth com exatamente o callback
acima e com `https://ml.avilaops.com/experiments/` como retorno pós-logout.
Antes do reload do Caddy, confirme que o container está saudável e que
`curl http://127.0.0.1:3301/health` retorna `200`. Depois, confirme
anonimamente que `/` continua público e que `/experiments/` redireciona para
`https://auth.avilaops.com/oauth/authorize`.

O artefato da CI contém os dois arquivos de Compose. Para executar somente o
BFF neste host, depois de conferir `SHA256SUMS` e carregar a imagem:

```text
export DASHBOARD_IMAGE="avila-experiments-dashboard:sha-$(cat REVISION)"
docker compose -f dashboard-applications.compose.yaml up -d --no-build --wait
```

Não use `docker compose down -v` neste host: o dashboard separado não possui
volume próprio e a API remota mantém os dados do laboratório.

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
