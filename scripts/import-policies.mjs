import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parsePolicy } from "../dist/lab/policies.js";

export async function importPolicies({ baseUrl, token, policies, fetcher = fetch }) {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) {
    throw new Error("Use HTTPS ou HTTP no loopback, sem credenciais ou parâmetros na URL.");
  }
  if (typeof token !== "string" || !token.trim()) throw new Error("Informe LAB_API_TOKEN no ambiente privado.");
  if (!Array.isArray(policies) || policies.length > 500) throw new Error("Informe uma lista de até 500 fichas.");
  const drafts = policies.map(parsePolicy);
  if (new Set(drafts.map(policy => policy.id)).size !== drafts.length) throw new Error("Identificadores duplicados na importação.");
  const endpoint = base.href.replace(/\/$/, "") + "/api/v1/policies";
  const headers = { Authorization: `Bearer ${token}` };
  async function catalog(response) {
    if (!response.ok) throw new Error(`Importação interrompida: HTTP ${response.status}. Registros já existentes não foram sobrescritos; confira o histórico antes de repetir.`);
    const etag = response.headers.get("etag");
    if (!etag) throw new Error("API sem ETag; importação interrompida.");
    return { value: await response.json(), etag };
  }
  let current = await catalog(await fetcher(endpoint, { headers, redirect: "error" }));
  const results = [];
  for (const policy of drafts) {
    if (current.value.policies.some(item => item.id === policy.id)) {
      results.push({ id: policy.id, action: "preserved" });
      continue;
    }
    current = await catalog(await fetcher(endpoint, { method: "PUT", redirect: "error", headers: { ...headers, "Content-Type": "application/json", "If-Match": current.etag },
      body: JSON.stringify({ policy, changeNote: "Importação de ficha revisada com fontes e limites explícitos. Registros existentes preservados." }) }));
    results.push({ id: policy.id, action: "created" });
  }
  return { revision: current.value.revision, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [file, flag, ...extra] = process.argv.slice(2);
    if (!file || (flag !== undefined && flag !== "--preview") || extra.length) throw new Error("Uso: node scripts/import-policies.mjs arquivo.json [--preview]");
    const preview = flag === "--preview";
    const baseUrl = preview ? "http://127.0.0.1:3310" : process.env.LAB_API_URL;
    const token = preview ? "local-policy-preview-token" : process.env.LAB_API_TOKEN;
    if (!baseUrl) throw new Error("Informe LAB_API_URL ou use --preview para a prévia local.");
    const policies = JSON.parse(await readFile(file, "utf8"));
    console.log(JSON.stringify(await importPolicies({ baseUrl, token, policies }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
