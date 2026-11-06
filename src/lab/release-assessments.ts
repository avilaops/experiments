import { latestGithubCiEvidence, type GithubCiProject, type GithubCiRun } from "./github-ci-evidence.js";

export type GateVerdict = "passed" | "failed" | "unknown";
export type ReleaseDecision = "rejected" | "review" | "approved";
export type ReleaseGate = { id: "ci" | "contract" | "security" | "humanApproval" | "deployment" | "postDeployHealth"; verdict: GateVerdict; evidence: string | null };
export type ReleaseAssessment = {
  repository: string;
  sourceSha: string | null;
  evaluatedAt: string;
  sourceCollectedAt: string | null;
  decision: ReleaseDecision;
  reason: string;
  gates: ReleaseGate[];
  workflowRuns: { id: number; name: string; status: string; conclusion: string | null; url: string }[];
};

function gate(id: ReleaseGate["id"], verdict: GateVerdict = "unknown", evidence: string | null = null): ReleaseGate {
  return { id, verdict, evidence };
}

function latestRevision(project: GithubCiProject): { sha: string | null; runs: GithubCiRun[] } {
  const runs = project.latestRuns ?? [];
  const sha = runs[0]?.sourceSha ?? null;
  return { sha, runs: sha ? runs.filter(run => run.sourceSha === sha) : [] };
}

/** Deliberately cannot approve deployment from CI alone.
 * Any missing provenance, consent, security or production-health evidence stays unknown.
 */
export function assessRelease(project: GithubCiProject, collectedAt: string | null, stale: boolean, now: Date): ReleaseAssessment {
  const { sha, runs } = latestRevision(project);
  const ci: ReleaseGate = gate("ci");
  if (project.available && !stale && sha && runs.length) {
    const failed = runs.filter(run => run.status === "completed" && ["failure", "timed_out", "startup_failure"].includes(run.conclusion ?? ""));
    const complete = runs.every(run => run.status === "completed" && run.conclusion === "success");
    if (failed.length) {
      ci.verdict = "failed";
      ci.evidence = failed[0]!.url;
    } else if (complete) {
      ci.verdict = "passed";
      ci.evidence = runs[0]!.url;
    }
  }
  const gates: ReleaseGate[] = [
    ci, gate("contract"), gate("security"), gate("humanApproval"), gate("deployment"), gate("postDeployHealth"),
  ];
  return {
    repository: project.repository,
    sourceSha: sha,
    evaluatedAt: now.toISOString(),
    sourceCollectedAt: collectedAt,
    decision: ci.verdict === "failed" ? "rejected" : "review",
    reason: ci.verdict === "failed" ? "Falha de CI registrada pelo GitHub para o commit selecionado." :
      ci.verdict === "passed" ? "CI concluída; contratos, segurança, aprovação humana e saúde pós-deploy ainda sem evidência de aprovação." :
      stale ? "Inventário GitHub desatualizado; nenhuma decisão de publicação autorizada." :
      !project.available ? "Não foi possível consultar a CI deste projeto." :
      "CI incompleta, inconclusiva ou sem dados para o commit selecionado.",
    gates,
    workflowRuns: runs.map(run => ({ id: run.id, name: run.name, status: run.status, conclusion: run.conclusion, url: run.url })),
  };
}

export async function currentReleaseAssessments(dataDirectory: string, now = new Date()) {
  const ci = await latestGithubCiEvidence(dataDirectory, now.getTime());
  if (!ci.available || !ci.projects) return { schema: "avila-release-assessments/1", generatedAt: now.toISOString(), sourceCollectedAt: null, stale: true, projects: [] as ReleaseAssessment[] };
  return {
    schema: "avila-release-assessments/1",
    generatedAt: now.toISOString(),
    sourceCollectedAt: ci.collectedAt ?? null,
    stale: Boolean(ci.stale),
    projects: ci.projects.map(project => assessRelease(project, ci.collectedAt ?? null, Boolean(ci.stale), now)),
  };
}
