# Correções da revisão e implantação de 27/10/2026

## Revisão implantada

- Código: `57b2418622321f46f6ef34d3a14b3af4b25ea91b`.
- Servidor verificado por SSH: `apps-noclient`, hostname `ubuntu-4gb-hel1-2`.
- CI na main: <https://github.com/avilaops/experiments/actions/runs/40554971642>.
- Artefato efetivamente utilizado, do mesmo commit:
  <https://github.com/avilaops/experiments/actions/runs/40554688472>.
- Pasta da release:
  `/opt/avila-experiments/releases/sha-57b2418622321f46f6ef34d3a14b3af4b25ea91b`.

## Comportamentos corrigidos

1. Avaliadores nativos e seus parâmetros são imutáveis. A tentativa de alterar
   tolerância, faixa, identidade ou função é recusada. Comparações continuam
   rejeitando critérios diferentes.
2. Nova política tem modo explícito de criação. Código existente é rejeitado e
   continua editável; abrir uma ficha existente permite revisão deliberada.
3. Os campos da suíte e da política ficam bloqueados enquanto a gravação está
   em andamento, evitando o descarte de alterações posteriores ao envio.
4. O histórico consulta um índice de resumos. Volumes antigos são migrados e
   relatórios ausentes do índice são recuperados sequencialmente na inicialização.
   A paginação não abre os relatórios completos.

## Validações

- Núcleo e API: 120 testes aprovados na revisão implantada.
- Painel, BFF e exportação pública: sete testes aprovados.
- Navegador: três testes de regressão aprovados no Chrome local e na CI Linux.
- Build TypeScript/esbuild/MDX aprovado.
- Imagens da API e do painel construídas no GitHub, sem build no servidor.
- SHA-256 de imagens compactadas, Compose e revisão conferidos localmente e no
  servidor antes de carregar o artefato.
- Os dois contêineres ficaram healthy com tags `sha-<revisão implantada>`.
- Verificação dentro da API implantada: critérios imutáveis, comparação recusada
  para tolerâncias diferentes, oito políticas na revisão 1 e um run preservado.
- Os bytes de `suite.json` e do run
  `d7acfbe0-145b-4e48-8084-6e7586e5902a` conservaram os hashes anteriores.
- Pelo domínio real: evidências públicas HTTP 200; painel anônimo HTTP 401.
- Chrome autenticado no domínio real: código duplicado bloqueado sem gravar,
  largura móvel de 390 px sem overflow horizontal e zero erros JavaScript.
  Essa navegação não enviou gravações ao servidor.

O checkout local também contém o trabalho de execução de ferramentas de outra
sessão. As correções foram integradas preservando esse trabalho; os 135 testes
da árvore combinada passaram. Esse trabalho adicional não integra a revisão
implantada acima.

## Backup e rollback

O volume existente `avila-experiments_evidence` foi preservado. O backup foi
capturado com API e painel parados, antes da substituição dos contêineres:

`/opt/avila-experiments/backups/before-57b2418622321f46f6ef34d3a14b3af4b25ea91b/data.tar.gz`

O arquivo foi listado e seu SHA-256 foi conferido. O mesmo diretório contém o
manifesto de hashes dos arquivos anteriores. A configuração privada permaneceu
em `/opt/avila-experiments/.env`, referenciada por link na nova release.

O Compose anterior permanece em
`/opt/avila-experiments/releases/20261027-v1/compose.yaml`, e as duas imagens
`lab-20261027-v1` foram preservadas. Para reverter somente os serviços, usar esse
Compose com o projeto `avila-experiments` e `up -d --no-build --wait`, sem remover
volumes. Os arquivos novos de índice e políticas não substituem os dados antigos.
O script utilizado tinha retorno automático ao Compose anterior em caso de erro;
o deploy concluiu sem acionar esse retorno.

A seleção pública em `/srv/avila-experiments/public` foi preservada. Nenhum
serviço não relacionado foi reinstalado ou reiniciado por esta implantação.
