import { fileURLToPath } from "node:url";
import { createDashboard } from "./server.js";
const publicOrigin = process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3301";
const productionOrigin = publicOrigin === "https://ml.avilaops.com";
const oidcRequested = productionOrigin || ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI"]
  .some(name => process.env[name] !== undefined);
if (oidcRequested && (!process.env.OIDC_CLIENT_ID?.trim() || !process.env.OIDC_CLIENT_SECRET?.trim())) {
  throw new Error("Configure OIDC_CLIENT_ID and OIDC_CLIENT_SECRET for the Ávila OAuth dashboard");
}
const server = createDashboard({
  apiUrl: process.env.LAB_API_URL ?? "http://127.0.0.1:3300",
  apiToken: process.env.LAB_API_TOKEN ?? "",
  username: process.env.DASHBOARD_USER,
  password: process.env.DASHBOARD_PASSWORD,
  origin: publicOrigin,
  oidc: oidcRequested ? {
    issuer: process.env.OIDC_ISSUER ?? "https://auth.avilaops.com",
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET!,
    redirectUri: process.env.OIDC_REDIRECT_URI ?? `${publicOrigin}/auth/callback`,
  } : undefined,
  assetDirectory: fileURLToPath(new URL("./", import.meta.url)),
});
server.listen(Number(process.env.DASHBOARD_PORT ?? 3301), process.env.DASHBOARD_HOST ?? "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close());
