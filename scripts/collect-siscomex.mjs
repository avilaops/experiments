import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORIGIN = "https://docs.portalunico.siscomex.gov.br";
const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const hash = value => createHash("sha256").update(value).digest("hex");

export function normalizeLink(value, base) {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"), base);
    if (url.origin !== ORIGIN || url.username || url.password || url.search) return null;
    url.hash = "";
    const extension = path.posix.extname(url.pathname).toLowerCase();
    if (extension && ![".html", ".json", ".yaml", ".yml", ".xml", ".pdf", ".txt"].includes(extension)) return null;
    return url.href;
  } catch { return null; }
}

export function discoverLinks(html, base) {
  const values = [...html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  // Swagger wrappers declare the specification in an inline JavaScript variable.
  for (const match of html.matchAll(/\burl\s*[:=]\s*["']([^"']+)["']/gi)) values.push(match[1]);
  return [...new Set(values.map(value => normalizeLink(value, base)).filter(Boolean))];
}

export function inventoryContract(spec, source, sha256) {
  if (!(spec.swagger === "2.0" || typeof spec.openapi === "string") || !spec.paths) return null;
  const operations = [];
  for (const [route, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!METHODS.has(method)) continue;
      const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])];
      operations.push({ method: method.toUpperCase(), path: route, operationId: operation.operationId ?? null,
        summary: operation.summary ?? null, deprecated: operation.deprecated === true,
        parameters, requestBody: operation.requestBody ?? null,
        security: operation.security ?? spec.security ?? null,
        responses: Object.keys(operation.responses ?? {}),
      });
    }
  }
  return { source, sha256, format: spec.swagger ?? spec.openapi, title: spec.info?.title ?? null,
    version: spec.info?.version ?? null, basePath: spec.basePath ?? null, servers: spec.servers ?? [], operations };
}

async function download(url, fetcher, maxBytes) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(30_000),
        headers: { "User-Agent": "AvilaExperiments-DocumentationCollector/0.1" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location") ?? "";
        const redirected = new URL(location, url);
        // This documentation site emits HTTP locations for some slash redirects.
        // Upgrade locally; never send a request over HTTP or to a different host.
        if (redirected.protocol === "http:" && redirected.host === new URL(ORIGIN).host) redirected.protocol = "https:";
        const target = location ? normalizeLink(redirected.href, url) : null;
        if (!target || target === url) throw new Error(`Redirecionamento recusado: ${response.status}`);
        await response.body?.cancel();
        // Keep redirects visible in the manifest; discover the same-origin target separately.
        return { redirect: target, status: response.status };
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error(`Documento excede ${maxBytes} bytes`);
        chunks.push(chunk);
      }
      return { bytes: Buffer.concat(chunks), contentType: response.headers.get("content-type") ?? "", status: response.status };
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

export async function collect({ output, maxPages = 1200, fetcher = fetch, seeds = [ORIGIN + "/",
  ORIGIN + "/api/dimp/sefaz/", ORIGIN + "/api/dimp/sefaz-estaleiro.json"], maxBytes = 12 * 1024 * 1024 } = {}) {
  if (!output || !Number.isInteger(maxPages) || maxPages < 1) throw new Error("Destino e limite positivo obrigatórios.");
  const runId = new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID();
  const directory = path.resolve(output, runId);
  await mkdir(path.join(directory, "objects"), { recursive: true });
  const queue = [...new Set(seeds.map(url => normalizeLink(url, ORIGIN)).filter(Boolean))];
  const seen = new Set(queue);
  const records = [];
  const contracts = [];
  let cursor = 0;
  while (cursor < queue.length && records.length < maxPages) {
    const batch = queue.slice(cursor, cursor + Math.min(4, maxPages - records.length));
    cursor += batch.length;
    const results = await Promise.all(batch.map(async url => {
      try { return { url, result: await download(url, fetcher, maxBytes) }; }
      catch (error) { return { url, error: error.message }; }
    }));
    for (const { url, result, error } of results) {
      if (error) { records.push({ url, error }); continue; }
      if (result.redirect) {
        records.push({ url, status: result.status, redirect: result.redirect });
        if (!seen.has(result.redirect)) { seen.add(result.redirect); queue.push(result.redirect); }
        continue;
      }
      const sha256 = hash(result.bytes);
      const extension = result.contentType.includes("html") ? ".html" : result.contentType.includes("json") ? ".json" :
        [".pdf", ".xml", ".yaml", ".yml"].includes(path.posix.extname(new URL(url).pathname)) ? path.posix.extname(new URL(url).pathname) : ".txt";
      const file = `objects/${sha256}${extension}`;
      await writeFile(path.join(directory, file), result.bytes);
      records.push({ url, status: result.status, contentType: result.contentType, bytes: result.bytes.length, sha256, file });
      const text = result.bytes.toString("utf8");
      if (result.contentType.includes("html") || /\.html$/.test(url)) {
        for (const link of discoverLinks(text, url)) if (!seen.has(link)) { seen.add(link); queue.push(link); }
      }
      if (result.contentType.includes("json") || url.endsWith(".json")) {
        try { const contract = inventoryContract(JSON.parse(text), url, sha256); if (contract) contracts.push(contract); }
        catch (error) { records.at(-1).parseError = error.message; }
      }
    }
  }
  const failures = records.filter(record => record.error || record.parseError);
  const manifest = { runId, collectedAt: new Date().toISOString(), origin: ORIGIN,
    scope: "Documentação pública e anexos descobertos; sem chamadas às APIs operacionais ou execução de JavaScript.",
    complete: failures.length === 0 && cursor === queue.length,
    discovered: queue.length, processed: records.length, pending: queue.slice(cursor), failures: failures.length, records };
  let previous = [];
  try { const latest = JSON.parse(await readFile(path.join(output, "latest.json"), "utf8"));
    previous = JSON.parse(await readFile(path.join(output, latest.runId, "contracts.json"), "utf8"));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const changes = contracts.map(contract => {
    const before = previous.find(item => item.source === contract.source);
    return { source: contract.source, before: before?.sha256 ?? null, after: contract.sha256,
      changed: before ? before.sha256 !== contract.sha256 : null };
  });
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(directory, "contracts.json"), JSON.stringify(contracts, null, 2));
  const policies = contracts.map(contract => ({
    id: `ERP-SISCOMEX-${hash(contract.source).slice(0, 12).toUpperCase()}`, product: "erp",
    title: `Avaliar integração: ${contract.title ?? contract.source}`.slice(0, 180),
    category: "integration", state: "proposed", owner: "A definir", verificationDate: "",
    rule: `Contrato público ${contract.format}, versão declarada ${contract.version ?? "não informada"}, com ${contract.operations.length} operações. ` +
      "Revisar perfil de acesso, autenticação, campos obrigatórios, respostas e adequação ao produto antes de implementar. " +
      "A coleta não comprova acesso operacional, conformidade tributária ou aplicação desta proposta no ERP.",
    enforcement: "Inventário automático da documentação; integração ainda não implementada por este coletor.",
    sources: [{ kind: "document", location: contract.source, note: `SHA-256 ${contract.sha256}; coleta ${runId}. Parâmetros e referências preservados em contracts.json e no contrato original.` }],
  }));
  await writeFile(path.join(directory, "policies.proposed.json"), JSON.stringify(policies, null, 2));
  await writeFile(path.join(directory, "changes.json"), JSON.stringify({ comparedBy: "SHA-256 dos bytes; não é análise de breaking changes", changes,
    missingPreviouslySeen: previous.filter(item => !contracts.some(current => current.source === item.source)).map(item => item.source) }, null, 2));
  // A partial collection never replaces the last complete checkpoint.
  const lines = ["# Coleta pública do Siscomex", "", `Execução: ${runId}`, "",
    `Processados: ${records.length}. Falhas: ${failures.length}. Pendentes: ${manifest.pending.length}. Contratos: ${contracts.length}.`, "",
    "Cobertura: links HTML e URLs de especificação descobertos no mesmo domínio HTTPS. Não inclui recursos carregados somente por JavaScript, ativos visuais ou áreas autenticadas. Complete significa fila descoberta esgotada sem falhas, não cobertura integral garantida do portal.", "",
    "Os HTMLs são cópias de origem para consulta, sem garantia de navegação offline. Não executar scripts incorporados de fontes coletadas no painel.", "",
    "| Contrato | Versão | Operações | Cópia local |", "| --- | --- | ---: | --- |",
    ...contracts.map(contract => `| [${String(contract.title).replaceAll("|", " ")}](${contract.source}) | ${contract.version} | ${contract.operations.length} | [JSON](${records.find(record => record.url === contract.source).file}) |`),
    "", "## Falhas", "", ...failures.map(record => `- ${record.url}: ${record.error ?? record.parseError}`),
    "", "Manifesto: manifest.json. Inventário: contracts.json. Comparação por bytes: changes.json. Fichas para revisão: policies.proposed.json.", ""];
  await writeFile(path.join(directory, "README.md"), lines.join("\n"));
  if (manifest.complete) {
    const temporary = path.join(output, `latest-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ runId }, null, 2));
    await rename(temporary, path.join(output, "latest.json"));
  }
  return { directory, complete: manifest.complete, processed: records.length, failures: failures.length,
    pending: manifest.pending.length, contracts: contracts.length, operations: contracts.reduce((sum, item) => sum + item.operations.length, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await collect({ output: process.argv[2] ?? "var/siscomex" });
    console.log(JSON.stringify(result, null, 2));
    if (!result.complete) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
