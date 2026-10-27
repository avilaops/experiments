// Local preview only. Uses a dedicated directory and test credentials, never production secrets.
import { fileURLToPath } from "node:url";
import { createApiServer } from "../dist/lab/server.js";
import { createDashboard } from "../dashboard/dist/server.mjs";

const api = await createApiServer({
  dataDirectory: fileURLToPath(new URL("../var/policies-preview-v1/", import.meta.url)),
  token: "local-policy-preview-token",
});
const dashboard = createDashboard({
  apiUrl: "http://127.0.0.1:3310", apiToken: "local-policy-preview-token",
  username: "laboratorio", password: "local-policy-preview-2026",
  origin: "http://127.0.0.1:3311", assetDirectory: fileURLToPath(new URL("../dashboard/dist/", import.meta.url)),
});
await new Promise((resolve, reject) => { api.once("error", reject); api.listen(3310, "127.0.0.1", resolve); });
await new Promise((resolve, reject) => { dashboard.once("error", reject); dashboard.listen(3311, "127.0.0.1", resolve); });
console.log("Local policy preview: http://127.0.0.1:3311/experiments/policies");
console.log("Local test login: laboratorio / local-policy-preview-2026");
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { dashboard.close(); api.close(); });
