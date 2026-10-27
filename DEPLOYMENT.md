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

## Docker

O Compose deve rodar como um único projeto avila-experiments, com uma réplica
da API. Configure o arquivo .env privado, modo 600, com LAB_API_TOKEN,
DASHBOARD_USER e DASHBOARD_PASSWORD (senha aleatória de ao menos 16 caracteres).

    docker compose -p avila-experiments build
    docker compose -p avila-experiments up -d
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
