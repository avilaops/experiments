# AVL-339 — revisão da publicação do laboratório

Observação de produção: 03/11/2026, 06:22:37 UTC (03:22:37 BRT).
Issue: [AVL-339](https://linear.app/avilaops/issue/AVL-339/revisar-publicacao-e-implantar-a-evolucao-local-do-laboratorio).
Esta revisão registra o estado observado e os bloqueios da aceitação. A rodada
produz documentação; não executa deploy, reinício, migração, restauração ou escrita
de dados em produção.

## Fonte e release observada

O recurso de repositório do projeto MLOps no Linear aponta para
[avilaops/experiments](https://github.com/avilaops/experiments).
O checkpoint `eaf8a169bf5d1f9821dcebb05c1c988fc7f00492` citado na issue
é ancestral do main observado, com 62 commits posteriores. Não deve ser usado
como descrição da versão atual.

- Main e dashboard: `1fc3aef76498e165fd9bb3b5a258013afe82c547`.
- API em execução: `5c386432d94ce90e1c76720e5401e03d9c5689b4`.
- O [diff entre essas revisões](https://github.com/avilaops/experiments/compare/5c386432d94ce90e1c76720e5401e03d9c5689b4...1fc3aef76498e165fd9bb3b5a258013afe82c547)
  modifica dashboard, testes, workflow, documentação e verificação de UI.
  Não modifica `src/` da API, Dockerfile ou dependências da raiz.
  Isso comprova igualdade dessas entradas de fonte, sem presumir igualdade de
  imagens reconstruídas.
- O checkout local permaneceu limpo em
  `75dbe162c3636a9879d030b65c9ad13a9079693a`, 29 commits atrás do main.
  A revisão usou fontes imutáveis do GitHub sem atualizar ou substituir esse checkout.
- `LICENSE-PENDING.md` mantém a licença pendente; os manifests dos pacotes
  usam `private: true` e `UNLICENSED`. Nenhuma licença foi escolhida e esta
  rodada não publica pacote npm.

A combinação observada é uma implantação parcial por serviço, não uma alegação
de que toda a release de main foi ativada. A pasta apontada por `current` e
seu arquivo `REVISION` identificam main; os dois containers identificam suas
próprias releases. Ambos estavam saudáveis e seus IDs permaneceram estáveis
durante a inspeção.

## Proveniência dos artefatos e imagens

Foram baixados os ZIPs do GitHub Actions e conferidos seu SHA-256, `REVISION`
e os três arquivos listados em `SHA256SUMS`. Os descritores de `index.json`
dentro de `images.tar.gz` correspondem aos digests OCI observados por
`docker image inspect`, inclusive `RepoDigests`. São digests de manifestos
OCI; o digest do blob de configuração é outro identificador.

| Serviço ativo | Revisão | Digest do manifesto OCI |
| --- | --- | --- |
| API | `5c38643…` | `sha256:c97e5ede1b6e9c8bb2a2a522585c134d8a43647733b222a75eba1e1ada82d9f4` |
| Dashboard | `1fc3aef…` | `sha256:d6e2fb48e39b2004271408f67b2ea3293d70ed35823336382cd5dff3e68d864c` |

| Release | CI e artefato | SHA-256 do ZIP |
| --- | --- | --- |
| API `5c38643…` | [run 41522995015](https://github.com/avilaops/experiments/actions/runs/41522995015), artefato `13177983299` | `6e5abb0abf705d168c06c9a2ed0279a6efe029f81b82e41cfa19ed6611f388bd` |
| Main `1fc3aef…` | [run 41574209203](https://github.com/avilaops/experiments/actions/runs/41574209203), artefato `13203075899` | `1d91ec32231a0cb6b7aab4e144ebc73c2f0685f5007fbac5635b14ae00504ea4` |

O workflow conserva artefatos por 14 dias. Esses IDs não substituem a preservação
autorizada da release para recuperação. Houve também uma execução cancelada no
SHA da API, `41569725473`; a evidência de sucesso acima é da execução concluída.

O run de main concluiu os quatro jobs com sucesso: 233 testes do núcleo,
24 testes HTTP/configuração do dashboard, 18 testes de UI Chromium,
um teste WebKit cobrindo larguras 320, 390 e 1440, verificação de UI e
empacotamento das imagens. Os logs incluem testes de ETag, concorrência,
reinício com persistência e recuperação do índice derivado.
São testes sintéticos de CI; não comprovam restauração do volume real.

## Dados, inicialização e compatibilidade

A persistência da aplicação usa arquivos JSON no volume, sem migração SQL nesta
release. Os pontos relevantes da fonte revisada são:

- `LabStore.initialize` cria a estrutura ausente, preserva a suíte existente
  e reconstrói `runs-index.json` a partir dos relatórios em `runs/`.
  A inicialização escreve esse índice derivado.
- `PolicyStore.initialize` cria o catálogo inicial somente quando ausente.
  A leitura incorpora metadados atuais dos produtos sem regravar o catálogo
  existente; atualizações persistentes usam arquivo temporário e rename.
- Contratos de clientes, inventários de rotas e contextos de produtos têm
  arquivos e snapshots próprios. A recuperação precisa incluir o volume inteiro,
  não apenas a suíte ou a exportação de políticas.
- A exportação funcional de políticas não substitui backup de arquivos,
  revisões e histórico. Mantenha a restrição atual de uma réplica da API.

Os testes de `test/api.test.mjs`, `test/policies.test.mjs`,
`test/review-integrity.test.mjs` e `test/client-contracts.test.mjs`
cobrem cenários de reinício, ETag e compatibilidade com volumes sintéticos antigos.
Não foi aberta a base privada em um novo processo nesta rodada.

Foram verificados dois backups existentes: ambos têm SHA-256 correspondente ao
sidecar, 54 entradas legíveis e nenhuma entrada com caminho inseguro.
O arquivo mais recente inspecionado foi criado em 02/11/2026, 20:55:54 UTC.
A comparação dos bytes com o volume vivo encontrou:

| Comparação com o backup | Quantidade |
| --- | ---: |
| Arquivos regulares no backup | 49 |
| Arquivos regulares no volume atual | 52 |
| Arquivos novos, ausentes do backup | 3 |
| Arquivos comuns com conteúdo diferente | 1 |
| Arquivos do backup ausentes no volume | 0 |

Logo, a cópia íntegra não representa o ponto atual de recuperação. Nenhum
conteúdo privado, nome de cliente ou identificador de registro foi exportado
para este documento. Localização e hashes dos backups ficam no registro
restrito da issue. Não foi criado backup novo nem exercitada a restauração.

## Verificação externa sem autenticação

Foram feitas requisições GET sem credenciais e leituras de healthcheck local.
Nenhuma mutação autenticada foi executada.

| Verificação | Resultado observado |
| --- | --- |
| API e BFF, healthcheck local | HTTP 200, status ok; API com autenticação exigida |
| [Raiz do portal](https://ml.avilaops.com/), Accept HTML | HTTP 303 para a entrada, cache no-store |
| [Entrada](https://ml.avilaops.com/auth/login) | HTTP 200, HTML, cache no-store |
| `/api/v1/policies` | HTTP 401 JSON |
| `/experiments/api/v1/suite` | HTTP 401 JSON |
| [Evidências públicas](https://ml.avilaops.com/evidencias/) | HTTP 200 |
| `node scripts/verify-public.mjs` | Exit 0; seis hashes e barreiras anônimas verificadas |

O script local tem o mesmo blob Git da versão de main
(`cace93a1393d9c63bbc7f8c86f585fba21dd3c38`).
A verificação confirma recusa anônima; HTTP 401 de uma rota retirada não comprova
que exista um serviço operacional atrás dela.

O manifesto público teve SHA-256
`3ea014c1d3675b9090cbb9d5f89c03fbffd4b15ffe14941822f3720504941224`.
Exatamente seis artefatos sintéticos da allowlist responderam 200, com tamanho e
SHA-256 iguais ao manifesto. Seus bytes também correspondem aos blobs da árvore
Git de main, calculados de forma independente. Nenhum corpus ou política privada
foi incluído nessa conferência pública.

Nesta rodada não foram verificados em produção login autenticado, ETag/412 por
escrita, criação de histórico, persistência após reinício ou rollback. O CI e as
leituras anônimas não substituem essas verificações.

## Critérios da AVL-339

| Critério | Classificação e evidência |
| --- | --- |
| Remoto, licença, diff e release | Comprovado para a combinação observada, com referências e licença preservada acima |
| Backup e compatibilidade | Parcial: arquivos íntegros e CI de compatibilidade; backup defasado e restauração real não exercitada |
| Build/testes exatos e migrações | Comprovado no CI das revisões identificadas; comportamento de inicialização documentado |
| Release separada, healthchecks e rollback | Parcial: releases e saúde observadas, imagens ligadas ao CI; recuperação/rollback não exercitados |
| URLs, autenticação, ETags/412, histórico e persistência | Parcial: URLs e recusa anônima verificadas; mutações e reinício reais pendentes |
| Manifestos e hashes públicos | Comprovado para os seis artefatos sintéticos observados |

Estado recomendado: **In Progress**. A entrega documental pode ser revisada,
mas não encerra a aceitação operacional da issue.

## Menor sequência para desbloquear a aceitação

A próxima etapa requer autorização explícita para backup consistente,
homologação com dados privados e eventual interrupção/reinício de produção,
conforme o escopo que for aprovado. Coordene a recuperação com
[AVL-340](https://linear.app/avilaops/issue/AVL-340) antes de executar;
não duplique a implementação de retenção, autoria ou autorização dessa issue.

1. Registrar a combinação exata de imagens aprovada e preservar os artefatos,
   Compose e configuração privada da release anterior em armazenamento restrito.
   Revalidar hashes e estado do serviço imediatamente antes da intervenção.
2. Produzir um novo backup consistente do volume completo com uma estratégia
   de quiescência aprovada, hash e inventário. A cópia precisa cobrir os arquivos
   adicionados e alterados identificados nesta revisão.
3. Restaurar essa cópia em volume isolado e rede privada, sem integradores nem
   publicação pública. Validar leitura dos registros existentes, histórico e
   comportamento da reconstrução do índice; comparar os originais preservados.
4. Exercitar ETag/428/412 e persistência após reinício com registros sintéticos
   identificáveis nessa homologação. Não usar mutações em políticas reais como
   mecanismo de teste.
5. Exercitar a reversão da combinação de imagens/configuração e a recuperação
   do volume em homologação. Reversão de imagem e restauração de dados são
   operações distintas; preservar os dados atuais antes de qualquer restauração.
6. Somente com release e intervenção aprovadas, implantar o escopo autorizado
   sem build no servidor, conferir saúde, entrada e barreiras reais e registrar
   o recibo da operação. Validação de escrita/reinício em produção exige
   autorização para esses efeitos; publicar somente a exportação sintética.

Critério de parada: se backup, compatibilidade, autenticação ou integridade
falhar, não avançar a implantação. Preservar o volume e registrar o erro antes
de escolher entre reversão de imagem, correção ou recuperação de dados.
