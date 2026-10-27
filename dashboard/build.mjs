import { build } from "esbuild";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { evaluate } from "@mdx-js/mdx";
import * as jsx from "react/jsx-runtime";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publishPublicExport } from "./public-export.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
await mkdir(root + "dist", { recursive: true });
await build({ entryPoints: [root + "src/client.tsx"], outfile: root + "dist/client.js", bundle: true, minify: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, platform: "browser", target: "es2022" });
for (const file of ["server", "serve"]) await build({ entryPoints: [root + "src/" + file + (file === "server" ? ".tsx" : ".ts")], outfile: root + "dist/" + file + ".mjs", bundle: true, packages: "external", platform: "node", format: "esm", jsx: "automatic" });
await copyFile(root + "src/style.css", root + "dist/style.css");
const allowlist = JSON.parse(await readFile(root + "evidence.allowlist.json", "utf8"));
await publishPublicExport(root, allowlist, async output => {
  await mkdir(path.join(output, "data"), { recursive: true });
  const artifacts = [];
  for (const file of allowlist) {
    if (!/^[a-z-]+\.json$/.test(file)) throw new Error("Invalid allowlist entry");
    const bytes = await readFile(root + "evidence/" + file);
    const value = JSON.parse(bytes);
    artifacts.push({ file, value, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    await copyFile(root + "evidence/" + file, path.join(output, "data", file));
  }
  const get = file => { const item = artifacts.find(item => item.file === file); if (!item) throw new Error("Missing selected artifact: " + file); return item.value; };
  const numeric = get("numeric-candidate.json");
  const baseline = get("numeric-baseline.json");
  const trace = get("path-policy.json");
  const classification = get("classification.json");
  const colors = { passed: "Aprovados", failed: "Reprovados", inconclusive: "Inconclusivos", error: "Erros" };
  function bars(report) {
    return h("div", { className: "bars" }, ...Object.entries(colors).map(([key, label]) => {
      const count = report.cases.filter(item => item.verdict === key).length;
      return h("div", { className: "bar", key }, h("span", null, label), h("div", { className: "bar-track" }, h("div", { className: "bar-fill " + key, style: { width: (count / report.cases.length * 100) + "%" } })), h("strong", null, count + "/" + report.cases.length));
    }));
  }
  function Evidence() {
    const tolerance = numeric.evaluators.find(item => item.id === "numeric-tolerance").parameters.absoluteTolerance;
    const references = new Map(get("numeric-dataset.json").cases.map(item => [item.id, item.expected]));
    const ratios = numeric.cases.map(item => typeof item.output === "number" && typeof references.get(item.caseId) === "number" && tolerance > 0 ? Math.abs(item.output - references.get(item.caseId)) / tolerance : null).filter(item => item !== null);
    const bins = [ratios.filter(x => x === 0).length, ratios.filter(x => x > 0 && x <= .01).length, ratios.filter(x => x > .01 && x <= 1).length, ratios.filter(x => x > 1).length];
    const cells = new Map();
    const dataset = get("classification-dataset.json");
    for (const result of classification.cases) { const expected = dataset.cases.find(item => item.id === result.caseId)?.expected; const key = expected + "/" + result.output; cells.set(key, (cells.get(key) ?? 0) + 1); }
    return h("div", null,
      h("div", { className: "metrics" }, ...[["Cálculo: base", baseline.summary.passed + "/" + baseline.summary.total], ["Cálculo: candidata", numeric.summary.passed + "/" + numeric.summary.total], ["Caminho: execuções", trace.cases.length]].map(([label, value]) => h("div", { key: label }, h("span", null, label), h("strong", null, value)))),
      h("h2", null, "Precisão matemática"), h("p", null, "Erro absoluto / tolerância absoluta; denominador: " + ratios.length + " resultados elegíveis."),
      h("div", { className: "bars" }, ...bins.map((count, index) => h("div", { className: "bar", key: index }, h("span", null, ["Exato", "Até 1% do limite", "1% a 100%", "Acima do limite"][index]), h("div", { className: "bar-track" }, h("div", { className: "bar-fill", style: { width: (count / Math.max(1, ratios.length) * 100) + "%" } })), h("strong", null, count)))),
      h("h2", null, "Classificação de documentos"), h("p", null, "Completude documental sintética. Linhas: referência. Colunas: saída. Denominador: " + classification.cases.length + " execuções."),
      h("table", null, h("thead", null, h("tr", null, h("th", null, "Referência / saída"), h("th", null, "complete"), h("th", null, "incomplete"))), h("tbody", null, ...["complete", "incomplete"].map(label => h("tr", { key: label }, h("th", null, label), ...["complete", "incomplete"].map(output => h("td", { key: output, className: label === output ? "passed" : "failed" }, cells.get(label + "/" + output) ?? 0)))))),
      h("h2", null, "Política de caminho"), bars(trace),
      ...trace.cases.map(item => h("details", { key: item.caseId }, h("summary", null, item.caseId, h("span", { className: "badge " + item.verdict }, colors[item.verdict] ?? item.verdict)), h("p", null, ...item.evaluations.map(evaluation => h("span", { key: evaluation.evaluatorId }, evaluation.evaluatorId + ": " + evaluation.reason + ". "))), h("div", { className: "trace" }, ...(item.output?.trace?.steps ?? []).map((step, index) => h("span", { className: "node " + (step.status === "failed" ? "failed" : ""), key: index }, step.node + " · " + step.status))))),
      h("h2", null, "Linhagem"), ...[baseline, numeric, trace, classification].map(report => h("div", { key: report.runId, className: "evidence-chart" }, h("strong", null, report.experiment.id + " / " + report.variant.version), h("p", { className: "hash" }, "Run: " + report.runId + " | " + report.completedAt + " | split " + report.dataset.split + " | " + report.dataset.caseCount + " casos | " + report.repetitions + " repetições"), h("p", { className: "hash" }, "Dataset SHA-256: " + report.dataset.hash), bars(report)))
    );
  }
  function Downloads() {
    return h("section", null, h("h2", null, "Dados selecionados para reprodução"), ...artifacts.map(item => h("div", { key: item.file }, h("a", { href: "data/" + item.file }, item.file), h("p", { className: "hash" }, item.size + " bytes | SHA-256 " + item.sha256))));
  }
  const { default: Narrative } = await evaluate(await readFile(root + "content/evidence.mdx", "utf8"), { ...jsx });
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ávila Experiments | Evidências públicas</title><link rel="stylesheet" href="style.css"></head><body>' + renderToStaticMarkup(h("div", null, h("header", null, h("a", { className: "brand", href: "./" }, "Ávila", h("span", null, "Experiments")), h("nav", null, h("a", { href: "https://github.com/avilaops/experiments" }, "Código e documentação"), h("a", { href: "/experiments/" }, "Acessar laboratório")), h("span", { className: "private" }, "Evidências públicas")), h("main", { className: "public-main" }, h("article", null, h(Narrative, { components: { Evidence, Downloads } }))), h("footer", { className: "public-main", style: { margin: "auto" } }, "Snapshots sintéticos selecionados. Sem execução pública."))) + "</body></html>";
  await writeFile(path.join(output, "index.html"), html);
  await copyFile(root + "src/style.css", path.join(output, "style.css"));
  await writeFile(path.join(output, "manifest.json"), JSON.stringify({ schemaVersion: "1", coreVersion: "0.3.0", artifacts: artifacts.map(({ value, ...item }) => item) }, null, 2) + "\n");
});
