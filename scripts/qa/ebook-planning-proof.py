#!/usr/bin/env python3
"""Prepare then execute source-bound SLN-494 proof, only after coordinator approval.

Preparation is local: no Docker, database, AWS, corpus generation or browser.
The manifest and its printed SHA-256 are the concrete review boundary. Execution
requires both, a clean exact source checkout, unchanged inputs and runtime.

prepare --mode disposable --source SHA --postgres-image-id sha256:HEX --report-dir DIR
prepare --mode pooled --source SHA --legacy-prefix PREFIX
        --source-inventory FILE --approved-plan FILE --object-inventory FILE
        --roundtrip-evidence FILE --database-url-sha256 HEX --report-dir DIR
execute --manifest FILE --manifest-sha256 HEX

Pooled execution reads only DATABASE_URL from the primary .env then .env.local,
with local precedence, and requires its full approved SHA-256. No ambient URL
is accepted. Credentials remain in memory. The only live actions
are guarded PostgreSQL reads (plus the deliberately refused savepoint write
probe), identity/temporary credential reads, and S3 LIST/HEAD/GET. The disposable
mode runs every suite in the existing isolated runner, with no filters.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
SAFE_ENV = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def file_hash(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()


def source(expected):
    if not re.fullmatch(r"[a-f0-9]{40}", expected):
        raise ValueError("Source needs a full reviewed Git SHA")
    if command("git", "rev-parse", "HEAD") != expected:
        raise ValueError("Source is not the reviewed exact SHA")
    status = command("git", "status", "--porcelain", "--untracked-files=all").splitlines()
    # A temporary dependency symlink is permitted; no other untracked file is.
    if any(line != "?? node_modules" or not (ROOT / "node_modules").is_symlink() for line in status):
        raise ValueError("Source checkpoint must be clean")
    return {"commit": expected, "tree": command("git", "rev-parse", "HEAD^{tree}"),
            "packageLockSha256": file_hash(ROOT / "pnpm-lock.yaml")}


def runtime():
    node = command("node", "--version")
    installation = {}
    for relative in ("node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml"):
        path = ROOT / relative
        if not path.is_file():
            raise ValueError("Existing reviewed dependencies are required; nothing is installed")
        installation[relative] = file_hash(path)
    return {"python": sys.version, "node": node, "platform": sys.platform,
            "dependencies": installation}


def inputs(paths, max_files, max_bytes):
    records = []
    total = 0
    for named in sorted(paths):
        path = Path(named)
        if path.is_symlink() or not path.is_file():
            raise ValueError("Original inputs must be real files")
        before = path.stat()
        total += before.st_size
        if len(records) >= max_files or total > max_bytes:
            raise ValueError("Input exceeds the reviewed bound")
        sha = file_hash(path)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise ValueError("Input changed while fingerprinting")
        records.append({"path": str(path), "bytes": after.st_size,
                        "mtimeNs": str(after.st_mtime_ns), "sha256": sha})
    return {"files": records, "bytes": total, "sha256": digest(canonical(records))}


def write_json(path, value):
    with path.open("x", encoding="utf8") as stream:
        os.chmod(path, 0o600)
        stream.write(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def private_target(env_dir, expected_hash):
    # Only these non-secret fingerprints reach stdout. dotenv values stay in the child.
    program = """import { readPrivateTarget } from './scripts/qa/ebook-proof-control.ts';
const {fingerprint,urlHash}=readPrivateTarget(process.argv[1],process.argv[2]);
process.stdout.write(JSON.stringify({fingerprint,urlHash}));"""
    return json.loads(command("node", "--import", "tsx", "--input-type=module", "-e", program, str(env_dir), expected_hash))


def prepare(args):
    report = args.report_dir.resolve()
    evidence = {}
    approved = []
    if args.mode == "pooled":
        for key in ("source_inventory", "approved_plan", "object_inventory", "roundtrip_evidence"):
            named = getattr(args, key)
            if not named or not named.is_file():
                raise ValueError("Reviewed private evidence is required")
            evidence[key] = {"path": str(named.resolve()), "sha256": file_hash(named)}
        approved = json.loads(args.source_inventory.read_text())["sources"]
    originals = sorted(item["path"] for item in approved)
    if report.is_relative_to(ROOT) or any(Path(named).is_relative_to(report) for named in originals):
        raise ValueError("Evidence must be outside source and disjoint from inputs")
    if len(originals) != len(set(originals)):
        raise ValueError("Original inputs must be distinct")
    if args.mode == "pooled":
        if len(originals) != 3 or not re.fullmatch(r"[a-f0-9]{64}", args.database_url_sha256 or "") :
            raise ValueError("Pooled proof needs the original three files, 21 reviewed keys and database fingerprint")
        if args.legacy_prefix and not re.fullmatch(r"(?:[a-z0-9][a-z0-9._-]*/)+", args.legacy_prefix):
            raise ValueError("Invalid legacy prefix")
    elif originals or not re.fullmatch(r"sha256:[a-f0-9]{64}", args.postgres_image_id or ""):
        raise ValueError("Disposable proof needs an explicit installed postgres:16 image ID and no inputs")
    limits = {"files": args.max_files, "inputBytes": args.max_input_bytes,
              "objects": args.max_objects, "downloadBytes": args.max_download_bytes,
              "requests": args.max_requests, "databaseRows": args.max_database_rows,
              "databaseBytes": args.max_database_bytes, "seconds": args.max_seconds}
    ceilings = {"files": 500, "inputBytes": 1024**3, "objects": 5000,
                "downloadBytes": 1024**3, "requests": 20000, "databaseRows": 500000,
                "databaseBytes": 256 * 1024**2, "seconds": 3600}
    if any(not 0 < value <= ceilings[key] for key, value in limits.items()):
        raise ValueError("Invalid proof bound")
    manifest = {"version": 1, "mode": args.mode, "source": source(args.source),
                "runtime": runtime(), "reportDir": str(report), "originalFiles": originals,
                "inputs": inputs(originals, limits["files"], limits["inputBytes"]),
                "databaseFingerprint": None,
                "postgresImageId": args.postgres_image_id, "legacyPrefix": args.legacy_prefix,
                "aws": {"profile": "durtal-personal", "account": "608240934043",
                        "region": "eu-north-1", "bucket": "durtal"},
                "limits": limits, "includeText": args.include_text,
                "commands": ["ListObjectsV2Command", "HeadObjectCommand", "GetObjectCommand"]}
    if args.mode == "pooled":
        if evidence["approved_plan"]["sha256"] != "86ddd46d41e7cff1281bdfe18d43531b40b2473b6faa5d3a75935781818c415f":
            raise ValueError("Approved SLN-569 plan differs")
        plan = json.loads(args.approved_plan.read_text())
        if plan["target"]["prefix"] != args.legacy_prefix:
            raise ValueError("Historical storage prefix differs")
        target = private_target(Path("/Users/pabloaguirre/personal/durtal"), args.database_url_sha256)
        if args.database_fingerprint and target["fingerprint"] != args.database_fingerprint:
            raise ValueError("Fresh private pooled fingerprint differs")
        manifest["databaseFingerprint"] = target["fingerprint"]
        manifest["historicalPlanDatabase"] = {"fingerprint": plan["target"]["database"], "purpose": "input/object provenance only"}
        expected = sorted(({"path": item["path"], "bytes": item["bytes"], "mtimeNs": str(item["mtimeNs"]), "sha256": item["sha256"]} for item in approved), key=lambda item: item["path"])
        if manifest["inputs"]["files"] != expected:
            raise ValueError("Original three files differ from approved evidence")
        planned_sources = sorted((item["path"], item["size"], item["sha256"]) for item in plan["files"].values())
        if planned_sources != sorted((item["path"], item["bytes"], item["sha256"]) for item in expected):
            raise ValueError("Original sources differ from the fixed approved plan")
        objects = json.loads(args.object_inventory.read_text())
        downloads = json.loads(args.roundtrip_evidence.read_text())["downloads"]
        keys = sorted(item["Key"] for item in objects)
        if len(keys) != 21 or len(set(keys)) != 21 or sorted(item["key"] for item in downloads) != keys or any(not item["verified"] for item in downloads):
            raise ValueError("Expected exactly 21 previously verified objects")
        plan_keys = set()
        def collect(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key == "key" and isinstance(item, str):
                        plan_keys.add(item)
                    else:
                        collect(item)
            elif isinstance(value, list):
                for item in value:
                    collect(item)
        for file in plan["files"].values():
            collect(file["medallion"])
        if sorted(plan_keys) != keys:
            raise ValueError("21-key inventory differs from approved plan")
        manifest.update(objectKeys=keys, reviewedObjects=objects, reviewedDownloads=downloads,
                        evidence=evidence, databaseUrlSha256=args.database_url_sha256,
                        envDir="/Users/pabloaguirre/personal/durtal")
        manifest["cleanupReserve"] = {"seconds": args.cleanup_seconds, "terminationSeconds": 5,
                                      "requests": args.cleanup_requests, "downloadBytes": sum(item["bytes"] for item in downloads)}
        reserve = manifest["cleanupReserve"]
        if reserve["seconds"] <= 0 or reserve["seconds"] + 5 >= limits["seconds"] or not 0 < reserve["requests"] < limits["requests"] or reserve["downloadBytes"] <= 0 or reserve["downloadBytes"] * 2 > limits["downloadBytes"]:
            raise ValueError("Insufficient bounded cleanup capacity")
    if report.exists() and any(report.iterdir()):
        raise ValueError("Evidence needs a new or empty private directory")
    report.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(report, 0o700)
    path = report / "manifest.json"
    write_json(path, manifest)
    print(f"Prepared only: {path}\nManifest SHA-256: {file_hash(path)}")


def wait_for_proof(child, started, seconds, reserve=None):
    """Stop pooled work early, retaining cleanup time inside the hard bound."""
    termination = reserve["terminationSeconds"] if reserve else 5
    cutoff = started + seconds - termination
    work_cutoff = cutoff - reserve["seconds"] if reserve else cutoff
    timed_out = False
    try:
        return child.wait(timeout=max(0, work_cutoff - time.monotonic())), timed_out, False
    except subprocess.TimeoutExpired:
        timed_out = True
        child.send_signal(signal.SIGTERM)
    try:
        return child.wait(timeout=max(0, cutoff - time.monotonic())), timed_out, False
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        try:
            child.wait(timeout=max(0, started + seconds - time.monotonic()))
        except subprocess.TimeoutExpired:
            pass
        return 1, timed_out, True


def evidence_status(report):
    try:
        before = json.loads((report / "before.json").read_text())
        after = json.loads((report / "after.json").read_text())
        complete = all(value[kind]["status"] == "complete" for value in (before, after) for kind in ("catalogue", "storage"))
        unchanged = complete and all(before[kind]["value"]["sha256"] == after[kind]["value"]["sha256"] for kind in ("catalogue", "storage"))
        return {"evidenceComplete": complete, "unchanged": unchanged}
    except Exception:
        return {"evidenceComplete": False, "unchanged": False}


def missing_snapshots(report, reason):
    # External termination or failed initialization can prevent the child from
    # reaching finally. Preserve any progressive evidence it already wrote.
    for name in ("before.json", "after.json"):
        if not (report / name).exists():
            write_json(report / name, {kind: {"status": "incomplete", "reason": reason} for kind in ("catalogue", "storage")})


def execute(args):
    path = args.manifest.resolve()
    if not re.fullmatch(r"[a-f0-9]{64}", args.manifest_sha256) or file_hash(path) != args.manifest_sha256:
        raise ValueError("Manifest differs from its reviewed fingerprint")
    manifest = json.loads(path.read_text())
    if manifest.get("version") != 1 or manifest["mode"] not in ("disposable", "pooled"):
        raise ValueError("Unknown proof manifest")
    if source(manifest["source"]["commit"]) != manifest["source"] or runtime() != manifest["runtime"]:
        raise ValueError("Source or dependency runtime changed since review")
    for item in manifest.get("evidence", {}).values():
        if file_hash(Path(item["path"])) != item["sha256"]:
            raise ValueError("Reviewed private evidence changed")
    bounds = manifest["limits"]
    if inputs(manifest["originalFiles"], bounds["files"], bounds["inputBytes"]) != manifest["inputs"]:
        raise ValueError("Input fingerprint changed since review")
    report = Path(manifest["reportDir"])
    if path != report / "manifest.json":
        raise ValueError("Manifest moved")
    env = {key: os.environ[key] for key in SAFE_ENV if key in os.environ}
    env["DOTENV_CONFIG_PATH"] = os.devnull
    if manifest["mode"] == "disposable":
        image = command("docker", "image", "inspect", "postgres:16", "--format", "{{.Id}}")
        if image != manifest["postgresImageId"]:
            raise ValueError("Installed disposable image differs from review; nothing launched")
        argv = [sys.executable, "scripts/qa/test-local.py", "--report-dir", str(report / "disposable")]
    else:
        argv = ["node", "node_modules/tsx/dist/cli.mjs", "--tsconfig", "tsconfig.json",
                "scripts/qa/ebook-pooled-proof.ts", "--execute-reviewed-manifest", str(path),
                "--manifest-sha256", args.manifest_sha256]
    started = time.monotonic()
    outcome = {"status": "failed", "manifestSha256": args.manifest_sha256,
               "source": manifest["source"], "mode": manifest["mode"]}
    # Reserve the attempt before launching; never overwrite an earlier proof.
    attempt = report / "attempt.json"
    write_json(attempt, outcome)
    child = None
    timed_out = False
    hard_stopped = False
    if manifest["mode"] == "pooled":
        argv += ["--hard-deadline-ms", str(int((time.time() + bounds["seconds"]) * 1000))]
    try:
        child = subprocess.Popen(argv, cwd=ROOT, env=env, start_new_session=True,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        code, timed_out, hard_stopped = wait_for_proof(child, started, bounds["seconds"], manifest.get("cleanupReserve"))
        if timed_out:
            outcome["reason"] = "Work deadline reached; bounded cleanup requested"
        if code == 0 and (not timed_out or manifest["mode"] == "pooled"):
            if source(manifest["source"]["commit"]) != manifest["source"] or runtime() != manifest["runtime"]:
                raise ValueError("Source/runtime changed during proof")
            if inputs(manifest["originalFiles"], bounds["files"], bounds["inputBytes"]) != manifest["inputs"]:
                raise ValueError("Inputs changed during proof")
            if manifest["mode"] == "pooled":
                child_result = json.loads((report / "pooled-result.json").read_text())
                state = evidence_status(report)
                if not state["evidenceComplete"] or not state["unchanged"] or not child_result.get("zeroMutationVerified") or child_result.get("manifestSha256") != args.manifest_sha256:
                    raise ValueError("Complete unchanged evidence is required")
            outcome["status"] = "passed"
        return 0 if outcome["status"] == "passed" else 1
    finally:
        if child:
            # On parent interruption, still allow the child to enter after
            # capture, but never wait beyond the pre-reserved hard deadline.
            if child.poll() is None:
                child.send_signal(signal.SIGTERM)
                reserve = manifest.get("cleanupReserve", {"terminationSeconds": 5})
                try:
                    child.wait(timeout=max(0, started + bounds["seconds"] - reserve["terminationSeconds"] - time.monotonic()))
                except subprocess.TimeoutExpired:
                    hard_stopped = True
            try:
                os.killpg(child.pid, signal.SIGKILL) # Also stops leftover native/CLI children.
            except ProcessLookupError:
                pass
        if manifest["mode"] == "pooled":
            missing_snapshots(report, "external_stop_or_failed_initialization")
            outcome.update(evidence_status(report))
            outcome["zeroMutationVerified"] = outcome["status"] == "passed" and outcome["evidenceComplete"] and outcome["unchanged"]
        outcome.update(gracefulStopRequested=timed_out, hardStopped=hard_stopped)
        outcome["elapsedSeconds"] = round(time.monotonic() - started, 2)
        write_json(report / "result.json", outcome)
        print(f"Proof {outcome['status']}: {report / 'result.json'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare")
    p.add_argument("--mode", choices=("disposable", "pooled"), required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--report-dir", type=Path, required=True)
    for name in ("source-inventory", "approved-plan", "object-inventory", "roundtrip-evidence"):
        p.add_argument(f"--{name}", type=Path)
    p.add_argument("--database-url-sha256")
    p.add_argument("--database-fingerprint")
    p.add_argument("--postgres-image-id")
    p.add_argument("--legacy-prefix", default="")
    p.add_argument("--include-text", action="store_true")
    p.add_argument("--cleanup-seconds", type=int, default=90)
    p.add_argument("--cleanup-requests", type=int, default=80)
    for name, default in (("files", 300), ("input-bytes", 512 * 1024**2), ("objects", 2000),
                          ("download-bytes", 128 * 1024**2), ("requests", 10000),
                          ("database-rows", 100000), ("database-bytes", 64 * 1024**2), ("seconds", 900)):
        p.add_argument(f"--max-{name}", type=int, default=default)
    e = commands.add_parser("execute")
    e.add_argument("--manifest", type=Path, required=True)
    e.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()
    try:
        return execute(args) if args.command == "execute" else prepare(args)
    except Exception:
        # Subprocess errors or DB URLs/credential output must never reach evidence.
        print("Proof refused or failed; sensitive diagnostics withheld", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
