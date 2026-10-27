# Caderno de políticas Ávila Ops

## Objetivo

Consultar como uma ficha de papel: qual é a regra, a qual produto pertence,
quem cuida, onde é definida, onde é aplicada e que teste ou evidência a sustenta.
O caderno é um cadastro privado; não executa políticas nos produtos.

## Origem e princípios compartilhados

O proprietário iniciou esta discussão a partir de
`D:\Projetos\SaaS\erp-next\Untitled-1.md`, buscando documentação ligada à
engenharia e uma identidade própria da Ávila Ops. A referência visual de outro
produto não autoriza copiar sua identidade. Branco e verde-petróleo `#0f766e`
fazem parte da direção visual já aplicada ao ERP local e ao laboratório.

Foram discutidos Utoipa, Specta, mdBook, Pagefind, SWC, MDX/Fumadocs e Eve.
A discussão não equivale a instalação, integração, escolha definitiva ou
obrigatoriedade dessas ferramentas para todo o portfólio. O acervo da Eve foi
indicado em `D:\Projetos\Docs\Framework\eve`; sua existência não comprova
integração com os produtos. Afirmações antigas do material precisam ser
conferidas antes de virarem decisões.

Princípios registrados:

- Construir identidade própria e selecionar ferramentas por finalidade.
- Documentação explica e demonstra; contrato descreve; executor autoriza e aplica
  regras. Uma dessas responsabilidades não substitui as outras.
- Definir sucesso, implementar, verificar e preservar evidências, inclusive
  resultados negativos. Distinguir proposta, implementação e verificação.
- Padronizar obrigações verificáveis entre produtos, preservando suas necessidades
  e stacks existentes. Não pressupor reescrita de todo o portfólio em Rust.

## Usar

Na implantação que contiver esta funcionalidade, abra
`/experiments/policies`, sob a autenticação privada do painel.
O link também aparece na navegação do laboratório.

- Pesquise por texto, produto, situação, responsável ou local de implementação.
- Abra uma ficha para ler as fontes e as versões anteriores.
- Cadastre ou revise com um motivo de alteração obrigatório.
- Use "Imprimir ficha" para impressão ou PDF pelo navegador.
- Exporte o caderno em JSON para consulta e cópia externa.
- Retire uma política de uso mudando sua situação; não há exclusão física pela API.

Princípios compartilhados aparecem nos filtros de cada produto, mas isso não
atesta sua implementação. Produtos sem fichas próprias ficam com inventário
pendente. Nenhuma lista é apresentada como inventário completo.

## Situações declaradas

| Situação | Exigência do cadastro |
| --- | --- |
| Proposta | Regra e responsável, ainda que "A definir" |
| Documentada | Pelo menos uma referência de documento |
| Implementada | Local de aplicação e referência de código |
| Verificada com evidência | Implementação, data válida não futura, teste e evidência |
| Retirada de uso | Mantém a ficha e o histórico |

Esses requisitos validam o preenchimento; não comprovam que a fonte é verdadeira,
executam testes nem garantem a autenticidade de um trace. Quem registra a situação
precisa conferir as referências. Caminhos e URLs são texto; o serviço não lê
arquivos arbitrários nem busca URLs fornecidos pelo editor.

## Inventário inicial

O primeiro cadastro contém oito fichas: dois princípios compartilhados, duas
fichas do ERP, duas do laboratório e duas propostas industriais para o Lojas
(condições comerciais por cliente e separação do cache de preço negociado).
Mail, CMS, CRM e TMS continuam pendentes de inventário específico.

As fontes iniciais do ERP foram lidas em `docs/.old/architecture.md` e
`apps/api/src/platform/access.rs` do checkout local. As regras do laboratório
apontam para seus avaliadores e para o exportador público. Nenhuma ficha inicial
é marcada como verificada. Responsáveis ainda precisam ser atribuídos pela equipe.

## API e persistência

- `GET /api/v1/policies`: produtos, fichas, histórico e ETag.
- `PUT /api/v1/policies`: `{policy, changeNote}` com `If-Match`.
- Sem revisão: 428. Revisão desatualizada: 412. Entrada inválida: 400.
- O BFF encaminha essas rotas após autenticação e conserva o ETag.
- O contrato detalhado está no OpenAPI existente.

Cada gravação aumenta a revisão do caderno e a versão da ficha alterada. O estado
e os snapshots ficam juntos em `LAB_DATA_DIR/policies.json`, usando escrita
temporária e renomeação. Um reinício preserva o cadastro. O inventário inicial
somente é criado quando esse arquivo não existe; atualizar o código não
sobrescreve fichas já editadas.

O armazenamento suporta um processo da API. A fila de alterações não coordena
réplicas. O histórico cresce sem descarte automático e precisa integrar o backup
do volume. Hashes, arquivos e snapshots não constituem armazenamento inviolável.
O painel atual usa credencial compartilhada: o responsável da ficha não identifica
quem efetivamente editou e não implementa autorização individual por produto.

Não exportar esse cadastro, suas referências internas ou seu histórico para a
página pública de evidências. O exportador público continua limitado aos JSONs
sintéticos selecionados separadamente.

## Prévia local

```powershell
cd D:\Projetos\avila-experiments
npm run build
npm --prefix dashboard run build
node scripts/preview-policies.mjs
```

URL: `http://127.0.0.1:3311/experiments/policies`.
Credenciais exclusivas da prévia local: `laboratorio` / `local-policy-preview-2026`.
Não são credenciais de produção. A prévia usa portas 3310/3311 no loopback e dados
separados em `var/policies-preview-v1/`; encerre com Ctrl+C.

## Continuidade

### Importar fichas adicionais sem substituir edições

O inventário fiscal do Lojas tem cinco fichas adicionais em
`examples/policies/lojas-fiscal.json`. As fontes, os 23 testes locais e as
limitações estão em [evidencias/fiscal-lojas-20261027.md](evidencias/fiscal-lojas-20261027.md).
Ele é importado explicitamente, sem mudar o cadastro inicial de oito fichas.

Com a prévia local ativa:

```powershell
node scripts/import-policies.mjs examples/policies/lojas-fiscal.json --preview
```

O modo `--preview` usa exclusivamente a API local de desenvolvimento. Para outra
API, informe `LAB_API_URL` e `LAB_API_TOKEN` no ambiente privado e omita a opção.
O importador valida as fichas antes de solicitar gravações, exige ETag, não segue
redirecionamentos e preserva IDs já existentes. Uma disputa de revisão interrompe
a importação; confira o histórico antes de repetir. Gravações anteriores ao
conflito podem ter sido concluídas. Repetir não sobrescreve fichas já cadastradas.

A proposta de evolução do motor fiscal do ERP está em
[docs/FISCAL-DECISION-PROPOSAL.md](docs/FISCAL-DECISION-PROPOSAL.md).
Esse desenho não implementa cálculo, aprovação ou integração tributária.

### Entregas seguintes

1. Validar a ficha, a edição e a impressão no navegador desktop e móvel.
2. Publicar esta versão do serviço e do painel com backup e rollback, preservando
   o volume e a seleção pública. Somente então declarar a URL de produção disponível.
3. Inventariar cada produto por fontes verificadas e atribuir responsáveis.
4. Vincular execuções reais de testes às fichas; a marcação manual atual não é
   uma integração automática com o CI.
