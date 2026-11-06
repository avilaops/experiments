import json
import tempfile
import unittest
from pathlib import Path
from collect_ci import REPOS, collect, query_repo, selected_run

class FakeResponse:
    status = 200
    def __init__(self, data): self.data = data
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self, size): return self.data[:size]

class GithubEvidenceTest(unittest.TestCase):
    def test_known_valid_run_and_unknown_or_unsafe(self):
        good = {
            "id": 45, "name": "CI", "head_sha": "a" * 40, "status": "completed",
            "conclusion": "success", "html_url": "https://github.com/avilaops/ERP-Next/actions/runs/45",
            "event": "push", "updated_at": "2026-11-06T12:00:00Z",
        }
        self.assertEqual(selected_run(good)["sourceSha"], good["head_sha"])
        self.assertIsNone(selected_run({**good, "head_sha": "not-sha"}))
        self.assertIsNone(selected_run({**good, "html_url": "https://evil.example/x"}))
        self.assertIsNone(selected_run({**good, "conclusion": "claimed-approved"}))
        body = json.dumps({"workflow_runs": [good]}).encode()
        result = query_repo("avilaops/ERP-Next", opener=lambda *_args, **_kw: FakeResponse(body))
        self.assertTrue(result["available"])
        self.assertEqual(len(result["latestRuns"]), 1)

    def test_snapshots_are_written_without_fabricating_results(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / "github-ci"
            collect(folder, fetch=lambda repo: {"repository": repo, "available": False, "reason": "test_unavailable"})
            report = json.loads((folder / "latest.json").read_text())
            self.assertEqual(report["schema"], "avila-github-ci-inventory/1")
            self.assertEqual(len(report["projects"]), len(REPOS))
            self.assertTrue(all(not item["available"] for item in report["projects"]))
            self.assertEqual(len(list((folder / "snapshots").glob("*.json"))), 1)

if __name__ == "__main__":
    unittest.main()
