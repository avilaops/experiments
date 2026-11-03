"""Publish a static CI artifact; preserve all other Caddy routes and secrets."""
import argparse
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    parser.add_argument("revision")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.revision) or os.geteuid() != 0:
        raise SystemExit("Expected a complete Git revision and root publication access")
    source = args.artifact.resolve(strict=True)
    html = (source / "site/index.html").read_bytes()
    snippet = (source / "deploy/public-home.caddy").read_text()
    replacement = "\n".join("    " + line for line in snippet.splitlines())
    config = Path("/etc/caddy/ml.avilaops.com.caddy")
    original = config.read_text()
    old = "    handle {\n        reverse_proxy 127.0.0.1:3301\n    }"
    if "@mlops_private" in original:
        if replacement not in original:
            raise SystemExit("Installed public routing differs; inspect before updating")
        updated = original
    elif original.count(old) == 1:
        updated = original.replace(old, replacement)
    else:
        raise SystemExit("Expected exactly one dashboard catch-all; no changes made")
    # The existing header block deletes Server, so Caddy defers its operations.
    # Its blanket noindex would overwrite the public handler's response header.
    robots_matcher = "    @mlops_nonpublic not path /\n"
    if robots_matcher not in updated:
        blanket = '        X-Robots-Tag "noindex, nofollow"\n'
        site_start = "ml.avilaops.com {\n"
        if updated.count(blanket) != 1 or updated.count(site_start) != 1:
            raise SystemExit("Unexpected global indexing policy; no changes made")
        updated = updated.replace(blanket, "", 1).replace(
            site_start,
            site_start + robots_matcher + '    header @mlops_nonpublic X-Robots-Tag "noindex, nofollow"\n',
            1,
        )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("/opt/avila-experiments/backups") / ("public-home-" + stamp)
    backup.mkdir(parents=True)
    shutil.copy2(config, backup / config.name)
    release = Path("/srv/avila-mlops/releases") / args.revision
    release.mkdir(parents=True, exist_ok=True)
    target = release / "index.html"
    if target.exists() and target.read_bytes() != html:
        raise SystemExit("Release already contains different content")
    target.write_bytes(html)
    target.chmod(0o644)
    current = Path("/srv/avila-mlops/current")
    if current.exists() and not current.is_symlink():
        raise SystemExit("Expected release symlink; no routing changes made")
    previous = os.readlink(current) if current.is_symlink() else None
    (backup / "previous-release.txt").write_text(previous or "")
    temporary = config.with_name(config.name + ".public-home-new")
    shutil.copy2(config, temporary)
    temporary.write_text(updated)
    os.replace(temporary, config)
    try:
        subprocess.run(["caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"], check=True, capture_output=True)
        link = current.with_name("release-" + stamp)
        link.symlink_to(release, target_is_directory=True)
        os.replace(link, current)
        subprocess.run(["systemctl", "reload", "caddy"], check=True, capture_output=True)
    except Exception:
        shutil.copy2(backup / config.name, config)
        if previous is not None:
            link = current.with_name("rollback-" + stamp)
            link.symlink_to(previous, target_is_directory=True)
            os.replace(link, current)
        elif current.is_symlink():
            current.unlink()
        subprocess.run(["systemctl", "reload", "caddy"], capture_output=True)
        raise SystemExit("Publication failed; previous Caddy configuration restored")
    print("Published revision: " + args.revision)
    print("Home SHA256: " + hashlib.sha256(html).hexdigest())
    print("Caddy backup: " + str(backup))


if __name__ == "__main__":
    main()
