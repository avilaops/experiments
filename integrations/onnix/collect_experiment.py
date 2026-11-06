#!/usr/bin/env python3
"""Evidência independente do ONNIX para o Ávila Experiments. Sem armazenar imagens."""
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from PIL import Image

OUTPUT = Path(os.environ.get("ONNIX_EVIDENCE_DIR", "/data/onnix"))
WORKER = "http://127.0.0.1:3391/upscale"
MODEL = Path("/opt/avila-ml/upscale-cpu/model.onnx")
TOKEN = os.environ["UPSCALE_WORKER_TOKEN"]

def save_atomic(path, doc):
    temp = path.with_name("." + path.name + "." + str(os.getpid()) + ".tmp")
    try:
        with temp.open("x", encoding="utf-8") as out:
            json.dump(doc, out, ensure_ascii=False, indent=2)
            out.write("\n")
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)

def evaluate():
    image = Image.new("RGB", (64, 64))
    for y in range(64):
        for x in range(64):
            image.putpixel((x, y), (x * 4, y * 4, (x + y) * 2))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    payload = buffer.getvalue()
    started = time.perf_counter()
    request = Request(WORKER, data=payload, headers={
        "Content-Type": "image/png",
        "Authorization": "Bearer " + TOKEN,
    }, method="POST")
    with urlopen(request, timeout=45) as response:
        code = response.status
        mime = response.headers.get("Content-Type")
        result = response.read(3 * 1024 * 1024)
    elapsed = round((time.perf_counter() - started) * 1000, 2)
    with Image.open(io.BytesIO(result)) as out:
        size = list(out.size)
        fmt = out.format
        out.verify()
    ok = code == 200 and mime == "image/webp" and size == [256, 256] and fmt == "WEBP"
    return {
        "verdict": "passed" if ok else "failed", "httpStatus": code,
        "latencyMs": elapsed, "inputPixels": [64, 64], "outputPixels": size,
        "outputFormat": fmt, "outputBytes": len(result),
        "inputSha256": hashlib.sha256(payload).hexdigest(),
        "outputSha256": hashlib.sha256(result).hexdigest(),
    }

def main():
    OUTPUT.mkdir(mode=0o755, parents=True, exist_ok=True)
    with (OUTPUT / ".lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        now = datetime.now(timezone.utc)
        report = {
            "schema": "avila-onnix-evidence/1",
            "service": "avila-upscale-cpu",
            "provider": "CPUExecutionProvider",
            "createdAt": now.isoformat().replace("+00:00", "Z"),
            "modelSha256": hashlib.sha256(MODEL.read_bytes()).hexdigest(),
            "modelBytes": MODEL.stat().st_size,
        }
        try:
            report["evaluation"] = evaluate()
        except Exception as error:
            report["evaluation"] = {"verdict": "error", "errorType": type(error).__name__}
        run_id = now.strftime("%Y%m%dT%H%M%SZ")
        runs = OUTPUT / "runs"
        runs.mkdir(mode=0o755, exist_ok=True)
        save_atomic(runs / (run_id + ".json"), report)
        save_atomic(OUTPUT / "latest.json", report)
        print(json.dumps({"createdAt": report["createdAt"], "verdict": report["evaluation"]["verdict"], "latencyMs": report["evaluation"].get("latencyMs")}))
        if report["evaluation"]["verdict"] != "passed":
            raise SystemExit(1)

if __name__ == "__main__":
    main()
