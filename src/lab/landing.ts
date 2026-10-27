export const LANDING_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ávila Experiments · API</title>
  <style>
    :root { color-scheme: light; font: 16px/1.6 system-ui, sans-serif; color: #163b35; background: #f6faf8; }
    body { max-width: 760px; margin: 8vh auto; padding: 24px; }
    main { background: white; border: 1px solid #d9e6e0; border-radius: 16px; padding: clamp(24px, 5vw, 48px); }
    h1 { font-size: clamp(28px, 5vw, 40px); line-height: 1.15; margin: 12px 0 24px; }
    .label, a { color: #0f766e; } .label { font-weight: 700; letter-spacing: .08em; }
    li { margin: 14px 0; } a { font-weight: 600; text-underline-offset: 4px; }
    small { color: #526760; } code { overflow-wrap: anywhere; }
  </style>
</head>
<body><main>
  <div class="label">ÁVILA OPS / EXPERIMENTS</div>
  <h1>O laboratório tem uma API.</h1>
  <p>Consulte a suíte, o histórico e o contrato. Estes links retornam JSON;
  o painel visual de resultados ainda será desenvolvido.</p>
  <ul>
    <li><a href="/health">Estado do serviço</a></li>
    <li><a href="/openapi.json">Contrato OpenAPI 3.1</a></li>
    <li><a href="/api/v1/suite">Suíte e parâmetros atuais</a></li>
    <li><a href="/api/v1/runs">Histórico de execuções e resultados</a></li>
  </ul>
  <p>Para executar: <code>POST /api/v1/runs</code>, com JSON contendo a
  <code>revision</code> recebida ao consultar a suíte.</p>
  <small>Experimentos locais determinísticos de desenvolvimento. Não há chamadas a LLMs
  ou serviços de ML. Quando a autenticação estiver habilitada, as consultas aos dados
  exigem o cabeçalho Authorization: Bearer; abrir um link não envia esse cabeçalho.</small>
</main></body>
</html>`;
