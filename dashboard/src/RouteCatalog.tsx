import { useEffect, useState } from "react";
import type { ProductInventory, RouteEntry } from "../../src/lab/route-inventories.js";
import { ROUTE_PRODUCTS } from "../../src/lab/policy-contracts.js";

const layers = { page: "Página", bff: "BFF", api: "API" };
const endpoint = "/experiments/api/v1/route-inventories/";
export function RouteCatalog() {
  const [product, setProduct] = useState("erp");
  const [catalog, setCatalog] = useState<{ product: string; revision: number; inventory: ProductInventory | null }>();
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState("");
  const [verb, setVerb] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(undefined); setMessage(""); setLoading(true);
    void fetch(endpoint + product, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? "Não foi possível carregar o inventário.");
      if (!controller.signal.aborted) setCatalog(value);
    }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [product, reload]);
  const inventory = catalog?.inventory;
  const entries = inventory?.entries ?? [];
  const visible = entries.filter(row => (!layer || row.layer === layer) && (!verb || row.method === verb)
    && [row.path, row.operationId ?? "", row.source ?? ""].join(" ").toLowerCase().includes(query.toLowerCase()));
  async function importReport(file: File) {
    if (!catalog || busy) return;
    setBusy(true); setMessage("");
    try {
      if (file.size > 1024 * 1024) throw new Error("O arquivo excede 1 MiB.");
      const input = JSON.parse(await file.text());
      const response = await fetch(endpoint + product, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": `"${catalog.revision}"` }, body: JSON.stringify(input) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? "Não foi possível importar o inventário.");
      setCatalog(value); setMessage("Inventário importado para o produto selecionado.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  const count = (value: RouteEntry["layer"]) => entries.filter(row => row.layer === value).length;
  return <div className="shell">
    <header><a className="brand" href="/experiments/">Ávila<span>Experiments</span></a><nav><a href="/experiments/">Laboratório</a><a href="/experiments/contracts">Contratos com clientes</a><a href="/experiments/routes" aria-current="page">Rotas por produto</a><a href="/experiments/policies">Caderno de políticas</a></nav><span className="private">Inventário privado</span></header>
    <main><div className="intro"><div><h1>Rotas por produto.</h1><p>Consulte páginas, handlers BFF e operações de API do inventário importado.</p></div></div>
      {message && <p role="status" className="notice">{message}</p>}
      <section aria-label="Consultar rotas"><div className="fields">
        <label>Produto<select aria-label="Produto" disabled={busy} value={product} onChange={event => { setCatalog(undefined); setProduct(event.target.value); setQuery(""); setLayer(""); setVerb(""); }}>{ROUTE_PRODUCTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Camada<select aria-label="Camada" value={layer} onChange={event => setLayer(event.target.value)}><option value="">Todas</option>{Object.entries(layers).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Método<select aria-label="Método" value={verb} onChange={event => setVerb(event.target.value)}><option value="">Todos</option>{[...new Set(entries.flatMap(row => row.method ? [row.method] : []))].sort().map(method => <option key={method}>{method}</option>)}</select></label>
        <label>Buscar rota<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Caminho, operação ou arquivo"/></label>
      </div><button disabled={busy} onClick={() => setReload(value => value + 1)}>Recarregar inventário</button>
      <label>Importar inventário JSON para este produto<input type="file" accept="application/json,.json" disabled={!catalog || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void importReport(file); event.target.value = ""; }}/></label>
      <p className="muted">A importação substitui o inventário atual do produto. Gere o arquivo com o coletor e confira o produto antes de importar.</p></section>
      {!catalog ? <p role="status">{loading ? "Carregando inventário…" : "Inventário indisponível. Tente recarregar."}</p> : !inventory ? <section><h2>Inventário pendente</h2><p>Nenhum inventário importado para este produto. A quantidade de endpoints ainda é desconhecida.</p></section> : <>
        <section aria-label="Origem do inventário"><h2>Captura importada</h2><p>{count("page")} páginas · {count("bff")} registros BFF · {inventory.apiCaptured ? `${count("api")} operações API` : "API não capturada"} · {inventory.reviewItems} itens de revisão</p>
          <p>Captura: {new Date(inventory.recordedAt).toLocaleString("pt-BR")} · revisão {catalog.revision} · checkout {inventory.sourceDirty ? "com alterações" : "limpo"}</p>
          <p className="hash">Commit: {inventory.sourceHead}<br/>Fingerprint: {inventory.sourceFingerprint}<br/>Execução: {inventory.runId}</p>
          <p className="notice">Inventário de fontes importado. As operações listadas estão sem teste funcional; a captura não comprova funcionamento em produção.</p></section>
        <section aria-label="Endpoints do produto"><h2>{visible.length} registros encontrados de {entries.length}</h2><div className="table-scroll"><table><thead><tr><th>Camada</th><th>Método</th><th>Caminho</th><th>Operação / fonte</th><th>Situação</th></tr></thead><tbody>{visible.map((row, index) => <tr key={`${row.layer}:${row.method}:${row.path}:${index}`}><td>{layers[row.layer]}</td><td>{row.method ?? "—"}</td><td className="route-path">{row.path}</td><td className="hash">{row.operationId ?? row.source ?? "—"}</td><td>Não testado{row.handlerStatus && row.handlerStatus !== "callable" ? " · revisar handler" : ""}</td></tr>)}</tbody></table></div>{!visible.length && <p>Nenhum registro corresponde aos filtros.</p>}</section>
      </>}
    </main></div>;
}
