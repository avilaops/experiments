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

- [x] Adaptador: retain síncrono, recall e reflect, banco fixo, entradas fechadas,
  limites, expiração, erros sem payloads e métricas sem conteúdo.
- [x] Testes de contrato via HTTP e MCP stdio, negativas e dois bancos.
- [x] Compose privado/autenticado, recursos e volume; imagem e pacote na CI.
- [x] Teste PostgreSQL: pgvector, persistência e backup/restore em banco separado.
- [x] Avaliação real opt-in preparada, distinta dos contratos; execução pendente.
- [x] Runbook: retenção/exclusão, backup, restauração, rollback/desinstalação,
  responsabilidades e gates para aprovação operacional.

## Verificação

Testes do adaptador usam `node:test`, como os scripts existentes. Nenhum teste
de contrato será apresentado como prova do runtime Hindsight. A integração real
deve medir recuperação/isolamento, CPU/RSS, latência, tokens/custo e recuperação
de backup. Ausência de uso/preço é `null`, nunca custo zero presumido.

## Estado

Plano registrado antes da implementação. A autorização deste pedido cobre o
checkout e a CI; qualquer ativação operacional permanece fora desta autorização.

Na revisão de código `0271d869cd8ed0723ae373bb8cb9b62696cf2f69`, a
[CI do piloto](https://github.com/avilaops/experiments/actions/runs/41642019630)
aprovou `contract`, `storage` e `package`; `live` não foi executado. O
[pacote produzido](https://github.com/avilaops/experiments/actions/runs/41642019630/artifacts/13233123055)
contém a imagem do adaptador e os digests upstream. Esses resultados não
certificam isolamento, qualidade, custo ou recuperação do runtime Hindsight real.

## Aceite ainda pendente

- [ ] Provedor/modelo, teto de gasto e credencial exclusiva aprovados.
- [ ] Environment de CI protegido e fluxo real/restore executados com sucesso.
- [ ] Métricas e ledger de custo real conferidos; decisão de ampliar/encerrar.
- [ ] Responsável operacional, prazo e procedimento de exclusão atribuídos.
- [ ] Aprovação explícita de qualquer deploy/alteração operacional.
