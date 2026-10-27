# Inventário parcial de Mail, CMS, CRM e TMS

## Entrega e publicação

- Revisão do lote e verificador: `cf54d80419d776a6c88f0f661ad442fbc8a6d962`.
- CI da main: <https://github.com/avilaops/experiments/actions/runs/40590856641>.
- CI da branch: <https://github.com/avilaops/experiments/actions/runs/40586416765>.
- Cadastro privado: <https://ml.avilaops.com/experiments/policies>.
- Lote: [product-inventory.json](../examples/policies/product-inventory.json).
- Fontes: [manifesto dos 15 blobs Git](inventario-produtos-fontes-20261027.json).

Foram registradas duas fichas por produto, em situação `implemented`: código
inspecionado, sem execução ou verificação de runtime dos quatro produtos.
O README do CRM fornece a identificação do responsável técnico. As fichas dos
demais produtos conservam "A definir". A atribuição de dono ou aprovação da ficha
não foi inferida de nomes de agentes ou autores de commits.

## Integridade e limites das fontes

O verificador conferiu as 15 fontes nos quatro checkouts reais: origem Git,
commit, caminho e SHA-256 de cada blob. Todas as referências das oito fichas estão
no manifesto e todas as fontes do manifesto são utilizadas.

O CRM foi lido pelo Git no commit do checkout esparso, sem abrir novos caminhos
na cópia de trabalho. Os arquivos inspecionados de Mail, CMS e TMS não diferiam
dos respectivos commits; mudanças locais não relacionadas foram preservadas.

Comando executado após compilar o laboratório:

```powershell
node scripts/verify-policy-inventory.mjs examples/policies/product-inventory.json evidencias/inventario-produtos-fontes-20261027.json var/product-repositories.json
```

Resultado: `sourceIntegrityVerified=true`, `productRuntimeVerified=false`,
oito fichas, quatro repositórios e 15 fontes. O SHA-256 do JSON das fichas
normalizadas pelo contrato foi:

`312039e4181d9a6e59f614c80d0b285ba820db6b6d51b2b00d347ce42c4f32d7`

O hash não é assinatura de autoria ou prova de aplicação da política. A ficha
do CMS descreve a exceção da equipe; a do TMS descreve o cliente privilegiado
`sistema`. A definição de RLS no repositório não comprova aplicação no banco de
produção. As referências e limitações completas acompanham as fichas.

## Importação real no cadastro privado

Foi usada a interface implantada, com prévia das oito fichas, motivo e confirmação
explícita. Antes da gravação, foi criado e validado um backup de `policies.json`,
comparado integralmente com o catálogo da prévia. A API continuou exigindo If-Match.

Resultado da confirmação no domínio real:

- Oito fichas novas: duas de cada produto.
- As oito fichas anteriores permaneceram integralmente iguais.
- Revisão do catálogo: 1 para 2, em uma única importação.
- Catálogo final: 16 fichas; oito novos snapshots de histórico.
- Histórico anterior preservado, sem substituição ou restauração de versões.
- Conteúdo persistido em disco igual ao catálogo devolvido pela API.

O mesmo arquivo foi novamente selecionado e confirmado. A prévia indicou zero
fichas novas e oito códigos existentes. A segunda confirmação preservou catálogo,
histórico, revisão e hash do arquivo. SHA-256 final de `policies.json`:

`0215d4a9a4d9cf1136a11c310582badc0003933165bd05d2ba8cfd1fe3f16018`

Backup anterior à importação:

`/opt/avila-experiments/backups/policy-inventory-cf54d80419d776a6c88f0f661ad442fbc8a6d962/policies.json`

Os hashes de `suite.json`, `runs-index.json` e do run
`d7acfbe0-145b-4e48-8084-6e7586e5902a` permaneceram iguais. A operação utilizou
o importador já implantado em `bf2b9a9`; não houve troca de imagens, reinício dos
serviços, alteração dos produtos ou build no servidor.

## Verificação do laboratório

- Núcleo/API: 132 testes aprovados; cinco novos para este incremento.
- Os testes novos cobrem o contrato das oito fichas, cobertura das fontes,
  divergência de bytes, manifesto ambíguo ou incompleto, preservação de edições,
  persistência após reinício e reimportação sem gravação.
- Um repositório Git temporário prova que o leitor usa o blob fixado e preserva
  HEAD e arquivo com alteração local; origem divergente é recusada.
- A CI aprovou 13 testes do painel/BFF e 11 do Chrome: 156 testes no total.
- O checkout integrado preservou o executor em desenvolvimento na outra sessão.
  Seus 159 testes do núcleo/API passaram localmente, com arquivos executados em
  sequência para reduzir o consumo simultâneo da máquina.
- Navegador em produção: importação e reimportação reais, zero erros JavaScript
  e ausência de overflow horizontal em 390 px.
- Os seis artefatos públicos conservaram seus hashes e as fronteiras de acesso
  pública e privada passaram na verificação HTTP após a importação.

A captura móvel e a verificação detalhada ficaram somente em
`var/product-inventory-live-9594fb54-c000-431a-974f-88c563d56984/` no checkout de
revisão. Não incluem credenciais e não integram a seleção pública.

## Continuidade

O cadastro agora tem cobertura parcial explícita dos quatro produtos, sem alegar
inventário completo. Permanecem pendentes a atribuição humana dos responsáveis
não identificados, os testes de runtime de cada regra e o piloto de autorização,
isolamento e persistência de uma capacidade do ERP. A semente de novas instalações
continua com oito fichas; o lote adicional é sempre uma importação explícita.
