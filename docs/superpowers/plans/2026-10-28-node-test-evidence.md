# Evidências de node:test para planos de fluxo

**Objetivo:** transformar resultados do executor real de testes em observações
vinculadas a plano, execução, fontes e ambiente, verificando os bytes do artefato.

**Arquitetura:** reporter ESM consumindo TestsStream do Node 24 e adapter puro
na biblioteca. Manifesto explícito liga casos únicos a checks runtime_assertion.
O reporter exporta somente IDs/status e resumo; descarta stdout, stderr,
diagnósticos e mensagens de erro. O adapter valida hash, proveniência e o resumo
final antes de chamar assessFlow. Não autentica a origem remotamente.

**Escopo:** módulo compartilhado do Experiments. O desenvolvimento de interfaces
e fluxos B2B do Lojas está em outro chat; este módulo não altera seus arquivos,
não enfraquece o plano de oito dimensões e não declara o piloto aprovado.

## Contrato

- Node 24, testes folha de nível superior identificados por arquivo/nome exatos.
- Manifesto antes da execução; um caso pertence a somente um check.
- Todos os casos vinculados são necessários para aprovar um check.
- Ausência mantém not_run/inconclusive; skip/todo não aprovam; falhas permanecem.
- Resumo ausente, corrida interrompida, repetição ambígua, versão não suportada,
  falha não vinculada ou alteração de run/manifesto/plano/hash são recusados.
- Artefato limitado a 4 MiB, sem payloads de testes, credenciais ou logs brutos.
- originAuthenticated continua false; integridade não comprova semântica do teste.

## Execução

- [x] Escrever regressões e reproduzir ausência do adapter/reporter no GitHub CI.
- [x] Implementar validação de manifesto, parser de artefato e projeção conservadora.
- [x] Implementar reporter redigido e conferir resultados de processos node:test reais.
- [x] Exportar tipos/API/reporter e documentar integração, limites e exemplo sintético.
- [x] Revisar independentemente, aprovar CI completa do SHA final e registrar no Linear.

## Verificação

Somente GitHub CI. A suíte deve executar filhos reais de node:test com aprovação,
falha, skip, todo, duplicatas e testes aninhados. Testes também devem provar que
segredos sentinela nos logs/exceções não entram no artefato e que bytes adulterados
ou execuções incompletas nunca aprovam um fluxo. O workflow existente é preservado.

Referência de eventos: https://nodejs.org/docs/latest-v24.x/api/test.html#class-testsstream

## Evidências da implementação

- RED inicial correto: CI 40643645924, 200 testes existentes aprovados e sete
  regressões recusadas por ausência do adapter.
- Primeira implementação: CI 40643969302 e 40643963687 aprovadas, inclusive
  dashboard, navegador e empacotamento de imagens no GitHub.
- Revisão independente encontrou soma inconsistente de contadores e prioridade
  de skip/todo. Regressões e casos adicionais executados na CI 40644362910:
  211 aprovados e uma falha, exatamente a aceitação do resumo contraditório.
  A combinação skip/todo já passou no evento real; a prioridade foi alinhada
  explicitamente ao executor. As duas correções foram enviadas.
- Suíte agora cobre 12 cenários do adapter, incluindo conjunção de vários casos,
  timeout real, limites e versão não suportada.
- Validação do código completo no commit 354ea2314e6e3590a53f742d890fbf98c34a2575:
  CI push 40644662834 e PR 40644669048 aprovadas. Núcleo: 212/212;
  dashboard: 14/14; navegador: 12/12. Build e imagens concluídos no GitHub.
- Artefato 12796444627 baixado e inspecionado: revisão exata, cinco hashes de
  fontes iguais aos arquivos versionados, quatro digests de eventos iguais aos
  relatórios. Cenários passed/failed/skipped/missing preservam respectivamente
  passed/failed/inconclusive/inconclusive; ausência mantém not_run.
- Revisão e correções concluídas. O PR e o Linear registram o resultado final.
  Este módulo não inclui merge, deploy, publicação npm nem aprovação de produto.
