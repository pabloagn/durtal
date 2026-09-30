#!/usr/bin/env python3
"""Run all Vitest suites against a fresh, disposable PostgreSQL container.

Requires Docker, an already installed postgres:16 image, and project dependencies.
Never reads .env files, accepts a database URL, or reuses a running database.
Usage: python3 scripts/qa/test-local.py [Vitest file filters ...]
"""

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]


def run(*args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def database_manifest():
    """Fail closed if a suite lacks the explicit local opt-in convention."""
    manifest = []
    for path in sorted((ROOT / "src/__tests__/integration").glob("*.test.ts")):
        source = path.read_text()
        variables = set(re.findall(r"process\.env\.(DURTAL_\w+_DATABASE_URL)", source))
        names = set(re.findall(r'pathname !== "/(sln\d+_[a-z_]+)"', source))
        if len(variables) != 1 or len(names) != 1:
            raise RuntimeError(f"Missing explicit database guard in {path.name}")
        manifest.append({"suite": str(path.relative_to(ROOT)), "variable": variables.pop(), "database": names.pop()})
    for key in ("variable", "database"):
        if len({entry[key] for entry in manifest}) != len(manifest):
            raise RuntimeError(f"Integration suites must not share {key}")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("filters", nargs="*", help="Optional Vitest file filters")
    parser.add_argument("--report-dir", type=Path, help="Directory for log and JSON reports (default: a new temporary directory)")
    args = parser.parse_args()
    manifest = database_manifest()
    run(sys.executable, "scripts/qa/test_book_ingestion.py", cwd=ROOT)
    run("docker", "image", "inspect", "postgres:16")  # Never implicitly pull/install.
    report_dir = (args.report_dir or Path(tempfile.mkdtemp(prefix="durtal-tests-"))).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    container = f"durtal-test-{secrets.token_hex(6)}"
    password = secrets.token_hex(24)
    started = time.monotonic()
    report = {"status": "failed", "suites": manifest, "filters": args.filters, "pythonBookImportTests": "passed"}
    child = None

    def interrupted(signum, _frame):
        if child and child.poll() is None:
            child.terminate()
        raise KeyboardInterrupt(f"Interrupted by signal {signum}")

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    print(f"Reports: {report_dir}", flush=True)
    try:
        docker_env = {**os.environ, "POSTGRES_PASSWORD": password}
        run("docker", "run", "--detach", "--pull", "never", "--name", container,
            "--publish", "127.0.0.1::5432", "--env", "POSTGRES_USER=durtal_test",
            "--env", "POSTGRES_PASSWORD", "postgres:16", env=docker_env)
        for _ in range(60):
            # The image's temporary bootstrap server accepts only Unix sockets.
            # Wait for TCP so createdb cannot race with its shutdown.
            ready = subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "durtal_test"], capture_output=True)
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Disposable PostgreSQL did not become ready")
        port = run("docker", "port", container, "5432/tcp").removeprefix("127.0.0.1:")
        if not port.isdigit():
            raise RuntimeError("Expected one loopback-only PostgreSQL port")
        env = {key: value for key, value in os.environ.items()
               if key != "DATABASE_URL" and not (key.startswith("DURTAL_") and key.endswith("DATABASE_URL"))}
        env["DOTENV_CONFIG_PATH"] = os.devnull
        env["DURTAL_TEST_REPORT_DIR"] = str(report_dir)
        for entry in manifest:
            run("docker", "exec", container, "createdb", "-U", "durtal_test", entry["database"])
            env[entry["variable"]] = f"postgresql://durtal_test:{password}@127.0.0.1:{port}/{entry['database']}"
        print(f"Running tests with {len(manifest)} isolated databases.", flush=True)
        with (report_dir / "vitest.log").open("w") as log:
            child = subprocess.Popen(
                ["node", "node_modules/vitest/vitest.mjs", "run", "--no-file-parallelism",
                 "--reporter=default", "--reporter=json", f"--outputFile.json={report_dir / 'vitest.json'}", *args.filters],
                cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            code = child.wait()
        print("\n".join((report_dir / "vitest.log").read_text().splitlines()[-65:]))
        results = json.loads((report_dir / "vitest.json").read_text())
        pending = results.get("numPendingTests", 0) + results.get("numTodoTests", 0)
        report.update(status="passed" if code == 0 and pending == 0 else "failed",
                      tests=results.get("numTotalTests"), passed=results.get("numPassedTests"), skipped=pending)
        return 0 if report["status"] == "passed" else 1
    finally:
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        cleanup = subprocess.run(["docker", "rm", "--force", "--volumes", container], capture_output=True)
        if cleanup.returncode:
            report["status"] = "failed"
        report.update(elapsedSeconds=round(time.monotonic() - started, 2), containerRemoved=cleanup.returncode == 0)
        (report_dir / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
        if cleanup.returncode:
            raise RuntimeError(f"Could not remove disposable container {container}: {cleanup.stderr.decode().strip()}")


if __name__ == "__main__":
    raise SystemExit(main())
