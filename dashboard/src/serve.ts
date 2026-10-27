import { fileURLToPath } from "node:url";
import { createDashboard } from "./server.js";
const server = createDashboard({
  apiUrl: process.env.LAB_API_URL ?? "http://127.0.0.1:3300",
  apiToken: process.env.LAB_API_TOKEN ?? "",
  username: process.env.DASHBOARD_USER ?? "laboratorio",
  password: process.env.DASHBOARD_PASSWORD ?? "",
  origin: process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3301",
  assetDirectory: fileURLToPath(new URL("./", import.meta.url)),
});
server.listen(Number(process.env.DASHBOARD_PORT ?? 3301), process.env.DASHBOARD_HOST ?? "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close());
