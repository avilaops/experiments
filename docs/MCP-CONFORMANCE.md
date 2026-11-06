# Homologação de transporte MCP — Ávila Ops

Ferramenta de preflight para cada MCP **independente**, em `scripts/mcp/conformance.mjs`. Ela não depende do gateway compartilhado `mcp.avilaops.com`.

## Execução segura

Com credenciais somente de leitura, injetadas pelo cofre:

```bash
MCP_TARGET_URL=https://crm.avilaops.com/mcp MCP_BEARER_TOKEN=... node scripts/mcp/conformance.mjs
```

O URL deve usar HTTPS e host de uma allowlist explícita de serviços Ávila Ops. Redirecionamentos são proibidos, o timeout é curto, e o token é carregado somente do ambiente, nunca incluído no relatório.

O teste faz somente:

1. `initialize`: negocia a versão do protocolo MCP e confirma a resposta JSON-RPC.
2. `notifications/initialized`: comunica a inicialização.
3. `tools/list`: confere nomes únicos, presença de `inputSchema` e registra hash SHA-256 do inventário de nomes.

**Não executa `tools/call`**, nem altera recursos. O resultado `passed` certifica apenas o transporte e o catálogo, não a segurança, tenant, escopos ou validade do conteúdo das ferramentas.

## Homologação posterior

Para habilitar um MCP no catálogo da Central, devem existir evidências **separadas** de OAuth/PKCE, escopos, isolamento entre tenants, operação read-only em dados autorizados, aprovação humana para escritas, health, recuperação e rollback. Sem essas evidências, manter `enabled=false` e status de revisão. Não reutilizar automaticamente credenciais entre aplicações.

## Limites

O teste inicial cobre a primeira página de `tools/list`, não paginação via cursor. Não inspeciona `resources/list` ou `prompts/list`. Alguns servidores MCP legítimos exigem handshake, sessão ou cabeçalhos próprios; nesse caso o teste deve retornar falha ou inconclusivo, nunca declarar homologação por HTTP 200. Este utilitário não modifica o painel nem as configurações dos serviços.
