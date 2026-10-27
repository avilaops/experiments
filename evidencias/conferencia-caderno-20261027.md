# Conferência de conflitos e impressão do caderno

## Entrega implantada

- Revisão: `5d86e85271f2eabffbcf982dbd170de40795e844`.
- CI da main: <https://github.com/avilaops/experiments/actions/runs/40565240269>.
- Artefato utilizado, do mesmo commit:
  <https://github.com/avilaops/experiments/actions/runs/40564955345>.
- Servidor: `apps-noclient`; API e painel ficaram healthy após a atualização.
- URL privada: <https://ml.avilaops.com/experiments/policies>.

## Comportamento

O formulário conserva a ficha original, a edição local e o motivo. Após um 412,
"Conferir versão atual" reúne mudanças em campos diferentes. Se ambas as telas
alterarem o mesmo campo com valores diferentes, o usuário escolhe o conteúdo
antes de salvar. O botão de gravação e a submissão do formulário ficam bloqueados
enquanto houver escolhas pendentes. A API continua validando o If-Match.

Fontes são tratadas como uma lista inteira, preservando a associação entre tipo,
local e nota. Nenhuma referência removida é restaurada por união automática.
Mudança de identidade ou produto durante a conferência é recusada.

A impressão mostra a ficha salva, com fontes, versão e situação declarada.
Editor, rascunho, navegação e histórico ficam ocultos. O papel usa fundo branco,
formato A4 e margens de 16 mm. A indicação de cadastro privado e manual acompanha
a impressão.

## Verificação

- Núcleo/API: 120 testes aprovados na CI.
- Painel, BFF, exportação e comparação de campos: 11 testes aprovados.
- Chrome: sete testes aprovados, incluindo conflitos reais entre duas telas,
  campos independentes, escolha local, escolha atual, alteração adicional antes
  da gravação, bloqueio durante salvamento, IDs duplicados e PDF A4.
- Os testes de concorrência usam API e BFF reais com dados temporários.
- No domínio implantado, a interface de conflitos foi exercitada com respostas
  controladas no navegador. Não houve gravação enviada ao servidor por essa
  verificação; isso não constitui uma disputa real entre usuários de produção.
- O PDF foi gerado a partir da ficha salva real `ERP-ACCESS-001`, versão 1, na
  revisão 1 do caderno. Foi conferido o fundo branco e a ausência de controles e
  histórico. Zero erros JavaScript; conflito móvel sem overflow em 390 px.
- PDF privado: 63.063 bytes; SHA-256
  `d03f1732d3ea4c1ab2a02e62641720bf0bc0fb45a658f71b08dad2e361a89216`.
- Evidências públicas: os seis artefatos conservaram os hashes e as fronteiras
  pública e privada passaram na verificação HTTP.

O PDF e a captura ficaram somente em `var/policy-review-live-<id>/` no checkout
de revisão, fora do Git e da seleção pública. Credenciais não foram registradas
nos relatórios.

## Dados e recuperação

O deploy usou imagens construídas na CI, conferidas por SHA-256 antes de carregar
no servidor. Os hashes de `suite.json`, `policies.json`, `runs-index.json` e do
run `d7acfbe0-145b-4e48-8084-6e7586e5902a` permaneceram iguais.

Backup verificado:

`/opt/avila-experiments/backups/before-5d86e85271f2eabffbcf982dbd170de40795e844/data.tar.gz`

A release anterior, `0dba98de0ce1ad04f700a87017d3285d4bb214f2`, permanece disponível
com suas imagens e seu Compose. Para rollback, definir API_IMAGE e DASHBOARD_IMAGE
com as tags `sha-<revisão anterior>` e executar o Compose anterior no projeto
`avila-experiments`, com `up -d --no-build --wait`, sem remover volumes. O script
da implantação tinha esse retorno preparado e concluiu sem acioná-lo.

As alterações de execução de ferramentas em desenvolvimento na outra sessão
foram preservadas no checkout original e não foram incluídas nesta implantação.
