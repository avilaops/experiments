# Setup e ponto de continuidade — 27/10/2026

## Continuação: executor e inventário de rotas implantados

Revisão implantada em `apps-noclient`:
`5b89544c9589aa322b805298e4d328b6515d4e3a`, integrada pelo
[PR #3](https://github.com/avilaops/experiments/pull/3). A
[CI da main](https://github.com/avilaops/experiments/actions/runs/40600115055)
aprovou 200 testes núcleo/API, 14 do painel e 12 no navegador e construiu as imagens.
O servidor apenas carregou essas imagens e iniciou os serviços com `--no-build`.

A tela privada <https://ml.avilaops.com/experiments/routes> recebeu a captura
atual de fontes do ERP: 166 páginas e 50 registros de métodos BFF, na revisão 1.
A captura informa checkout com alterações; a API não foi capturada e todos os
216 registros permanecem sem teste funcional. O ERP foi somente inspecionado.

Importação, filtros, recarga, isolamento entre produtos e largura móvel de 390 px
foram conferidos no domínio real. As 16 fichas e o histórico do caderno continuam
na revisão 2. Os quatro arquivos anteriores mantiveram seus hashes, com backup
validado e a imagem anterior preservada para rollback.

O executor e as reservas persistentes estão disponíveis na biblioteca. A entrega
não configura adaptadores de produtos nem comprova chamadas reais em staging.
Os próximos trabalhos são essas integrações e a verificação funcional por fluxo,
com autorização e evidências próprias. Evidências e limites em
[implantacao-executor-rotas-20261027.md](evidencias/implantacao-executor-rotas-20261027.md).

## Continuação: inventário parcial registrado em produção

Oito fichas de Mail, CMS, CRM e TMS foram importadas explicitamente no painel
privado, após a CI aprovada da revisão `cf54d80419d776a6c88f0f661ad442fbc8a6d962`.
O caderno passou de oito para 16 fichas, na revisão 2. As fichas e o histórico
anteriores foram preservados; a reimportação não alterou revisão nem arquivo.

As referências das fichas foram fixadas nos commits inspecionados. O verificador
conferiu os 15 hashes de blobs nos quatro repositórios sem alterar os checkouts.
Isso comprova integridade das fontes conferidas, sem atestar runtime dos produtos.
O responsável técnico do CRM está identificado no README; os demais continuam
"A definir". As novas fichas registram implementação inspecionada, sem data de
verificação ou situação `verified`.

Foram aprovados 132 testes do núcleo/API e a CI completa de painel e navegador.
A aplicação usou o importador já implantado em `bf2b9a9`, com backup do catálogo.
Não houve troca de imagens nem build no servidor. Evidência em
[inventario-produtos-20261027.md](evidencias/inventario-produtos-20261027.md).

## Continuação: importação revisada implantada

Revisão implantada: `bf2b9a974bdc5939e52f8cd2c6e488a2257b71fa`, em
`apps-noclient`, com imagens construídas no GitHub, CI aprovada e backup.
O painel aceita listas de fichas JSON e a exportação do próprio caderno, apresenta
uma prévia e exige motivo e conferência explícita. O lote cria somente códigos
novos em uma gravação atômica e preserva integralmente os códigos existentes.

Foram aprovados 127 testes do núcleo/API, 13 do painel e 11 no Chrome na CI.
A conferência autenticada no domínio real concluiu uma reimportação sem mudanças:
oito fichas preservadas, revisão 1 e histórico iguais, sem alterações nos hashes
dos quatro arquivos persistidos. A criação de registros e os conflitos foram
testados com API e BFF reais em diretórios temporários.

Respostas JSON preservam o ETag por meio de `Cache-Control: no-store, no-transform`.
Isso corrige o erro observado quando a compressão do proxy acrescentava `-zstd`
ao ETag usado em If-Match. Detalhes em
[importacao-painel-20261027.md](evidencias/importacao-painel-20261027.md).

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
abaixo descrevem as respectivas etapas anteriores. A seção mais recente registra
a implantação atual; não afirma que os inventários, integrações ou pilotos
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

### Inventário parcial de Mail, CMS, CRM e TMS

O [inventário dos produtos](docs/PRODUCT-POLICY-INVENTORY.md) acrescenta oito
fichas importáveis, com referências fixadas em commit e 15 hashes de blobs Git.
O comando `npm run policies:verify -- var/product-repositories.json` compara
as referências e os bytes sem alterar os checkouts dos produtos. As oito fichas
registram implementação inspecionada, sem declaração de verificação de runtime.
O README identifica o responsável técnico do CRM; os demais continuam "A definir".
A aplicação explícita foi concluída em produção: 16 fichas na revisão 2,
com reimportação sem mudanças e os registros anteriores preservados.

### Importação revisada de políticas pelo painel

A continuação implementa prévia validada e importação atômica de fichas novas,
com preservação de códigos existentes, motivo, If-Match e conferência explícita.
Aceita listas de fichas e a exportação do próprio caderno, sem restaurar revisões,
versões ou histórico antigos. O CLI anterior permanece sequencial.

Validação na CI: 127 testes núcleo/API, 13 do painel e 11 no Chrome aprovados.
Os cenários cobrem recusa integral de lote inválido, concorrência, capacidade,
reimportação sem mudanças e confirmação renovada após conflito. A publicação
foi concluída em `bf2b9a9`. Respostas JSON da API e do BFF usam no-transform
para preservar o ETag da revisão durante a passagem pelo proxy de compressão.
Os inventários de outros produtos continuam
dependendo de fontes conferidas e responsáveis reais.

### Reservas persistentes e reconciliação — AVL-342

O executor agora aceita armazenamento privado opcional de operações. A criação
exclusiva da reserva impede redispatch após reinício ou disputa entre processos
no mesmo sistema de arquivos local. A consulta `reconcile` tem autorização
separada e só resolve a incerteza mediante recibo confirmado do domínio.
O replay persistente informa quando a saída bruta não está disponível, sem
gravar dados empresariais para reconstruí-la.

Foram aprovados 147 testes núcleo/API; os 12 novos cobrem reservas, queda de
processo, concorrência, integridade, conflitos e recibo HTTP. O exemplo
`npm run test:tools:durable` usa três processos locais e dados sintéticos.
Ver [contrato](docs/TOOL-OPERATION-STORE.md) e
[evidência](evidencias/durable-tools-20261027.md).

A primeira inspeção SSH desta continuação encontrou a revisão `57b2418`.
Uma implantação independente avançou o servidor durante o trabalho; a verificação
final confirmou API e painel saudáveis com tags
`sha-0dba98de0ce1ad04f700a87017d3285d4bb214f2`, correspondentes ao `REVISION`
da release. Os checkpoints anteriores de imagem são históricos. Esta etapa não
alterou o servidor. Os componentes de persistência são opt-in e ainda não estão
integrados a um serviço de staging.

O [PR #1](https://github.com/avilaops/experiments/pull/1) reúne o executor e as
reservas persistentes. Na revisão de código `5e205ee`, passaram as CIs de
[push](https://github.com/avilaops/experiments/actions/runs/40564524943) e
[pull request](https://github.com/avilaops/experiments/actions/runs/40564603608),
incluindo testes de navegador; as imagens foram construídas no GitHub.

O proprietário esclareceu que a geração de PDF conectada ao fiscal do ERP-Next
ainda não existe. A lacuna consta na [proposta fiscal](docs/FISCAL-DECISION-PROPOSAL.md)
e permanece separada da impressão das fichas do laboratório.

### Executor instrumentado — AVL-342

Primeira entrega local de `tool-execution/1`, autorização por chamada, journal
privado, redação integral de payloads e tratamento de interrupção/repetição.
Ver [contrato e limites](docs/TOOL-EXECUTION.md) e
[evidência com inspeção SSH](evidencias/tool-execution-20261027.md).
O aceite de staging permanece pendente. A API implantada em `apps-noclient`
foi inspecionada por hashes e ainda corresponde ao código anterior ao caderno;
não é o HEAD local nem esta entrega. Nenhuma implantação foi executada.

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
# Optional Langfuse tracing

The backend supports Langfuse JS SDK 6.0.2 (Langfuse Cloud v4 or self-hosted
Langfuse >= 4.59.0). Tracing is disabled by default. Set these variables through
the deployment secret manager; never commit values:

```dotenv
LANGFUSE_TRACING_ENABLED=true
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

All four settings are required. HTTPS without credentials in the URL is required.
Existing Compose `env_file` forwards these settings to the API. Configuration
is read on the first instrumented operation; restart after changing it.

`run-experiment` contains executor and evaluator observations. Real registered
tool dispatches have type `tool`, nested under `execute-tool-call`. Denied and
replayed attempts retain the parent observation without inventing a dispatch.
Only numeric counts, repetition numbers, completion flags and reconciliation
flags are exported. Inputs, outputs, identities, tenant IDs, tool names,
business effect references and exception messages remain private. There are
no generation, model or token observations because these paths do not call LLMs.

Short-lived library callers should `await flushObservability()` before exiting;
the SDK also shuts down on `beforeExit`. The exporter is asynchronous and failures
do not change experiment or tool results. OpenTelemetry SDK 0.220.0 is pinned
because SDK 0.300.0 requires API 1.10, incompatible with Langfuse's current peers.
Tests and builds run only in the existing GitHub CI workflow. Live trace delivery
must be checked after configuring project credentials in an authorized environment.
