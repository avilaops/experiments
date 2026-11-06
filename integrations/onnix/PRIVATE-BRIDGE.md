# ONNIX no painel Ávila Ops

A API do Experiments é mantida em `127.0.0.1:3300` para o próprio host. Para leitura autenticada do painel `app.avilaops.com` pela rede WireGuard, acrescentar somente o binding `10.10.0.4:3300` conforme `compose.private.yml`.

## Controles

- Firewall da origem: liberar TCP 3300 na interface `wg0` somente de `10.10.0.2` para `10.10.0.4`.
- Manter `LAB_API_TOKEN` obrigatório; no `applications`, guardar `EXPERIMENTS_PRIVATE_API_URL=http://10.10.0.4:3300` e `EXPERIMENTS_API_TOKEN` apenas no ambiente da aplicação, permissões 0600.
- No app central, permitir a visualização somente a OWNER e jamais enviar token ao navegador.
- Usar `docker compose -f compose.yaml -f /opt/avila-experiments/compose.private.yml` em atualizações posteriores, preservando o override.
- Não criar DNS público, nova publicação MCP ou nova instância PostgreSQL.
- Endpoint `GET /api/v1/onnix` apenas lê o arquivo de evidência. Não controla inferência ou gravações.

O volume `evidence` persiste os resultados de inferência. O ONNIX permanece em `127.0.0.1:3391` e não deve ser exposto pela rede.

## Verificações

A API do Experiments deve responder `GET /health` 200 em `10.10.0.4:3300`; o endpoint `/api/v1/onnix` sem Bearer deve responder 401 e com Bearer adequado deve devolver a evidência. Uma coleta indisponível ou antiga deve aparecer como tal, não como sucesso.
