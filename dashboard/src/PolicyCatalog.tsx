import { useEffect, useState } from "react";
import { PRODUCTS, POLICY_CATEGORIES, POLICY_STATES, SOURCE_KINDS, type Policy, type PolicyCatalog as Catalog, type PolicyDraft } from "../../src/lab/policy-contracts.js";
import { mergePolicyDraft, POLICY_FIELD_LABELS, type PolicyField } from "./policy-merge.js";
import { PolicyImport } from "./PolicyImport.js";

const endpoint = "/experiments/api/v1/policies";
const emptyPolicy = (): PolicyDraft => ({ id: "", product: "erp", title: "", category: "access", state: "proposed", rule: "", owner: "A definir", enforcement: "", verificationDate: "", sources: [] });
const productName = (id: string) => PRODUCTS.find(product => product.id === id)?.name ?? id;
const date = (value: string) => new Date(value).toLocaleString("pt-BR");
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const toDraft = ({ version: _version, updatedAt: _updatedAt, ...policy }: Policy): PolicyDraft => policy;
function fieldText(policy: PolicyDraft, field: PolicyField): string {
  if (field === "sources") return policy.sources.map(source => `${SOURCE_KINDS[source.kind]}: ${source.location}\n${source.note}`).join("\n\n") || "Nenhuma referência";
  if (field === "state") return POLICY_STATES[policy.state];
  if (field === "category") return POLICY_CATEGORIES[policy.category];
  return policy[field] || "Não informado";
}

export function PolicyCatalog() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [etag, setEtag] = useState("");
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("");
  const [state, setState] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<PolicyDraft>();
  const [editing, setEditing] = useState(false);
  const [basePolicy, setBasePolicy] = useState<PolicyDraft>();
  const [fieldConflicts, setFieldConflicts] = useState<PolicyField[]>([]);
  const [changeNote, setChangeNote] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  async function readCatalog() {
    const response = await fetch(endpoint);
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? "Não foi possível carregar o caderno.");
    return { value: value as Catalog, etag: response.headers.get("etag") ?? `"${value.revision}"` };
  }
  async function load() {
    const latest = await readCatalog();
    setCatalog(latest.value); setEtag(latest.etag);
  }
  async function reviewConflict() {
    if (!draft || busy) return;
    setBusy(true); setMessage("");
    try {
      const latest = await readCatalog();
      if (editing && basePolicy) {
        const current = latest.value.policies.find(policy => policy.id === basePolicy.id);
        if (!current) throw new Error("A ficha não está mais disponível. Preserve sua edição antes de cancelar.");
        const merged = mergePolicyDraft(basePolicy, draft, toDraft(current));
        setDraft(merged.draft); setFieldConflicts(merged.conflicts);
        setBasePolicy(structuredClone(toDraft(current)));
        setMessage(merged.conflicts.length ? "Escolha o conteúdo dos campos em conflito antes de salvar." : "Alterações em campos diferentes foram reunidas. Confira a ficha antes de salvar.");
      } else {
        setMessage("Caderno atualizado. Confira o código e os dados antes de salvar.");
      }
      setCatalog(latest.value); setEtag(latest.etag); setConflict(false);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  function resolveField(field: PolicyField, useCurrent: boolean) {
    if (!draft || !basePolicy) return;
    if (useCurrent) setDraft({ ...draft, [field]: structuredClone(basePolicy[field]) });
    setFieldConflicts(fields => fields.filter(item => item !== field));
  }
  useEffect(() => { void load().catch(error => setMessage(error.message)); }, []);
  const selected = catalog?.policies.find(policy => policy.id === selectedId);
  const duplicateId = !editing && !!draft && !!catalog?.policies.some(policy => policy.id === draft.id.trim());
  const visible = catalog?.policies.filter(policy => (!product || policy.product === product || policy.product === "shared") && (!state || policy.state === state) &&
    fold([policy.id, policy.title, policy.rule, policy.owner, policy.enforcement, ...policy.sources.map(source => source.location)].join(" ")).includes(fold(query))) ?? [];
  function edit(policy?: Policy) {
    setEditing(!!policy);
    setBasePolicy(policy ? structuredClone(toDraft(policy)) : undefined); setFieldConflicts([]);
    setDraft(policy ? structuredClone(toDraft(policy)) : { ...emptyPolicy(), product: (product || "erp") as PolicyDraft["product"] });
    setChangeNote(""); setMessage(""); setConflict(false);
  }
  async function save() {
    if (!draft || busy || conflict || fieldConflicts.length) return;
    if (duplicateId) { setMessage("Este código já existe. Informe outro código ou abra a ficha existente para editar."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag }, body: JSON.stringify({ policy: draft, changeNote }) });
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 412) setConflict(true);
        throw new Error(value.error?.message ?? "Não foi possível salvar.");
      }
      setCatalog(value); setEtag(response.headers.get("etag")!); setSelectedId(draft.id);
      setDraft(undefined); setMessage("Política salva. A versão anterior permanece no histórico.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  function exportCatalog() {
    if (!catalog) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `politicas-r${catalog.revision}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="shell policy-shell">
    <header><a className="brand" href="/experiments/">Ávila<span>Experiments</span></a><nav><a href="/experiments/">Laboratório</a><a href="/experiments/policies" aria-current="page">Caderno de políticas</a><a href="/experiments/openapi.json">Contrato API</a></nav><span className="private">Cadastro privado</span></header>
    <main>
      <div className="intro"><div><p className="muted">Um lugar para consultar as regras de cada produto</p><h1>Caderno de políticas.</h1><p>Qual é a regra, onde ela vive, quem cuida e qual evidência sustenta sua situação.</p></div><div className="revision"><strong>{catalog ? `r${catalog.revision}` : "…"}</strong><span>Revisão do caderno</span></div></div>
      <p className="notice">Inventário parcial. A situação de cada política é registrada pela equipe; cadastrar uma regra não a aplica nos produtos e não executa seus testes. Sem fichas significa inventário pendente, não ausência de políticas.</p>
      <div role="status" aria-live="polite" className={message ? "notice" : ""}>{message}</div>
      <section className="policy-controls"><h2>Consultar o catálogo</h2>
        <div className="fields"><label>Buscar políticas<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Regra, código, responsável ou arquivo"/></label>
          <label>Produto<select value={product} onChange={event => { setProduct(event.target.value); setSelectedId(""); }}><option value="">Todos os produtos</option>{PRODUCTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Situação<select value={state} onChange={event => setState(event.target.value)}><option value="">Todas as situações</option>{Object.entries(POLICY_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <div className="policy-products">{PRODUCTS.map(item => { const count = catalog?.policies.filter(policy => policy.product === item.id).length ?? 0; return <button key={item.id} aria-pressed={product === item.id} onClick={() => { setProduct(item.id); setSelectedId(""); }}><strong>{item.name}</strong><span>{count ? `${count} fichas cadastradas` : "Inventário pendente"}</span></button>; })}</div>
        <p className="muted">Princípios compartilhados também aparecem nos filtros por produto. Sua aplicação em cada sistema precisa ser verificada.</p>
        <div className="actions"><button className="primary" disabled={!catalog || !!draft || importing} onClick={() => edit()}>Nova política</button><button disabled={!catalog || !!draft || importing} onClick={() => setImporting(true)}>Importar fichas JSON</button><button disabled={!catalog} onClick={exportCatalog}>Exportar caderno JSON</button></div>
      </section>
      {importing && <PolicyImport onCancel={() => setImporting(false)} onComplete={(result, revision) => {
        setCatalog(result.catalog); setEtag(revision); setImporting(false);
        if (result.created[0]) setSelectedId(result.created[0]);
        setMessage(`${result.created.length} ${result.created.length === 1 ? "ficha cadastrada" : "fichas cadastradas"}; ${result.preserved.length} ${result.preserved.length === 1 ? "código existente preservado" : "códigos existentes preservados"}.`);
      }}/>}
      {draft && <section className="policy-editor"><h2>{editing ? "Revisar política" : "Cadastrar política"}</h2>
        <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy} className="editor-fields" aria-label="Editar política">
          <div className="fields"><label>Código da política<input required maxLength={80} pattern="[A-Z][A-Z0-9]*(-[A-Z0-9]+)+" placeholder="ERP-ACCESS-003" disabled={editing} value={draft.id} onChange={event => setDraft({ ...draft, id: event.target.value })}/></label>
            <label>Produto da política<select disabled={editing} value={draft.product} onChange={event => setDraft({ ...draft, product: event.target.value as PolicyDraft["product"] })}>{PRODUCTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          {duplicateId && <p role="alert">Este código já existe. Informe outro código ou abra a ficha existente para editar.</p>}
          <label>Título da política<input required maxLength={180} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
          <div className="fields"><label>Categoria<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as PolicyDraft["category"] })}>{Object.entries(POLICY_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Situação declarada<select value={draft.state} onChange={event => setDraft({ ...draft, state: event.target.value as PolicyDraft["state"] })}>{Object.entries(POLICY_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Responsável<input required maxLength={160} value={draft.owner} onChange={event => setDraft({ ...draft, owner: event.target.value })}/></label></div>
          <label>O que a regra exige<textarea required maxLength={8000} rows={5} value={draft.rule} onChange={event => setDraft({ ...draft, rule: event.target.value })}/></label>
          <label>Onde e como é aplicada<textarea maxLength={4000} rows={3} value={draft.enforcement} onChange={event => setDraft({ ...draft, enforcement: event.target.value })}/></label>
          <label>Data da verificação declarada<input type="date" max={new Date().toISOString().slice(0, 10)} value={draft.verificationDate} onChange={event => setDraft({ ...draft, verificationDate: event.target.value })}/></label>
          <h3>Fontes, implementação e evidências</h3><p className="muted">Informe arquivo, seção, teste ou URL. Referências são texto e não são abertas ou executadas pelo servidor.</p>
          {draft.sources.map((source, index) => <fieldset key={index}><legend>Referência {index + 1}</legend><label>Tipo de referência<select value={source.kind} onChange={event => setDraft({ ...draft, sources: draft.sources.map((item, position) => position === index ? { ...item, kind: event.target.value as typeof source.kind } : item) })}>{Object.entries(SOURCE_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Arquivo, seção ou URL<input required maxLength={2000} value={source.location} onChange={event => setDraft({ ...draft, sources: draft.sources.map((item, position) => position === index ? { ...item, location: event.target.value } : item) })}/></label>
            <label>Limitações ou observações<textarea maxLength={2000} value={source.note} onChange={event => setDraft({ ...draft, sources: draft.sources.map((item, position) => position === index ? { ...item, note: event.target.value } : item) })}/></label><button type="button" onClick={() => setDraft({ ...draft, sources: draft.sources.filter((_, position) => position !== index) })}>Remover referência {index + 1}</button></fieldset>)}
          <button type="button" disabled={draft.sources.length >= 20} onClick={() => setDraft({ ...draft, sources: [...draft.sources, { kind: "document", location: "", note: "" }] })}>Adicionar referência</button>
          <label>Motivo da alteração<textarea required maxLength={2000} value={changeNote} onChange={event => setChangeNote(event.target.value)}/></label>
          {conflict && <div className="conflict" role="alert"><strong>Outra revisão foi salva.</strong><p>Sua edição e o motivo foram preservados. Confira a versão atual para reunir alterações independentes e resolver campos modificados nas duas telas.</p><button type="button" onClick={() => void reviewConflict()}>Conferir versão atual</button></div>}
          {!!fieldConflicts.length && basePolicy && <div className="conflict" role="alert"><strong>Há campos com duas alterações.</strong><p>Escolha o conteúdo de cada campo. Você também pode ajustar o formulário antes de manter sua edição.</p>
            {fieldConflicts.map(field => <div className="policy-conflict-field" role="group" aria-label={`Conflito: ${POLICY_FIELD_LABELS[field]}`} key={field}>
              <h3>{POLICY_FIELD_LABELS[field]}</h3><div className="policy-conflict-values"><div><strong>Sua edição</strong><pre>{fieldText(draft, field)}</pre></div><div><strong>Versão salva por outra pessoa</strong><pre>{fieldText(basePolicy, field)}</pre></div></div>
              <div className="actions"><button type="button" onClick={() => resolveField(field, false)}>Manter minha edição</button><button type="button" onClick={() => resolveField(field, true)}>Usar versão atual</button></div>
            </div>)}
          </div>}
          <div className="actions"><button className="primary" disabled={busy || conflict || duplicateId || !!fieldConflicts.length} type="submit">{busy ? "Salvando…" : "Salvar política"}</button><button type="button" disabled={busy} onClick={() => setDraft(undefined)}>Cancelar edição</button></div>
        </fieldset></form>
      </section>}
      <div className="policy-layout"><section className="policy-list"><h2>{visible.length} fichas encontradas</h2>{!visible.length && <p className="empty">Nenhuma ficha para este filtro. O inventário deste produto pode estar pendente.</p>}
        {visible.map(policy => <button className={selectedId === policy.id ? "policy-card selected" : "policy-card"} key={policy.id} onClick={() => setSelectedId(policy.id)}><span className="hash">{policy.id} · v{policy.version} · {productName(policy.product)}</span><strong>{policy.title}</strong><span>{POLICY_STATES[policy.state]}</span><span className="muted">{policy.owner}</span></button>)}
      </section>
      <section className="policy-paper" aria-label="Ficha da política">{selected ? <>
        <div className="section-title"><p className="hash">{selected.id} · versão {selected.version}</p><div className="actions"><button disabled={!!draft || importing} onClick={() => edit(selected)}>Editar política</button><button onClick={() => window.print()}>Imprimir ficha</button></div></div>
        <h2>{selected.title}</h2><dl className="policy-facts"><div><dt>Produto</dt><dd>{productName(selected.product)}</dd></div><div><dt>Situação declarada</dt><dd>{POLICY_STATES[selected.state]}</dd></div><div><dt>Categoria</dt><dd>{POLICY_CATEGORIES[selected.category]}</dd></div><div><dt>Responsável</dt><dd>{selected.owner}</dd></div></dl>
        <h3>O que a regra exige</h3><p className="policy-text">{selected.rule}</p><h3>Onde é aplicada</h3><p className="policy-text">{selected.enforcement || "Local de aplicação ainda não mapeado."}</p>
        <h3>Fontes e evidências</h3>{selected.sources.length ? selected.sources.map((source, index) => <div className="policy-source" key={index}><strong>{SOURCE_KINDS[source.kind]}</strong><p className="hash">{source.location}</p><p>{source.note}</p></div>) : <p>Nenhuma fonte cadastrada.</p>}
        <p className="muted">Última alteração: {date(selected.updatedAt)}. Verificação declarada: {selected.verificationDate || "Não registrada"}.</p>
        <p className="policy-print-note">Cadastro privado e manual. Esta ficha registra uma situação declarada; não aplica a regra nem executa os testes citados.</p>
        <div className="policy-history"><h3>Histórico desta política</h3>{catalog?.history.filter(change => change.policy.id === selected.id).slice().reverse().map(change => <details key={change.revision + ":" + change.policy.id}><summary>v{change.policy.version} · {date(change.at)}</summary><p>{change.changeNote}</p><p>Situação: {POLICY_STATES[change.policy.state]}</p><p className="policy-text">{change.policy.rule}</p><pre>{JSON.stringify(change.policy, null, 2)}</pre></details>)}</div>
      </> : <div className="empty"><h2>Abra uma ficha.</h2><p>Selecione uma política para consultar a regra e os locais em que ela está definida e aplicada.</p></div>}</section></div>
      <footer>Cadastro privado e manual. Histórico preserva versões, mas não é um log inviolável nem identifica individualmente quem editou sob a credencial compartilhada.</footer>
    </main>
  </div>;
}
