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

- [ ] Escrever regressões e reproduzir ausência do adapter/reporter no GitHub CI.
- [ ] Implementar validação de manifesto, parser de artefato e projeção conservadora.
- [ ] Implementar reporter redigido e conferir resultados de processos node:test reais.
- [ ] Exportar tipos/API/reporter e documentar integração, limites e exemplo sintético.
- [ ] Revisar independentemente, aprovar CI completa do SHA final e registrar no Linear.

## Verificação

Somente GitHub CI. A suíte deve executar filhos reais de node:test com aprovação,
falha, skip, todo, duplicatas e testes aninhados. Testes também devem provar que
segredos sentinela nos logs/exceções não entram no artefato e que bytes adulterados
ou execuções incompletas nunca aprovam um fluxo. O workflow existente é preservado.

Referência de eventos: https://nodejs.org/docs/latest-v24.x/api/test.html#class-testsstream
