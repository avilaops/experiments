# Setup e ponto de continuidade — 27/10/2026

## Repositório de trabalho

O laboratório independente está em `D:\Projetos\avila-experiments`.
O checkout do ERP está em `D:\Projetos\SaaS\erp-next` e o Lojas em
`D:\Projetos\SaaS\lojas.avilaops.com`. Preservar mudanças existentes em ambos.

O código do caderno de políticas está neste repositório independente, usando o
servidor HTTP e o painel React já existentes. Não houve alteração das regras de
negócio ou da stack do ERP/Lojas para criar o cadastro.

## Decisões preservadas

- Identidade própria Ávila Ops; branco e verde-petróleo como direção visual.
- Documentação, contratos e executor têm responsabilidades distintas.
- Ferramentas discutidas são opções avaliadas por finalidade; não constituem uma
  migração obrigatória de todos os produtos para Rust, Eve ou qualquer framework.
- Políticas compartilhadas e específicas precisam apontar para suas fontes.
- Proposta, documentação, implementação e verificação são situações diferentes.
- LiteLLM, embeddings, MCP e integrações remotas dependem de necessidade e
  verificação; sua instalação não é pré-requisito do cadastro.
- Dados do caderno são privados e não integram a seleção pública de evidências.

## Caderno de políticas

Referência completa: [POLICIES.md](POLICIES.md).

- Tela: `/experiments/policies` na versão que contiver esta funcionalidade.
- Prévia local: `http://127.0.0.1:3311/experiments/policies`.
- API: `GET` e `PUT /api/v1/policies`, protegidos como os dados do laboratório.
- Persistência: `LAB_DATA_DIR/policies.json`, com versões e histórico no mesmo arquivo.
- Atualizações exigem ETag/If-Match e motivo. Conflitos retornam 412.
- O inventário inicial tem oito fichas. Nenhuma é marcada como verificada.
- Mail, CMS, CRM e TMS permanecem com inventário específico pendente.

O cadastro é manual e não aplica regras nos produtos. A situação declarada exige
campos compatíveis, mas não representa uma execução automática de testes ou uma
prova da autenticidade das fontes. O responsável da ficha não identifica o editor
sob a autenticação compartilhada atual.

## Validação deste checkpoint

- Núcleo/API: 72 testes aprovados, incluindo seis testes do cadastro.
- Painel/exportação: sete testes aprovados, incluindo autenticação e conflito do
  caderno no BFF e a fronteira completa da exportação pública.
- Build TypeScript/esbuild/MDX aprovado.
- Navegador local: oito fichas carregadas, abertura de ficha, edição e gravação
  confirmadas; versão 2 e versão 1 aparecem no histórico após salvar com motivo.
- Desktop e móvel: capturas realizadas; largura do documento de 390 px para
  viewport de 390 px, sem overflow horizontal; nenhuma mensagem de erro no console
  da navegação final sem credenciais embutidas na URL.
- Persistência após reinício e conflito entre gravações verificados por testes HTTP.

O login da prévia consta em `POLICIES.md` e é exclusivo de desenvolvimento.
Não registrar credenciais de produção neste documento.

## Próximos passos

### Continuação fiscal em 27/10/2026

Foram executados 23 testes locais do fiscal existente no Lojas, sem alteração
de linguagem ou chamada a produção. Cinco fichas foram importadas explicitamente
na prévia: uma implementada e quatro com verificação local delimitada. O caderno
passou a ter 13 fichas na revisão 7; repetir a importação preservou as fichas e
a revisão. O cadastro inicial de uma instalação nova permanece com oito fichas.

O núcleo/API e os testes do importador passaram em 75 testes. O relatório fiscal,
os hashes e o comando estão em `evidencias/fiscal-lojas-20261027.md` e `.json`.
A proposta de contrato fiscal do ERP está em `docs/FISCAL-DECISION-PROPOSAL.md`.
Essa proposta distingue monitoramento de documentos, apuração, vigência, simulação
de impacto e aprovação; não declara essas novas capacidades implementadas.

### Entregas seguintes

1. Conferir a impressão e o conflito entre duas telas no navegador antes de publicar.
2. Implantar o caderno com backup do volume e rollback, preservando os registros
   existentes. A funcionalidade deste checkpoint ainda não foi implantada.
3. Atribuir responsáveis e inventariar os demais produtos por fontes verificadas.
4. Retomar o piloto de contrato, autorização e CI de uma capacidade do ERP.
5. No Lojas, avaliar primeiro cotação por cliente e confirmação do pedido na stack
   existente; busca semântica vem após uma referência textual medida.

SEO, indexação e mídias têm seu planejamento anterior no roadmap do experimento
do checkout ERP. Antes de consolidar documentos entre repositórios, conferir as
versões e manter rastreabilidade, sem sobrescrever fontes.
