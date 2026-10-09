#!/usr/bin/env python3
"""Bounded wrapper guards, including one local Node child. No service calls."""
import importlib.util
import json
from pathlib import Path
import signal
import os
import select
import shutil
import time
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("proof", Path(__file__).with_name("ebook-planning-proof.py"))
PROOF = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROOF)


class ProofGuards(unittest.TestCase):
    def test_preparation_separates_fresh_live_identity_from_historical_plan(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            sources = []
            files = {}
            keys = []
            for index in range(3):
                named = root / f"original-{index}.epub"
                named.write_bytes(bytes([index]))
                record = {"path": str(named), "bytes": 1, "mtimeNs": named.stat().st_mtime_ns, "sha256": PROOF.file_hash(named)}
                sources.append(record)
                file_keys = [f"bronze/ebooks/mock-{index}-{number}" for number in range(7)]
                keys += file_keys
                files[str(named)] = {"path": str(named), "size": 1, "sha256": record["sha256"], "medallion": [{"key": key} for key in file_keys]}
            documents = {"source_inventory": {"sources": sources}, "approved_plan": {"target": {"database": "0" * 16, "prefix": ""}, "files": files},
                         "object_inventory": [{"Key": key, "Size": 1} for key in keys],
                         "roundtrip_evidence": {"downloads": [{"key": key, "bytes": 1, "verified": True} for key in keys]}}
            paths = {}
            for name, value in documents.items():
                paths[name] = root / f"{name}.json"
                paths[name].write_text(json.dumps(value))
            args = SimpleNamespace(**paths, report_dir=root / "proof", mode="pooled", source="a" * 40,
                                   database_url_sha256="b" * 64, database_fingerprint=None, legacy_prefix="", postgres_image_id=None,
                                   max_files=3, max_input_bytes=3, max_objects=21, max_download_bytes=42, max_requests=256,
                                   max_database_rows=100, max_database_bytes=1000, max_seconds=240, include_text=False,
                                   cleanup_seconds=90, cleanup_requests=80)
            real_hash = PROOF.file_hash
            reviewed_plan = "86ddd46d41e7cff1281bdfe18d43531b40b2473b6faa5d3a75935781818c415f"
            with patch.object(PROOF, "source", return_value={"commit": args.source}), patch.object(PROOF, "runtime", return_value={}), \
                 patch.object(PROOF, "private_target", return_value={"fingerprint": "1" * 16, "urlHash": args.database_url_sha256}), \
                 patch.object(PROOF, "file_hash", side_effect=lambda named: reviewed_plan if named == paths["approved_plan"] else real_hash(named)), patch("builtins.print"):
                PROOF.prepare(args)
                manifest = json.loads((args.report_dir / "manifest.json").read_text())
                self.assertEqual(manifest["databaseFingerprint"], "1" * 16)
                self.assertEqual(manifest["historicalPlanDatabase"]["fingerprint"], "0" * 16)
                self.assertEqual(manifest["historicalPlanDatabase"]["purpose"], "input/object provenance only")
                args.database_fingerprint = "0" * 16
                with self.assertRaisesRegex(ValueError, "Fresh private pooled fingerprint differs"):
                    PROOF.prepare(args)

    def test_direct_node_soft_timeout_preserves_delayed_after_finally_marker(self):
        for phase, cleanup_seconds in (("busy", 1.4), ("awaiting signal", 1.15)):
            with self.subTest(phase=phase):
                self.check_direct_node_cleanup(cleanup_seconds)

    def check_direct_node_cleanup(self, cleanup_seconds):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            marker = root / "after-finally.json"
            script = root / "delayed-cleanup.mts"
            script.write_text("""import {writeFileSync} from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';
import {databaseErrorCode} from '@/lib/db/errors';
if(databaseErrorCode({code:'25006'})!=='25006') throw new Error('Pinned tsconfig alias did not load');
const marker=process.argv[process.argv.indexOf('--execute-reviewed-manifest')+1];
let stop!:()=>void;
const stopped=new Promise<void>(resolve=>{stop=resolve;});
process.on('SIGTERM',()=>stop());
// A signal listener and unresolved Promise alone do not keep Node's loop alive.
// Model the running proof's active I/O/timers, including after the busy delay.
const keepAlive=setInterval(()=>{},1000);
process.stdout.write(`ready:${process.pid}\\n`);
// Delay signal acknowledgement beyond the tsx CLI's two 30ms waits.
const blockedUntil=Date.now()+500;
while(Date.now()<blockedUntil) {}
try { await stopped; }
finally { await pause(200); writeFileSync(marker,JSON.stringify({afterFinally:true,pid:process.pid}),{flag:'wx'}); clearInterval(keepAlive); }
""")
            node = Path(shutil.which("node")).resolve()
            argv = PROOF.pooled_argv(node, marker, "0" * 64, script)
            self.assertEqual(argv[:3], [str(node), "--import", "tsx"])
            self.assertNotIn("node_modules/tsx/dist/cli.mjs", argv)
            env = PROOF.execution_environment("pooled", {"tsconfigPath": str(PROOF.ROOT / "tsconfig.json")})
            self.assertEqual(env["TSX_TSCONFIG_PATH"], str(PROOF.ROOT / "tsconfig.json"))
            child = subprocess.Popen(argv, cwd=PROOF.ROOT, env=env, start_new_session=True,
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            try:
                ready, _, _ = select.select([child.stdout], [], [], 5)
                self.assertTrue(ready, "Tiny local child did not become ready")
                self.assertEqual(child.stdout.readline().strip(), f"ready:{child.pid}")
                started = time.monotonic()
                code, timed_out, hard_stopped = PROOF.wait_for_proof(child, started, 2, {"seconds": cleanup_seconds, "terminationSeconds": 0.2})
                self.assertEqual((code, timed_out, hard_stopped), (0, True, False))
                self.assertLess(time.monotonic()-started, 2)
                self.assertEqual(json.loads(marker.read_text()), {"afterFinally": True, "pid": child.pid})
            finally:
                try:
                    if child.poll() is None:
                        child.kill()
                except ProcessLookupError:
                    pass
                child.wait(timeout=1)
                child.stdout.close()

    def test_soft_timeout_leaves_ninety_seconds_for_cleanup(self):
        child = Mock(pid=123)
        child.wait.side_effect = [subprocess.TimeoutExpired("mock", 145), 1]
        with patch.object(PROOF.time, "monotonic", side_effect=[0, 145]), patch.object(PROOF.os, "killpg") as kill:
            result = PROOF.wait_for_proof(child, 0, 240, {"seconds": 90, "terminationSeconds": 5})
        self.assertEqual(result, (1, True, False))
        self.assertEqual([call.kwargs["timeout"] for call in child.wait.call_args_list], [145, 90])
        child.send_signal.assert_called_once_with(signal.SIGTERM)
        kill.assert_not_called()

    def test_hard_timeout_uses_only_reserved_termination_time(self):
        child = Mock(pid=123)
        child.wait.side_effect = [subprocess.TimeoutExpired("mock", 145), subprocess.TimeoutExpired("mock", 90), -9]
        with patch.object(PROOF.time, "monotonic", side_effect=[0, 145, 235]), patch.object(PROOF.os, "killpg") as kill:
            result = PROOF.wait_for_proof(child, 0, 240, {"seconds": 90, "terminationSeconds": 5})
        self.assertEqual(result, (1, True, True))
        self.assertEqual([call.kwargs["timeout"] for call in child.wait.call_args_list], [145, 90, 5])
        kill.assert_called_once_with(123, signal.SIGKILL)

    def test_partial_after_evidence_survives_wrapper_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            after = {"catalogue": {"status": "complete", "value": {"sha256": "a"}}, "storage": {"status": "incomplete", "reason": "not_finished"}}
            (root / "after.json").write_text(json.dumps(after))
            original = (root / "after.json").read_bytes()
            PROOF.missing_snapshots(root, "external_stop")
            self.assertEqual((root / "after.json").read_bytes(), original)
            self.assertEqual(PROOF.evidence_status(root), {"evidenceComplete": False, "unchanged": False})
            self.assertEqual(json.loads((root / "before.json").read_text())["catalogue"]["status"], "incomplete")

    def test_complete_but_changed_fingerprints_cannot_claim_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, sha in (("before", "a"), ("after", "b")):
                (root / f"{name}.json").write_text(json.dumps({key: {"status": "complete", "value": {"sha256": sha}} for key in ("catalogue", "storage")}))
            self.assertEqual(PROOF.evidence_status(root), {"evidenceComplete": True, "unchanged": False})

    def test_missing_or_truncated_after_is_explicitly_incomplete(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            PROOF.missing_snapshots(root, "external_stop")
            self.assertEqual(PROOF.evidence_status(root), {"evidenceComplete": False, "unchanged": False})
            (root / "after.json").write_text('{"catalogue":')
            self.assertEqual(PROOF.evidence_status(root), {"evidenceComplete": False, "unchanged": False})


if __name__ == "__main__":
    unittest.main()
