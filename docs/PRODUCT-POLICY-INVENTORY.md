# Inventário parcial de políticas dos produtos

O lote [product-inventory.json](../examples/policies/product-inventory.json)
contém duas fichas de cada produto: Mail, CMS, CRM e TMS. As regras foram
inspecionadas no código dos commits indicados nas referências. A situação
`implemented` significa implementação lida, sem execução do produto nesta etapa.
Nenhuma ficha do lote declara `verified` ou data de verificação.

| Produto | Fichas | Escopo inspecionado |
| --- | --- | --- |
| Mail | MAIL-ACCESS-001, MAIL-DATA-001 | Caixa da sessão, leitura de mensagens/anexos e sanitização de HTML |
| CMS | CMS-ACCESS-001, CMS-PUBLICATION-001 | Participação e exceção da equipe; consulta da versão publicada |
| CRM | CRM-ACCESS-001, CRM-INTEGRATION-001 | Sessão, vínculos por empresa e state do OAuth do Google |
| TMS | TMS-ACCESS-001, TMS-DATA-001 | Perfil atual, capacidades e transações com contexto de empresa |

As fichas incluem as exceções encontradas: equipe do CMS com poder de Dono,
cliente `sistema` privilegiado do TMS e guard de vínculos limitado às rotas e
campos que o código reconhece no CRM. Não constituem inventário completo ou
auditoria de todas as rotas.

O README do CRM identifica Nícolas Ávila como responsável técnico. Essa fonte
foi vinculada às duas fichas, sem afirmar aprovação do inventário. Mail, CMS e
TMS ficam com responsável "A definir"; nomes de agentes no controle de tarefas
não são uma atribuição humana da política.

## Reproduzir a conferência das fontes

O [manifesto](../evidencias/inventario-produtos-fontes-20261027.json) registra
origem, commit, caminho e SHA-256 dos 15 blobs Git. O verificador confere:

1. O contrato das fichas e a ausência de códigos repetidos.
2. Correspondência entre todas as referências das fichas e todas as fontes do
   manifesto, sem fontes extras ou referências sem cobertura.
3. Uma única origem e revisão por repositório do inventário.
4. A origem do checkout e os bytes do blob no commit indicado.

Ele lê `git show <commit>:<caminho>`. Não faz checkout, restaura arquivos ou
depende das quebras de linha da cópia de trabalho. O CRM pode continuar esparso.
O Git pode obter um blob ausente do remoto configurado em um clone parcial;
acesso ao repositório precisa estar disponível. O verificador não instala ou
executa os produtos.

Crie um JSON local, fora do Git, com os caminhos dos checkouts:

```json
{
  "mail": "D:/Projetos/SaaS/mail.avilaops.com",
  "cms": "D:/Projetos/SaaS/cms.avilaops.com",
  "crm": "D:/Projetos/Docs/crm.avilaops.com",
  "tms": "D:/Projetos/SaaS/TMS"
}
```

Depois execute:

```powershell
npm run policies:verify -- var/product-repositories.json
```

O resultado separa `sourceIntegrityVerified` de `productRuntimeVerified`, que
permanece falso. `inventorySha256` identifica o JSON das fichas normalizadas pelo
contrato, não os bytes ou a formatação do arquivo original. A comparação de
hashes não atesta o significado da regra nem sua operação em produção.

## Importar no caderno privado

Depois da conferência, abra o importador do painel e selecione o lote. Confira
as oito fichas, registre o motivo e confirme. A importação atômica do painel
preserva códigos já existentes; não promove nem atualiza fichas automaticamente.
Uma edição anterior de responsável, regra ou fonte continua valendo.

Em uma instalação com as oito fichas iniciais, o lote acrescenta oito e o
catálogo passa a 16. Isso depende do estado da instalação: o inventário não
muda a semente nem é aplicado na inicialização. Repetir o mesmo lote não cria
outra revisão quando todos os códigos já existem.

As referências e o histórico permanecem no cadastro privado. O lote não passa
a integrar a seleção pública de evidências. Para declarar verificação futura,
execute os testes de cada regra no ambiente adequado e registre sua evidência
e suas limitações na ficha correspondente.
