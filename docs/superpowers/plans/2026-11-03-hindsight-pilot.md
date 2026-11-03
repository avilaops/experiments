# AVL-419 — plano do piloto Hindsight

**Objetivo:** produzir um pacote revisável de memória complementar para o agente
de avaliação sintética do `avilaops/experiments`, sem alterar serviços existentes.

**Decisões de implementação:** adaptador MCP stdio sem dependências adicionais,
API HTTP do Hindsight 1.1.0, PostgreSQL 16 com pgvector e corpus sintético fechado.
Um processo recebe um banco fixo. O agente não recebe ferramentas administrativas.
O corpus fechado evita depender de expressões regulares para autorizar dados.

**Alternativas consideradas:** acesso direto ao MCP upstream exigiria confiar ao
agente uma credencial com acesso administrativo a outros bancos; uma integração
no portal ampliaria o escopo para AVL-428. O adaptador mantém o piloto independente.

## Restrições

- Código em checkout; validação e imagens somente no GitHub CI.
- Cada job novo usa `timeout-minutes: 1`; timeout reprova, sem reduzir critérios.
- Nenhum deploy, migração operacional ou uso de credenciais de produção.
- Provedor/modelo e teto de gasto precisam de definição antes de chamadas reais.
- Memória não autoriza transações nem substitui fontes fiscais/financeiras.

## Entregas verificáveis

- [ ] Adaptador: retain síncrono, recall e reflect, banco fixo, entradas fechadas,
  limites, expiração, erros sem payloads e métricas sem conteúdo.
- [ ] Testes de contrato via HTTP e MCP stdio, negativas e dois bancos.
- [ ] Compose privado/autenticado, recursos e volume; imagem e pacote na CI.
- [ ] Teste PostgreSQL: pgvector, persistência e backup/restore em banco separado.
- [ ] Avaliação real opt-in, com evidência explicitamente distinta de contratos.
- [ ] Runbook: retenção/exclusão, backup, restauração, rollback/desinstalação,
  responsabilidades e gates para aprovação operacional.

## Verificação

Testes do adaptador usam `node:test`, como os scripts existentes. Nenhum teste
de contrato será apresentado como prova do runtime Hindsight. A integração real
deve medir recuperação/isolamento, CPU/RSS, latência, tokens/custo e recuperação
de backup. Ausência de uso/preço é `null`, nunca custo zero presumido.

## Estado

Plano registrado antes da implementação. A autorização deste pedido cobre o
checkout e a CI; qualquer ativação operacional permanece fora desta autorização.
