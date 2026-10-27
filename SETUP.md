# Setup e ponto de continuidade — 27/10/2026

## Continuação: conflitos e impressão implantados

Revisão implantada: `5d86e85271f2eabffbcf982dbd170de40795e844`, em
`apps-noclient`, com CI aprovada, backup e hashes dos dados preservados.
O caderno reúne alterações independentes, exige escolha para campos em conflito
e continua verificando a revisão em cada gravação. A impressão da ficha salva
usa papel A4 branco, margens de 16 mm e a indicação de cadastro privado e manual.

Validação: 120 testes do núcleo/API, 11 do painel e sete no Chrome aprovados
na CI. Os cenários de duas telas usam API e BFF reais em dados temporários.
A conferência no domínio implantado usou respostas controladas para exercitar
o conflito sem gravar em produção e gerou um PDF a partir da ficha salva real.
Detalhes em [conferencia-caderno-20261027.md](evidencias/conferencia-caderno-20261027.md).

## Atualização implantada em 27/10/2026

As quatro correções da revisão foram implantadas em `apps-noclient`, revisão
`57b2418622321f46f6ef34d3a14b3af4b25ea91b`, após a CI aprovada na main.
O caderno está disponível em <https://ml.avilaops.com/experiments/policies>,
com autenticação. A instalação em produção contém oito fichas iniciais na
revisão 1; os inventários adicionais da prévia local não foram importados.

Foram corrigidos os metadados mutáveis dos avaliadores, o cadastro com código
duplicado, a edição durante gravações e a leitura integral do histórico em cada
página. A CI valida núcleo, painel e navegador e constrói as imagens no GitHub.
Os dados anteriores foram preservados por hash e há backup e imagens anteriores
para rollback. Detalhes e evidências em
[correcoes-review-20261027.md](evidencias/correcoes-review-20261027.md).

As contagens e afirmações de ausência de implantação nas seções de checkpoints
abaixo descrevem as respectivas etapas anteriores. Esta seção registra a
implantação atual; não afirma que os inventários, integrações ou pilotos
pendentes tenham sido concluídos.

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

### Executor local de referências

O [carregador de referências](docs/FISCAL-REFERENCE-EXECUTOR.md) lê arquivos JSON,
confere hash dos bytes, identidade, versão, intervalo e fingerprint do contexto
antes de produzir a resolução e chamar o planejador. Aceita somente referências
de engenharia por operação, sem cálculo ou validação fiscal oficial.

`npm test`: 116 aprovados. `npm run test:fiscal-reference`: cinco cenários
reconhecidos e 16 artefatos com hashes/tamanhos conferidos. Evidência em
[fiscal-reference-20261027.md](evidencias/fiscal-reference-20261027.md).

### Planejamento de caminhos fiscais 0.1

O [contrato de execução](docs/FISCAL-EXECUTION-CONTRACT.md) acrescenta schema de
resolução declarada e planejamento por linha vinculado ao fingerprint da entrada
e ao snapshot. Dados pendentes bloqueiam todo o documento. As rotas aplicável e
não aplicável são explícitas; a aplicabilidade real ainda não é resolvida aqui.

`npm test`: 107 testes aprovados. `npm run test:fiscal-path`: cinco resultados
esperados reconhecidos, com um aprovado, três reprovados e um inconclusivo.
Relatórios por runId e [evidência](evidencias/fiscal-execution-20261027.md)
preservados. Não há cálculo tributário, emissão ou integração Rust adicionados.

### Contrato fiscal experimental 0.1

Foi implementado o [contrato de entrada](docs/FISCAL-INPUT-CONTRACT.md) com JSON
Schema, validador de contexto e fixture deliberadamente fictícia para simulação
de venda doméstica. São 19 testes novos, incluindo 3 mil linhas e rejeição de
campos/valores inválidos. `npm test`: 99 aprovados. O CLI retornou
`context_recorded` para o exemplo; isso não é aprovação fiscal. Sem cálculo,
integração Rust, consulta operacional ou deploy adicionados por esta etapa.
Ver [evidência](evidencias/fiscal-input-20261027.md).

### Coleta automatizada do Siscomex

O comando `npm run collect:siscomex -- D:\Projetos\Docs\Siscomex` foi implementado
e executado duas vezes com sucesso. Foram processados 181 endereços, arquivados
178 documentos e inventariados 27 contratos com 320 operações. Hashes e tamanhos
conferidos; nenhuma mudança entre as duas capturas completas.

As 27 fichas geradas foram importadas como propostas na prévia local, que passou
a ter 40 fichas na revisão 34. Reimportação preservou todas. O cadastro não foi
implantado em produção. `npm test`: 80 testes aprovados. Detalhes em
[coleta do Siscomex](docs/SISCOMEX-COLLECTION.md) e
[evidência da coleta](evidencias/siscomex-20261027.md).

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

1. Conferência de conflitos e impressão implementada nesta continuação. Duas
   telas preservam alterações independentes e exigem escolha para campos
   conflitantes. Sete testes no Chrome incluem geração de PDF A4 da ficha salva;
   os 11 testes do painel também passaram. Publicação concluída em `5d86e85`.
2. O caderno foi implantado em `57b2418`, com backup e rollback, conforme a
   atualização no início deste documento. Atualizações devem preservar os registros.
3. Atribuir responsáveis e inventariar os demais produtos por fontes verificadas.
4. Retomar o piloto de contrato, autorização e CI de uma capacidade do ERP.
5. No Lojas, avaliar primeiro cotação por cliente e confirmação do pedido na stack
   existente; busca semântica vem após uma referência textual medida.

SEO, indexação e mídias têm seu planejamento anterior no roadmap do experimento
do checkout ERP. Antes de consolidar documentos entre repositórios, conferir as
versões e manter rastreabilidade, sem sobrescrever fontes.
