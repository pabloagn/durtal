"""Small fixture-generator checks; no database, Docker, browser or live objects."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ebook_library_seed", ROOT / "scripts/qa/ebook_library_seed.py")
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


class EbookLibrarySeed(unittest.TestCase):
    def test_unique_valid_bytes_and_hash_bound_publication_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            sql = seed.ebook_library_seed(ROOT, Path(directory), 7)
            bucket = Path(directory) / "durtal"
            originals = sorted(bucket.glob("gold/ebooks/epub/*/*/file.epub"))
            checksums = []
            for source in originals:
                data = source.read_bytes()
                checksum = hashlib.sha256(data).hexdigest()
                self.assertEqual(source.parent.name, checksum)
                checksums.append(checksum)
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    self.assertEqual(archive.read("mimetype"), b"application/epub+zip")
                    self.assertIsNone(archive.testzip())
                    self.assertTrue(archive.comment)
            self.assertEqual(len(checksums), len(set(checksums)))
            self.assertEqual(len(checksums), 4)  # missing, protected and quarantined have no delivered original.
            for marker_path in bucket.glob("gold/ebooks/epub/*/*/derived/v2/*/manifest.json"):
                manifest = json.loads(marker_path.read_bytes())["medallion"]
                report_path = bucket / manifest["silver"]["key"]
                report_bytes = report_path.read_bytes()
                self.assertEqual(hashlib.sha256(report_bytes).hexdigest(), manifest["silver"]["sha256"])
                report = json.loads(report_bytes)
                self.assertEqual(report["source"], manifest["bronze"])
                self.assertEqual(report["validation"], manifest["validation"])
                for object in manifest["artifacts"]:
                    path = bucket / object["key"]
                    # Number 6 intentionally simulates a missing published original.
                    if object["key"].endswith("file.epub") and not path.exists():
                        continue
                    payload = path.read_bytes()
                    self.assertEqual(hashlib.sha256(payload).hexdigest(), object["sha256"])
                    self.assertEqual(len(payload), object["size"])
                    if object["key"].endswith(".webp"):
                        self.assertTrue(payload.startswith(b"RIFF"))
                        self.assertEqual(payload[8:12], b"WEBP")
                self.assertEqual(marker_path.parent.name, manifest["silver"]["sha256"])
            self.assertIn("current_database() <> 'durtal_preview'", sql)
            self.assertIn("insert into instances", sql)
            self.assertIn("'excluded'", sql)
            self.assertIn("'adobe-adept'", sql)
            self.assertIn("'quarantined'", sql)
            self.assertIn("'missing'", sql)

    def test_refuses_invalid_size_before_any_fixture_write(self):
        with self.assertRaises(ValueError):
            seed.ebook_library_seed(ROOT, Path("/not-used"), 0)


if __name__ == "__main__":
    unittest.main()
