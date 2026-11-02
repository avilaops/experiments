# Ávila Ops Labs — integração inicial de serviços

Referências: Linear AVL-329, AVL-339, AVL-340, AVL-419, AVL-425–428.

## Rotas em 02/11/2026
- `/experiments/`: dashboard privado do Experiments; corrigir redirecionamentos para preservá-lo.
- `/memoria/`: Hindsight por Caddy para porta interna 9999; API tenant exige chave própria.
- `/onnix/`: frontend de mídia no servidor; não confundir com autorização da API de processamento.
- `/evidencias/`: evidências públicas selecionadas, sem dados privados.
- `/api/v1/product-contexts/erp`: serviço específico; revisar contrato, visibilidade e política de leitura.

## Plano de migração seguro
1. Inventariar versões, containers, volumes, domínios, autenticação por rota e dependências.
2. Manter Basic Auth temporário nas rotas privadas enquanto o OIDC/PKCE não estiver implantado e testado. Credenciais e hashes não entram no repositório.
3. Migrar identidade pelo `auth.avilaops.com` com gateway server-side e sessão HTTP-only; testar 401/403, logout, redirecionamentos e autorização entre serviços.
4. Integrar serviços no catálogo somente quando seus healthchecks e autorização estiverem verificados. Links não significam prontidão, e valores de saúde não devem ser inventados.
5. Testar retain/recall/reflect, isolamento de memória, backup/restore e filtragem de dados sensíveis conforme AVL-419.
6. CI com testes e builds fora dos servidores; publicação por artefato versionado, backup, smoke tests e rollback.

## Critérios para publicação
- Testes em CI e revisão do PR concluídos, sem expor segredos.
- Verificação das rotas /experiments, /memoria, /onnix e /evidencias.
- Registro de imagem/digest, revisão, horário, responsável e recuperação.
- Nenhuma rota administrativa privada aberta anonimamente.
- Rollback documentado e testado antes de substituir autenticação de produção.

## Notas
Esta mudança de UI somente acrescenta navegação para Hindsight e Onnix. Não afirma que as integrações por API, MCP ou SSO estejam implementadas.
