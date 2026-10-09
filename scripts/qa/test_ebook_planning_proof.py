#!/usr/bin/env python3
"""Bounded pure wrapper guards. No service, process, container or credential call."""
import importlib.util
import json
from pathlib import Path
import signal
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
