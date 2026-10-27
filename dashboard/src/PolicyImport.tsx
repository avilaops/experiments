import { useState } from "react";
import { PRODUCTS, POLICY_STATES, SOURCE_KINDS, type PolicyImportPreview, type PolicyImportResult } from "../../src/lab/policy-contracts.js";

const endpoint = "/experiments/api/v1/policies/import";
const maximumBytes = 1024 * 1024;
interface Props {
  onCancel: () => void;
  onComplete: (result: PolicyImportResult, etag: string) => void;
}

export function PolicyImport({ onCancel, onComplete }: Props) {
  const [document, setDocument] = useState<unknown>();
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<PolicyImportPreview>();
  const [etag, setEtag] = useState("");
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function payload(value: unknown): string {
    const body = JSON.stringify(value);
    if (new TextEncoder().encode(body).length > maximumBytes) throw new Error("O arquivo e os dados da importação excedem 1 MiB. Divida o arquivo em lotes menores.");
    return body;
  }
  async function inspect(value: unknown) {
    const response = await fetch(endpoint + "/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload({ document: value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Não foi possível conferir o arquivo.");
    const revision = response.headers.get("etag");
    if (!revision) throw new Error("A prévia não retornou uma revisão. Confira novamente antes de importar.");
    setPreview(result); setEtag(revision); setReviewed(false); setStale(false);
  }
  async function selectFile(file?: File) {
    if (!file || busy) return;
    setBusy(true); setMessage(""); setPreview(undefined); setDocument(undefined); setReviewed(false); setStale(false); setNote(""); setFilename(file.name);
    try {
      if (file.size > maximumBytes) throw new Error("O arquivo excede 1 MiB. Divida o inventário em arquivos menores.");
      let value: unknown;
      try { value = JSON.parse(await file.text()); }
      catch { throw new Error("O arquivo não contém JSON válido."); }
      await inspect(value);
      setDocument(value);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function refreshPreview() {
    if (document === undefined || busy) return;
    setBusy(true); setMessage(""); setReviewed(false);
    try { await inspect(document); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview || document === undefined || !reviewed || !note.trim() || stale || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "If-Match": etag }, body: payload({ document, changeNote: note }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 412) { setStale(true); setPreview(undefined); setReviewed(false); }
        throw new Error(result.error?.message ?? "Não foi possível concluir a importação. Confira o caderno antes de tentar novamente.");
      }
      onComplete(result, response.headers.get("etag") ?? `"${result.catalog.revision}"`);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="policy-import" aria-labelledby="policy-import-title">
    <h2 id="policy-import-title">Importar fichas</h2>
    <p>Selecione uma lista de fichas em JSON ou uma exportação do caderno, com até 500 fichas e 1 MiB. Somente códigos novos serão cadastrados. Versões e histórico do arquivo não serão restaurados.</p>
    <p className="muted">A importação registra declarações. Não comprova fontes nem executa testes.</p>
    <form onSubmit={event => { event.preventDefault(); void commit(); }}><fieldset disabled={busy} className="editor-fields" aria-label="Importação de fichas">
      <label>Arquivo de fichas JSON<input type="file" accept=".json,application/json" onChange={event => void selectFile(event.target.files?.[0])}/></label>
      {filename && <p className="hash">Arquivo selecionado: {filename}</p>}
      {busy && <p role="status">Conferindo ou gravando o lote…</p>}
      {message && <p className="conflict" role="alert">{message}</p>}
      {stale && <button type="button" onClick={() => void refreshPreview()}>Atualizar prévia</button>}
      {preview && <>
        <h3>Prévia da importação</h3>
        <p role="status">{preview.createCount} {preview.createCount === 1 ? "ficha nova" : "fichas novas"} · {preview.preserveCount} {preview.preserveCount === 1 ? "código existente preservado" : "códigos existentes preservados"} · revisão {preview.revision}</p>
        <div className="policy-import-items">{preview.items.map(item => <details key={item.policy.id}>
          <summary><span>{item.policy.id} · {item.policy.title}</span><span>{item.action === "create" ? "Cadastrar" : "Preservar existente"}</span></summary>
          <p>Produto: {PRODUCTS.find(product => product.id === item.policy.product)?.name}. Situação declarada: {POLICY_STATES[item.policy.state]}. Responsável: {item.policy.owner}.</p>
          {item.different && <p className="notice">O arquivo contém dados diferentes para este código. A ficha existente será preservada integralmente.</p>}
          <h4>Regra no arquivo</h4><p className="policy-text">{item.policy.rule}</p>
          <h4>Local de aplicação no arquivo</h4><p className="policy-text">{item.policy.enforcement || "Não informado"}</p>
          <h4>Fontes no arquivo</h4>{item.policy.sources.length ? item.policy.sources.map((source, index) => <p className="hash" key={index}>{SOURCE_KINDS[source.kind]}: {source.location}<br/>{source.note}</p>) : <p>Nenhuma fonte cadastrada.</p>}
        </details>)}</div>
        <label>Motivo da importação<textarea required maxLength={2000} value={note} onChange={event => setNote(event.target.value)}/></label>
        <label className="policy-import-confirm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)}/>Conferi as fichas e entendo que os códigos existentes serão preservados.</label>
        <button className="primary" disabled={!reviewed || !note.trim() || stale || busy} type="submit">{preview.createCount ? "Importar fichas novas" : "Concluir sem alterações"}</button>
      </>}
      <button type="button" onClick={onCancel} disabled={busy}>Cancelar importação</button>
    </fieldset></form>
  </section>;
}
