import { useEffect, useState } from "react";
import type { StoredRun, Suite, SuiteDraft } from "../../src/lab/contracts.js";
import type { Comparison, Summary } from "../../src/types.js";

const base = "/experiments";
const labels: Record<string, string> = { passed: "Aprovado", failed: "Reprovado", error: "Erro", inconclusive: "Inconclusivo", scored: "Pontuado" };
const pretty = (value: unknown) => value === undefined ? "Sem referência" : JSON.stringify(value, null, 2);
function Badge({ value }: { value: string }) { return <span className={"badge " + value}>{labels[value] ?? value}</span>; }
function Metrics({ summary }: { summary: Summary }) {
  return <><div className="metrics">
    {[["Aprovados", summary.passed], ["Reprovados", summary.failed], ["Erros", summary.errors], ["Inconclusivos", summary.inconclusive], ["Taxa de aprovação", (summary.passRate * 100).toFixed(1) + "%"], ["Duração média", summary.durationMs.mean.toFixed(2) + " ms"]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
  </div><p className="muted">Tokens de entrada: {summary.usage.inputTokens.total ?? "Não medido"} ({summary.usage.inputTokens.measuredRuns}/{summary.total} execuções medidas). Custo: {summary.usage.costUsd.total === null ? "Não medido" : "$" + summary.usage.costUsd.total} ({summary.usage.costUsd.measuredRuns}/{summary.total}). Tempos do demo não são benchmark estatístico.</p></>;
}

export function App() {
  const [suite, setSuite] = useState<Suite>();
  const [etag, setEtag] = useState("");
  const [draft, setDraft] = useState<SuiteDraft>();
  const [cases, setCases] = useState("");
  const [runs, setRuns] = useState<{ id: string; createdAt: string; suiteRevision: number; candidate: Summary }[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<StoredRun>();
  const [variant, setVariant] = useState<"baseline" | "candidate">("candidate");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [comparison, setComparison] = useState<Comparison>();

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(base + path, options);
    const value = await response.json();
    if (!response.ok) {
      if (response.status === 412 || response.status === 409) setConflict(true);
      throw new Error(value.error?.message ?? "HTTP " + response.status);
    }
    return { value, response };
  }
  async function loadSuite() {
    const { value, response } = await request("/api/v1/suite");
    setSuite(value); setEtag(response.headers.get("etag") ?? '"' + value.revision + '"');
    setDraft({ hypothesis: value.hypothesis, cases: value.dataset.cases, settings: value.settings });
    setCases(pretty(value.dataset.cases)); setConflict(false); setDirty(false);
  }
  async function history(page = offset) {
    const { value } = await request("/api/v1/runs?limit=10&offset=" + page);
    setRuns(value.items); setTotal(value.total);
  }
  useEffect(() => { void Promise.all([loadSuite(), history(0)]).catch(error => setMessage(error.message)); }, []);
  useEffect(() => { const timer = setInterval(() => { void history().catch(() => {}); }, 10000); return () => clearInterval(timer); }, [offset]);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await fn(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    if (!draft) return;
    const parsed = JSON.parse(cases);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("Informe uma lista de casos não vazia.");
    const { value, response } = await request("/api/v1/suite", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag }, body: JSON.stringify({ ...draft, cases: parsed }) });
    setSuite(value); setEtag(response.headers.get("etag")!); setDraft({ ...draft, cases: parsed }); setDirty(false); setConflict(false); setMessage("Revisão " + value.revision + " salva.");
  }
  async function execute() {
    if (!suite) return;
    const { value } = await request("/api/v1/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: suite.revision }) });
    setSelected(value); setComparison(value.comparison); setBefore(value.id + ":baseline"); setAfter(value.id + ":candidate");
    await history(0); setOffset(0); setMessage("Execução registrada. Candidata: " + labels[value.candidate.summary.verdict] + ".");
  }
  const report = selected?.[variant];
  return <div className="shell">
    <header><a className="brand" href={base + "/"}>Ávila<span>Experiments</span></a><nav><a href={base + "/policies"}>Caderno de políticas</a><a href="/evidencias/">Evidências públicas</a><a href={base + "/openapi.json"}>Contrato API</a><a href="https://github.com/avilaops/experiments">Código e documentação</a></nav><span className="private">Laboratório privado</span></header>
    <main><div className="intro"><div><p className="muted">Laboratório de engenharia baseada em evidências</p><h1>O resultado importa.<br/>O caminho também.</h1><p>Cálculos reproduzíveis, critérios explícitos e histórico de cada decisão.</p></div><div className="revision"><strong>{suite ? "r" + suite.revision : "…"}</strong><span>Revisão carregada<br/>Núcleo 0.3.0</span></div></div>
      <div role="status" aria-live="polite" className={message ? "notice" : ""}>{message}</div>
      {conflict && <div className="conflict" role="alert"><strong>Outra revisão foi salva.</strong><p>Sua edição permanece nesta tela. Copie o texto se quiser preservá-lo antes de recarregar.</p><button onClick={() => void action(loadSuite)}>Recarregar suíte</button></div>}
      <section aria-labelledby="overview"><div className="section-title"><h2 id="overview">Visão geral</h2>{report && <Badge value={report.summary.verdict}/>}</div>{report ? <Metrics summary={report.summary}/> : <p className="empty">Execute a suíte ou selecione um registro no histórico para inspecionar as evidências.</p>}</section>
      <section><div className="section-title"><h2>Casos e critérios</h2><span>{suite?.dataset.cases.length ?? 0} casos salvos · split {suite?.dataset.split ?? "development"}</span></div>
        {draft && <form onSubmit={event => { event.preventDefault(); if (!busy) void action(save); }}><fieldset disabled={busy} className="editor-fields" aria-label="Editar suíte">
          <label>Hipótese<input value={draft.hypothesis} maxLength={2000} onChange={event => { setDraft({ ...draft, hypothesis: event.target.value }); setDirty(true); }}/></label>
          <div className="fields">{([['absoluteTolerance', 'Tolerância absoluta'], ['relativeTolerance', 'Tolerância relativa'], ['minimum', 'Mínimo'], ['maximum', 'Máximo'], ['repetitions', 'Repetições']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" step={key === 'repetitions' ? '1' : 'any'} required min={key.includes('Tolerance') ? 0 : key === 'repetitions' ? 1 : undefined} max={key === 'repetitions' ? 10 : undefined} value={draft.settings[key]} onChange={event => { setDraft({ ...draft, settings: { ...draft.settings, [key]: event.target.valueAsNumber } }); setDirty(true); }}/></label>)}</div>
          <div className="checks">{(['includeMinimum', 'includeMaximum'] as const).map(key => <label key={key}><input type="checkbox" checked={draft.settings[key]} onChange={event => { setDraft({ ...draft, settings: { ...draft.settings, [key]: event.target.checked } }); setDirty(true); }}/>{key === 'includeMinimum' ? 'Incluir mínimo' : 'Incluir máximo'}</label>)}</div>
          <label>Casos da suíte (JSON)<textarea className="case-editor" spellCheck={false} value={cases} onChange={event => { setCases(event.target.value); setDirty(true); }}/></label>
          <div className="actions"><button disabled={busy} type="submit">{busy ? "Processando…" : "Salvar revisão"}</button><button className="primary" type="button" disabled={busy || dirty || conflict} onClick={() => void action(execute)}>Executar suíte salva</button><span className="muted">{dirty ? "Há alterações locais. Salve antes de executar." : "A base arredonda; a candidata preserva frações."}</span></div>
        </fieldset></form>}
      </section>
      <section><div className="section-title"><h2>Histórico persistente</h2><span>{total} registros · atualização a cada 10 s</span></div><div className="table-scroll"><table><thead><tr><th>Execução</th><th>Data</th><th>Revisão</th><th>Candidata</th><th>Aprovados</th></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td><button className="link" onClick={() => void action(async () => { setSelected((await request("/api/v1/runs/" + run.id)).value); })}>{run.id.slice(0, 8)}</button></td><td>{new Date(run.createdAt).toLocaleString('pt-BR')}</td><td>r{run.suiteRevision}</td><td><Badge value={run.candidate.verdict}/></td><td>{run.candidate.passed}/{run.candidate.total}</td></tr>)}</tbody></table></div>{!total && <p className="empty">Nenhuma execução registrada.</p>}<div className="actions"><button disabled={!offset || busy} onClick={() => void action(async () => { const page = Math.max(0, offset - 10); await history(page); setOffset(page); })}>Anterior</button><button disabled={offset + 10 >= total || busy} onClick={() => void action(async () => { await history(offset + 10); setOffset(offset + 10); })}>Próxima</button></div></section>
      <section><h2>Comparar evidências</h2><p className="muted">Somente execuções com premissas equivalentes permitem comparação.</p><div className="fields">{[{ label: "Referência", value: before, update: setBefore }, { label: "Candidata", value: after, update: setAfter }].map(({ label, value, update }) => <label key={label}>{label}<select aria-label={label} value={value} onChange={event => update(event.target.value)}><option value="">Selecione</option>{runs.flatMap(run => ['baseline', 'candidate'].map(v => <option key={run.id + v} value={run.id + ":" + v}>{run.id.slice(0, 8)} / {v}</option>))}</select></label>)}</div><button disabled={!before || !after || busy} onClick={() => void action(async () => { const selector = (value: string) => { const [runId, variant] = value.split(':'); return { runId, variant }; }; setComparison((await request('/api/v1/comparisons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseline: selector(before), candidate: selector(after) }) })).value); })}>Comparar</button>
        {comparison && (comparison.comparable ? <div className="notice"><strong>Comparação válida</strong><p>Variação da aprovação: {(comparison.passRateDelta * 100).toFixed(1)} pontos percentuais. Regressões: {comparison.regressions.length}.</p><p className="hash">Base: {comparison.baselineRunId}<br/>Candidata: {comparison.candidateRunId}</p></div> : <div className="conflict"><strong>Execuções não comparáveis</strong><ul>{comparison.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>)}
      </section>
      {selected && report && <section><div className="section-title"><h2>Detalhe da execução</h2><a href={base + "/api/v1/runs/" + selected.id + "?download=1"}>Baixar evidência JSON</a></div><p className="hash">Registro {selected.id}<br/>Dataset SHA-256: {report.dataset.hash}<br/>Código: {report.variant.codeVersion}</p><label>Variante<select aria-label="Variante" value={variant} onChange={event => setVariant(event.target.value as typeof variant)}><option value="baseline">Base (arredondada)</option><option value="candidate">Candidata (fracionária)</option></select></label>
        <div className="case-list">{report.cases.map(result => { const reference = selected.suite.dataset.cases.find(item => item.id === result.caseId); return <details key={result.caseId + result.repetition}><summary><span>{result.caseId} · repetição {result.repetition}</span><Badge value={result.verdict}/></summary><div className="triplet"><div><h3>Entrada</h3><pre>{pretty(reference?.input)}</pre></div><div><h3>Referência</h3><pre>{pretty(reference?.expected)}</pre></div><div><h3>Saída</h3><pre>{pretty(result.output)}</pre></div></div><p className="hash">Entrada: {result.inputHash}<br/>Saída: {result.outputHash ?? 'Não produzida'}</p>{result.error && <p role="alert">Erro em {result.error.phase}: {result.error.message}</p>}<ul>{result.evaluations.map(evaluation => <li key={evaluation.evaluatorId}><Badge value={evaluation.verdict}/> <strong>{evaluation.evaluatorId}</strong>: {evaluation.reason} — score {evaluation.score ?? 'Não medido'}</li>)}</ul></details>; })}</div></section>}
      <footer>Evidências de desenvolvimento. Aprovação não autoriza deploy. <a href="/evidencias/">Consulte o escopo e as limitações.</a></footer>
    </main></div>;
}
