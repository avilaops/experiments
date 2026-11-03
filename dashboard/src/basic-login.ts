import { randomBytes } from "node:crypto";

const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (value: string) => value.replace(/[&<>"']/g, character => entities[character]!);

export function loginReturnTo(value: string | null): string {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")
    || /[\\\\\u0000-\u001f\u007f]/.test(value)) return "/experiments/";
  const target = new URL(value, "https://laboratory.invalid");
  if (target.origin !== "https://laboratory.invalid" || target.pathname.startsWith("/auth/")) return "/experiments/";
  const page = target.pathname.replace(/^\/experiments(?=\/|$)/, "").replace(/\/$/, "") || "/";
  if (!["/", "/policies", "/routes", "/contracts", "/flows", "/docs"].includes(page)) return "/experiments/";
  return target.pathname + target.search + target.hash;
}

export class BasicSessions {
  private readonly entries = new Map<string, number>();
  readonly lifetimeSeconds = 8 * 60 * 60;
  create(): string {
    for (const [id, expiresAt] of this.entries) if (expiresAt <= Date.now()) this.entries.delete(id);
    if (this.entries.size >= 1000) this.entries.delete(this.entries.keys().next().value!);
    const id = randomBytes(32).toString("base64url");
    this.entries.set(id, Date.now() + this.lifetimeSeconds * 1000);
    return id;
  }
  has(id: string | undefined): boolean {
    if (!id) return false;
    const expiresAt = this.entries.get(id);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) { this.entries.delete(id); return false; }
    return true;
  }
  delete(id: string | undefined): void { if (id) this.entries.delete(id); }
}

export function basicSessionCookie(id: string, secure: boolean, maxAge: number): string {
  return "avila_lab_basic_session=" + id + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (secure ? "; Secure" : "");
}

export function loginPage(returnTo: string, error = ""): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Entrar · Avila Ops Labs</title>
<style>
:root{font-family:Calibri,"Segoe UI",sans-serif;color:#173a36;background:#f5f8f7;font-size:16px;line-height:1.5;color-scheme:light}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;grid-template-rows:auto 1fr auto}
a{color:#0f766e;text-underline-offset:4px}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #b45e0c;outline-offset:4px}
header{padding:28px 6%;border-bottom:1px solid #d4e2dc;background:#fff}.brand{display:inline-flex;gap:10px;align-items:baseline;text-decoration:none;color:#173a36;font-size:24px;font-weight:700;letter-spacing:-.7px}.brand span{font-size:14px;font-weight:400;letter-spacing:0;color:#526b65}
main{width:100%;max-width:460px;margin:auto;padding:44px 24px}section{background:#fff;border:1px solid #d8e4de;border-radius:16px;padding:32px;box-shadow:0 10px 36px #173a3608}
.lock{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#526b65}.lock svg{width:16px;height:16px}
h1{font-size:30px;line-height:1.15;letter-spacing:-.9px;margin:18px 0 12px}p{margin:0 0 26px;color:#526b65}
label{display:block;font-size:14px;font-weight:600;margin:20px 0 7px}
input{font:inherit;display:block;width:100%;min-height:48px;padding:12px 14px;border:1px solid #9fb9ad;border-radius:7px;background:#fff;color:#173a36}
button{font:inherit;font-weight:600;width:100%;min-height:48px;margin-top:28px;padding:12px 18px;border:1px solid #0f766e;border-radius:7px;background:#0f766e;color:white;cursor:pointer}button:hover{background:#115e59}
.error{margin:20px 0 0;padding:12px 14px;background:#fbe8e7;color:#8f2929;border:1px solid #edc6c2;border-radius:7px;font-size:14px}
.public{display:block;text-align:center;font-size:14px;margin:24px 0 0}
footer{text-align:center;color:#526b65;font-size:13px;padding:0 24px 26px}
@media(max-width:420px){header{padding:22px 24px}main{padding:32px 20px}section{padding:26px 22px}h1{font-size:28px}}
</style>
</head>
<body>
<header><a class="brand" href="/"><strong>Avila Ops</strong><span>Labs</span></a></header>
<main>
<section aria-labelledby="login-title">
<div class="lock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Área privada</div>
<h1 id="login-title">Entre no laboratório</h1>
<p>Acesse seus experimentos, políticas e resultados.</p>
${error ? '<div class="error" role="alert">' + escape(error) + '</div>' : ""}
<form action="/auth/login" method="post">
<input type="hidden" name="returnTo" value="${escape(returnTo)}">
<label for="username">Usuário</label>
<input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="200">
<label for="password">Senha</label>
<input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1000">
<button type="submit">Entrar</button>
</form>
</section>
<a class="public" href="/evidencias/">Ver evidências públicas</a>
</main>
<footer>Avila Ops Labs</footer>
</body>
</html>`;
}
