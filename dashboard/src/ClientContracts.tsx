import { useEffect, useState } from "react";
import { CONTRACT_CYCLES, CONTRACT_PRODUCTS, CONTRACT_STATUSES } from "../../src/lab/client-contract-types.js";
import type { ClientContract, ClientContractCatalog, ClientContractDraft, ClientContractHistory } from "../../src/lab/client-contract-types.js";

const endpoint = "/experiments/api/v1/client-contracts";
const productName = (id: string) => CONTRACT_PRODUCTS.find(product => product.id === id)?.name ?? id;
const money = (amount: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(amount));
const calendar = (date: string) => date ? date.split("-").reverse().join("/") : "Sem término definido";
const blank = (): ClientContractDraft => ({ code: "", title: "", clientName: "", clientReference: "", product: "erp", status: "draft", startDate: "", endDate: "", amount: "", billingCycle: "monthly", notes: "" });
function decimal(input: string): string {
  const value = input.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) throw new Error("Informe o valor em reais, como 1500,00, sem separador de milhar.");
  const [whole, fraction = ""] = value.split(".");
  return whole + "." + fraction.padEnd(2, "0");
}
function ContractDetails({ contract }: { contract: ClientContract }) {
  return <dl className="contract-details">
    <dt>Cliente</dt><dd>{contract.clientName}{contract.clientReference && " · " + contract.clientReference}</dd>
    <dt>Produto</dt><dd>{productName(contract.product)}</dd>
    <dt>Situação</dt><dd>{CONTRACT_STATUSES[contract.status]}</dd>
    <dt>Vigência</dt><dd>{calendar(contract.startDate)} a {calendar(contract.endDate)}</dd>
    <dt>Valor em reais</dt><dd>{money(contract.amount)} · {CONTRACT_CYCLES[contract.billingCycle]}</dd>
    <dt>Observações</dt><dd className="contract-notes">{contract.notes || "Sem observações"}</dd>
  </dl>;
}

export function ClientContracts() {
  const [catalog, setCatalog] = useState<ClientContractCatalog>();
  const [etag, setEtag] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState<{ id: string | null; draft: ClientContractDraft }>();
  const [changeNote, setChangeNote] = useState("");
  const [query, setQuery] = useState(""), [status, setStatus] = useState(""), [product, setProduct] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [reload, setReload] = useState(0);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [conflict, setConflict] = useState(false);
  const [history, setHistory] = useState<ClientContractHistory>(), [historyOffset, setHistoryOffset] = useState(0), [historyError, setHistoryError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch(endpoint, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? "Não foi possível carregar os contratos.");
      if (!controller.signal.aborted) { setCatalog(value); setEtag(response.headers.get("etag") ?? `"${value.revision}"`); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const controller = new AbortController();
    setHistory(undefined); setHistoryError("");
    if (selectedId) void fetch(`${endpoint}/${selectedId}/history?limit=20&offset=${historyOffset}`, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? "Não foi possível carregar o histórico.");
      if (!controller.signal.aborted) setHistory(value);
    }).catch(reason => { if (!controller.signal.aborted) setHistoryError(reason.message); });
    return () => controller.abort();
  }, [selectedId, catalog?.revision, historyOffset]);

  useEffect(() => {
    if (!editor) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [Boolean(editor)]);

  const selected = catalog?.contracts.find(contract => contract.id === selectedId);
  const duplicate = Boolean(editor && catalog?.contracts.some(contract => contract.id !== editor.id && contract.code === editor.draft.code.trim().toUpperCase()));
  const visible = (catalog?.contracts ?? []).filter(contract => (!status || contract.status === status) && (!product || contract.product === product)
    && [contract.code, contract.title, contract.clientName, contract.clientReference].join(" ").toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  function edit(contract?: ClientContract) {
    if (busy || loading || editor || !catalog) return;
    const draft = contract ? { code: contract.code, title: contract.title, clientName: contract.clientName, clientReference: contract.clientReference,
      product: contract.product, status: contract.status, startDate: contract.startDate, endDate: contract.endDate, amount: contract.amount.replace(".", ","), billingCycle: contract.billingCycle, notes: contract.notes } : blank();
    setEditor({ id: contract?.id ?? null, draft }); setChangeNote(""); setError(""); setMessage(""); setConflict(false);
  }
  function field<K extends keyof ClientContractDraft>(key: K, value: ClientContractDraft[K]) {
    if (editor && !busy) setEditor({ ...editor, draft: { ...editor.draft, [key]: value } });
  }
  async function save() {
    if (!editor || busy || loading || conflict || duplicate || !changeNote.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag },
        body: JSON.stringify({ id: editor.id, contract: { ...editor.draft, amount: decimal(editor.draft.amount) }, changeNote }) });
      const value = await response.json();
      if (!response.ok) { if (response.status === 412) setConflict(true); throw new Error(value.error?.message ?? "Não foi possível salvar o contrato."); }
      setCatalog(value.catalog); setEtag(response.headers.get("etag") ?? `"${value.catalog.revision}"`); setSelectedId(value.contract.id);
      setHistoryOffset(0); setEditor(undefined); setChangeNote(""); setMessage(`Contrato salvo. Versão ${value.contract.version}.`);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="shell contract-page">
    <header><a className="brand" href="/experiments/">Ávila<span>Experiments</span></a><nav><a href="/experiments/flows">Fluxos do ERP</a><a href="/experiments/">Laboratório</a><a href="/experiments/contracts" aria-current="page">Contratos com clientes</a><a href="/experiments/routes">Rotas por produto</a><a href="/experiments/policies">Caderno de políticas</a><a href="/experiments/openapi.json">Contrato API</a></nav><span className="private">Cadastro privado</span></header>
    <main><div className="intro"><div><h1>Contratos com clientes</h1><p>Cadastre o vínculo comercial, acompanhe a vigência e consulte as versões de cada contrato.</p></div></div>
      {error && <p role="alert" className="conflict">{error}</p>}
      <div role="status" aria-live="polite" className={message ? "notice" : ""}>{message}</div>
      <section aria-label="Cadastro de contratos"><div className="section-title"><h2>Cadastro</h2><span>{catalog ? `${catalog.contracts.length} contratos · revisão ${catalog.revision}` : "Carregando…"}</span></div>
        <div className="actions"><button className="primary" disabled={loading || busy || Boolean(editor) || !catalog} onClick={() => edit()}>Novo contrato</button><button disabled={loading || busy || Boolean(editor)} onClick={() => { setMessage(""); setReload(reload + 1); }}>Recarregar cadastro</button></div>
        <div className="fields"><label>Buscar contratos<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Código, título ou cliente"/></label>
          <label>Filtrar situação<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todas</option>{Object.entries(CONTRACT_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Filtrar produto<select value={product} onChange={event => setProduct(event.target.value)}><option value="">Todos</option>{CONTRACT_PRODUCTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        {loading ? <p role="status">Carregando contratos…</p> : !catalog ? <p>Cadastro indisponível. Tente recarregar.</p> : !catalog.contracts.length ? <p className="empty">Nenhum contrato cadastrado. Use Novo contrato para iniciar.</p> : <><p>{visible.length} contratos encontrados.</p><div className="table-scroll"><table><thead><tr><th>Código e título</th><th>Cliente</th><th>Situação</th><th>Valor</th><th>Ação</th></tr></thead><tbody>{visible.map(contract => <tr key={contract.id}>
          <td>{contract.code}<br/>{contract.title}</td><td>{contract.clientName}</td><td>{CONTRACT_STATUSES[contract.status]}</td><td>{money(contract.amount)}<br/>{CONTRACT_CYCLES[contract.billingCycle]}</td>
          <td><button disabled={busy || Boolean(editor)} aria-label={`Abrir contrato ${contract.code}`} onClick={() => { setSelectedId(contract.id); setHistoryOffset(0); }}>Abrir</button></td>
        </tr>)}</tbody></table></div>{!visible.length && <p>Nenhum contrato corresponde aos filtros.</p>}</>}
      </section>
      {editor && <section className="contract-editor" aria-label="Editor de contrato"><h2>{editor.id ? "Editar contrato" : "Novo contrato"}</h2>
        {duplicate && <p role="alert" className="conflict">Este código já pertence a outro contrato. Use um código diferente.</p>}
        <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy} className="editor-fields"><div className="fields">
          <label>Código do contrato<input required maxLength={60} value={editor.draft.code} onChange={event => field("code", event.target.value)}/></label>
          <label>Título do contrato<input required maxLength={200} value={editor.draft.title} onChange={event => field("title", event.target.value)}/></label>
          <label>Nome do cliente<input required maxLength={200} value={editor.draft.clientName} onChange={event => field("clientName", event.target.value)}/></label>
          <label>Referência externa do cliente<input maxLength={120} value={editor.draft.clientReference} onChange={event => field("clientReference", event.target.value)}/></label>
          <label>Produto do contrato<select value={editor.draft.product} onChange={event => field("product", event.target.value)}>{CONTRACT_PRODUCTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Situação do contrato<select value={editor.draft.status} onChange={event => field("status", event.target.value as ClientContractDraft["status"])}>{Object.entries(CONTRACT_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Início da vigência<input type="date" required min="0001-01-01" max="9999-12-31" value={editor.draft.startDate} onChange={event => field("startDate", event.target.value)}/></label>
          <label>Término da vigência<input type="date" min={editor.draft.startDate || "0001-01-01"} max="9999-12-31" value={editor.draft.endDate} onChange={event => field("endDate", event.target.value)}/></label>
          <label>Valor em reais<input required inputMode="decimal" maxLength={13} placeholder="1500,00" value={editor.draft.amount} onChange={event => field("amount", event.target.value)}/></label>
          <label>Periodicidade do valor<select value={editor.draft.billingCycle} onChange={event => field("billingCycle", event.target.value as ClientContractDraft["billingCycle"])}>{Object.entries(CONTRACT_CYCLES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div><p className="muted">Informe o valor sem separador de milhar. A referência externa pode vincular o cliente a um cadastro de outro sistema.</p>
          <label>Observações do contrato<textarea rows={4} maxLength={4000} value={editor.draft.notes} onChange={event => field("notes", event.target.value)}/></label>
          <label>Motivo da alteração<input required maxLength={500} value={changeNote} onChange={event => setChangeNote(event.target.value)}/></label>
          <div className="actions"><button className="primary" type="submit" disabled={conflict || duplicate || !changeNote.trim()}>{busy ? "Salvando…" : "Salvar contrato"}</button>
            <button type="button" onClick={() => { setEditor(undefined); setConflict(false); setError(""); setReload(reload + 1); }}>Cancelar edição e recarregar</button></div>
        </fieldset></form>
      </section>}
      {selected && <section aria-label="Detalhes do contrato"><div className="section-title"><h2>{selected.code} · {selected.title}</h2><button disabled={busy || loading || Boolean(editor)} onClick={() => edit(selected)}>Editar contrato</button></div>
        <ContractDetails contract={selected}/><p className="muted">Versão {selected.version} · criado em {new Date(selected.createdAt).toLocaleString("pt-BR")} · atualizado em {new Date(selected.updatedAt).toLocaleString("pt-BR")}</p>
        <h3>Histórico de alterações</h3>{historyError ? <p role="alert">{historyError}</p> : !history ? <p role="status">Carregando histórico…</p> : <>
          <p>{history.total} versões registradas. Acesso compartilhado do laboratório; o histórico não identifica uma pessoa editora.</p>
          {history.items.map(item => <details key={item.revision}><summary>Versão {item.contract.version} · {new Date(item.contract.updatedAt).toLocaleString("pt-BR")}</summary><p>Motivo: {item.changeNote}</p><p>{item.contract.code} · {item.contract.title}</p><ContractDetails contract={item.contract}/></details>)}
          <div className="actions"><button disabled={historyOffset === 0} onClick={() => setHistoryOffset(Math.max(0, historyOffset - 20))}>Versões mais recentes</button><span>{historyOffset + 1}–{Math.min(historyOffset + history.items.length, history.total)} de {history.total}</span><button disabled={historyOffset + history.items.length >= history.total} onClick={() => setHistoryOffset(historyOffset + 20)}>Versões anteriores</button></div>
        </>}
      </section>}
    </main></div>;
}
