import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOS = new Set([
  "avilaops/ERP-Next", "avilaops/app.avilaops.com", "avilaops/auth.avilaops.com",
  "avilaops/lojas.avilaops.com", "avilaops/crm.avilaops.com", "avilaops/TMS",
  "avilaops/cms.avilaops.com",
]);

export type GithubCiRun = {
  id: number;
  name: string;
  sourceSha: string;
  status: string;
  conclusion: string | null;
  url: string;
  event: string;
  updatedAt: string | null;
};

export type GithubCiProject = {
  repository: string;
  available: boolean;
  reason?: string;
  latestRuns?: GithubCiRun[];
};

export type GithubCiEvidence = {
  available: boolean;
  stale?: boolean;
  collectedAt?: string;
  projects?: GithubCiProject[];
};

export async function latestGithubCiEvidence(directory: string, nowMs = Date.now()): Promise<GithubCiEvidence> {
  const file = path.join(directory, "github-ci", "latest.json");
  let value: unknown;
  try {
    const content = await readFile(file, "utf8");
    if (Buffer.byteLength(content) > 256 * 1024) throw new Error("oversized");
    value = JSON.parse(content);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { available: false };
    throw new Error("Invalid GitHub CI evidence");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid GitHub CI evidence");
  const row = value as Record<string, unknown>;
  if (row.schema !== "avila-github-ci-inventory/1" || row.source !== "https://api.github.com" ||
      typeof row.collectedAt !== "string" || !Number.isFinite(Date.parse(row.collectedAt)) ||
      !Array.isArray(row.projects) || row.projects.length !== REPOS.size) throw new Error("Invalid GitHub CI evidence");
  const projects: GithubCiProject[] = [];
  const seen = new Set<string>();
  for (const item of row.projects) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid GitHub CI project");
    const project = item as Record<string, unknown>;
    if (typeof project.repository !== "string" || !REPOS.has(project.repository) ||
        seen.has(project.repository) || typeof project.available !== "boolean") throw new Error("Invalid GitHub CI project");
    seen.add(project.repository);
    if (!project.available) {
      projects.push({ repository: project.repository, available: false, reason: typeof project.reason === "string" ? project.reason.slice(0, 80) : "unavailable" });
      continue;
    }
    if (!Array.isArray(project.latestRuns) || project.latestRuns.length > 6) throw new Error("Invalid GitHub CI runs");
    const runs: GithubCiRun[] = [];
    for (const raw of project.latestRuns) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid GitHub CI run");
      const run = raw as Record<string, unknown>;
      if (!Number.isSafeInteger(run.id) || (run.id as number) <= 0 ||
          typeof run.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(run.sourceSha) ||
          typeof run.name !== "string" || run.name.length > 160 ||
          typeof run.url !== "string" || !run.url.startsWith("https://github.com/avilaops/") ||
          typeof run.status !== "string" || !["queued", "in_progress", "completed", "requested", "waiting", "pending"].includes(run.status) ||
          !(run.conclusion === null || (typeof run.conclusion === "string" &&
            ["success", "failure", "cancelled", "skipped", "timed_out", "action_required", "neutral", "stale", "startup_failure"].includes(run.conclusion)))) {
        throw new Error("Invalid GitHub CI run");
      }
      runs.push({
        id: run.id as number, name: run.name, sourceSha: run.sourceSha, url: run.url,
        status: run.status, conclusion: run.conclusion as string | null,
        event: typeof run.event === "string" ? run.event.slice(0, 40) : "",
        updatedAt: typeof run.updatedAt === "string" ? run.updatedAt : null,
      });
    }
    projects.push({ repository: project.repository, available: true, latestRuns: runs });
  }
  const age = nowMs - Date.parse(row.collectedAt);
  return {
    available: true,
    stale: age > 2 * 60 * 60 * 1000 || age < -60_000,
    collectedAt: row.collectedAt,
    projects,
  };
}
