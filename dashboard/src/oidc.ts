import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export interface OidcOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionTtlMs?: number;
}

interface Pending { state: string; verifier: string; createdAt: number; returnTo: string; }
interface Session { id: string; accessToken: string; idToken?: string; user?: Record<string, unknown>; expiresAt: number; }

const b64url = (value: Buffer) => value.toString("base64url");
const random = () => b64url(randomBytes(32));
const form = (values: Record<string, string>) => new URLSearchParams(values).toString();

export class OidcSessionStore {
  readonly pending = new Map<string, Pending>();
  readonly sessions = new Map<string, Session>();
  constructor(private readonly options: OidcOptions) {}
  private clean() {
    const now = Date.now();
    for (const [key, value] of this.pending) if (now - value.createdAt > 10 * 60_000) this.pending.delete(key);
    for (const [key, value] of this.sessions) if (value.expiresAt <= now) this.sessions.delete(key);
  }
  login(returnTo: string) {
    this.clean();
    const state = random();
    const verifier = random();
    this.pending.set(state, { state, verifier, createdAt: Date.now(), returnTo: returnTo.startsWith("/") ? returnTo : "/experiments/" });
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const url = new URL(this.options.issuer + "/oauth/authorize");
    url.search = form({ client_id: this.options.clientId, redirect_uri: this.options.redirectUri, response_type: "code", scope: "openid profile email", state, code_challenge: challenge, code_challenge_method: "S256" });
    return url;
  }
  async callback(code: string, state: string) {
    this.clean();
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || !code) throw new Error("OIDC state inválido ou expirado.");
    const basic = Buffer.from(`${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`).toString("base64");
    const tokenResponse = await fetch(this.options.issuer + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: "Basic " + basic }, body: form({ grant_type: "authorization_code", code, redirect_uri: this.options.redirectUri, code_verifier: pending.verifier }), redirect: "error" });
    if (!tokenResponse.ok) throw new Error("OIDC token exchange failed");
    const token = await tokenResponse.json() as { access_token?: string; id_token?: string; expires_in?: number };
    if (!token.access_token) throw new Error("OIDC token ausente");
    const id = randomUUID();
    const session: Session = { id, accessToken: token.access_token, idToken: token.id_token, expiresAt: Date.now() + Math.min(Math.max((token.expires_in ?? 3600) * 1000, 60_000), this.options.sessionTtlMs ?? 8 * 3600_000) };
    try {
      const userResponse = await fetch(this.options.issuer + "/oauth/userinfo", { headers: { Authorization: "Bearer " + token.access_token }, redirect: "error" });
      if (userResponse.ok) session.user = await userResponse.json() as Record<string, unknown>;
    } catch { /* identity details are optional; authorization still follows the authenticated session */ }
    this.sessions.set(id, session);
    return { session, returnTo: pending.returnTo };
  }
  get(id: string | undefined) { this.clean(); return id ? this.sessions.get(id) : undefined; }
  delete(id: string | undefined) { if (id) this.sessions.delete(id); }
}

export const cookieValue = (header: string | undefined, name: string) => header?.split(";").map(value => value.trim()).find(value => value.startsWith(name + "="))?.slice(name.length + 1);
export const safeEqual = (left: string, right: string) => { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };
