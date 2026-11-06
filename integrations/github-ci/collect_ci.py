#!/usr/bin/env python3
"""Coleta fatos públicos da CI do GitHub por commit. Nunca executa workflows."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REPOS = (
    "avilaops/ERP-Next",
    "avilaops/app.avilaops.com",
    "avilaops/auth.avilaops.com",
    "avilaops/lojas.avilaops.com",
    "avilaops/crm.avilaops.com",
    "avilaops/TMS",
    "avilaops/cms.avilaops.com",
)
SHA = re.compile(r"^[a-f0-9]{40}$")
STATUSES = {"queued", "in_progress", "completed", "requested", "waiting", "pending"}
CONCLUSIONS = {"success", "failure", "cancelled", "skipped", "timed_out", "action_required", "neutral", "stale", "startup_failure"}
HEADERS = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "avilaops-experiments-github-ci-inventory/1",
    "X-GitHub-Api-Version": "2022-11-28",
}

def selected_run(run):
    if not isinstance(run, dict): return None
    sha = run.get("head_sha")
    status = run.get("status")
    conclusion = run.get("conclusion")
    url = run.get("html_url")
    identifier = run.get("id")
    if not isinstance(sha, str) or not SHA.fullmatch(sha): return None
    if status not in STATUSES: return None
    if conclusion is not None and conclusion not in CONCLUSIONS: return None
    if not isinstance(identifier, int) or identifier <= 0: return None
    if not isinstance(url, str) or not url.startswith("https://github.com/avilaops/"): return None
    if not isinstance(run.get("name"), str): return None
    return {
        "id": identifier, "name": run["name"][:160],
        "sourceSha": sha, "status": status, "conclusion": conclusion,
        "url": url, "event": str(run.get("event") or "")[:40],
        "updatedAt": run.get("updated_at"),
    }

def query_repo(repository, opener=urlopen):
    url = f"https://api.github.com/repos/{repository}/actions/runs?branch=main&per_page=6"
    request = Request(url, headers=HEADERS, method="GET")
    try:
        with opener(request, timeout=12) as response:
            if response.status != 200: raise ValueError("non_200")
            content = response.read(2 * 1024 * 1024 + 1)
            if len(content) > 2 * 1024 * 1024: raise ValueError("oversized_response")
    except HTTPError as error:
        return {"repository": repository, "available": False, "reason": f"github_http_{error.code}"}
    except (URLError, TimeoutError, OSError, ValueError):
        return {"repository": repository, "available": False, "reason": "github_unavailable"}
    try:
        body = json.loads(content)
        runs = body.get("workflow_runs")
        if not isinstance(runs, list): raise ValueError("missing_workflow_runs")
        valid = [item for item in (selected_run(run) for run in runs) if item is not None]
        return {
            "repository": repository,
            "available": True,
            "latestRuns": valid[:6],
            "sourceDigestSha256": hashlib.sha256(content).hexdigest(),
        }
    except (ValueError, TypeError):
        return {"repository": repository, "available": False, "reason": "invalid_github_payload"}

def atomic_json(path, data):
    payload = (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode()
    fd, tmp = tempfile.mkstemp(prefix=".github-ci-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def collect(output, fetch=query_repo):
    output.mkdir(parents=True, exist_ok=True, mode=0o755)
    with (output / ".lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        projects = [fetch(repo) for repo in REPOS]
        report = {
            "schema": "avila-github-ci-inventory/1",
            "collectedAt": now,
            "source": "https://api.github.com",
            "projects": projects,
            "note": "GitHub informa estados de workflow; não comprova aprovação humana, qualidade de IA, quantidade de testes nem health pós-deploy.",
        }
        runs = output / "snapshots"
        runs.mkdir(exist_ok=True, mode=0o755)
        run_id = now.replace(":", "").replace("-", "").replace(".", "")
        atomic_json(runs / (run_id + ".json"), report)
        atomic_json(output / "latest.json", report)
        print(json.dumps({"projects": len(projects), "available": sum(bool(item.get("available")) for item in projects), "collectedAt": now}))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=os.environ.get("GITHUB_CI_EVIDENCE_DIR", "/data/github-ci"))
    opts = parser.parse_args()
    collect(Path(opts.output))

if __name__ == "__main__":
    main()
