import { fileURLToPath } from "node:url";
import { createDashboard } from "./server.js";
const server = createDashboard({
  apiUrl: process.env.LAB_API_URL ?? "http://127.0.0.1:3300",
  apiToken: process.env.LAB_API_TOKEN ?? "",
  username: process.env.DASHBOARD_USER,
  password: process.env.DASHBOARD_PASSWORD,
  origin: process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3301",
  oidc: process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET ? {
    issuer: process.env.OIDC_ISSUER ?? "https://auth.avilaops.com",
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    redirectUri: process.env.OIDC_REDIRECT_URI ?? "http://127.0.0.1:3301/auth/callback",
  } : undefined,
  assetDirectory: fileURLToPath(new URL("./", import.meta.url)),
});
server.listen(Number(process.env.DASHBOARD_PORT ?? 3301), process.env.DASHBOARD_HOST ?? "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close());
