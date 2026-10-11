"""Small fixture-generator checks; no database, Docker, browser or live objects."""
import hashlib
import importlib.util
import io
import json
import re
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

    def test_catalogue_acceptance_preserves_core_bytes_and_has_real_distinct_sizes(self):
        # Generate only 36 files per profile. No database/server/browser; existing sharp only.
        with tempfile.TemporaryDirectory(dir="/private/tmp") as ordinary, tempfile.TemporaryDirectory(dir="/private/tmp") as acceptance:
            ordinary_sql = seed.ebook_library_seed(ROOT, Path(ordinary), 36)
            acceptance_sql = seed.ebook_library_seed(ROOT, Path(acceptance), 36, catalogue_acceptance=True)
            ordinary_bucket, acceptance_bucket = Path(ordinary) / "durtal", Path(acceptance) / "durtal"
            def original_by_comment(bucket):
                found = {}
                for path in bucket.glob("gold/ebooks/epub/*/*/file.epub"):
                    payload = path.read_bytes()
                    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                        self.assertIsNone(archive.testzip())
                        found[archive.comment[:36].decode()] = (payload, path, len(archive.comment))
                return found
            normal, varied = original_by_comment(ordinary_bucket), original_by_comment(acceptance_bucket)
            self.assertEqual(set(normal), set(varied))
            for number in (1, 3, 4, 9, 17, 21):
                self.assertEqual(normal[seed.ident("ebook", number)][0], varied[seed.ident("ebook", number)][0])
            sizes = {}
            for number, padding in ((30, 1024), (33, 32768), (36, 8192)):
                data, path, comment_size = varied[seed.ident("ebook", number)]
                self.assertEqual(comment_size, 36 + padding)
                self.assertEqual(len(data), len(normal[seed.ident("ebook", number)][0]) + padding)
                self.assertEqual(hashlib.sha256(data).hexdigest(), path.parent.name)
                manifest = json.loads(next(path.parent.glob("derived/v2/*/manifest.json")).read_bytes())["medallion"]
                original = next(item for item in manifest["artifacts"] if item["key"].endswith("file.epub"))
                self.assertEqual(original["size"], len(data))
                self.assertEqual(original["sha256"], hashlib.sha256(data).hexdigest())
                report = (acceptance_bucket / manifest["silver"]["key"]).read_bytes()
                self.assertEqual(hashlib.sha256(report).hexdigest(), manifest["silver"]["sha256"])
                self.assertEqual(json.loads(report)["source"], manifest["bronze"])
                sizes[number] = len(data)
            self.assertEqual(sorted(sizes, key=sizes.get), [30, 36, 33])
            # Read actual generated SQL values independently of the generator's tuple order.
            updates = re.findall(r"update ebooks set authors=.*?author_sort='([^']+)', created_at='([^']+)'.*?where id='([^']+)';", acceptance_sql)
            by_id = {ebook_id: (author_sort, created_at) for author_sort, created_at, ebook_id in updates}
            numbers = {seed.ident("ebook", number): number for number in (30, 33, 36)}
            self.assertEqual(set(by_id), set(numbers))
            self.assertEqual([numbers[key] for key in sorted(by_id, key=lambda key: by_id[key][0])], [33, 36, 30])
            self.assertEqual([numbers[key] for key in sorted(by_id, key=lambda key: by_id[key][1])], [36, 30, 33])
            places = re.findall(r"insert into ebook_positions\(id,.*?select '[^']+','([^']+)'.*?'([0-9]{4}-01-01T00:00:00Z)' from ebook_files", acceptance_sql)
            by_place = {ebook_id: date for ebook_id, date in places}
            self.assertEqual(set(by_place), set(numbers))
            self.assertEqual([numbers[key] for key in sorted(by_place, key=by_place.get)], [33, 30, 36])
            # Seed rows33/36 are born under work30: no trigger-sensitive edition reparent.
            self.assertNotIn(f"insert into works(id,kind,title,slug) values('{seed.ident('work', 33)}'", acceptance_sql)
            self.assertNotIn(f"insert into works(id,kind,title,slug) values('{seed.ident('work', 36)}'", acceptance_sql)
            self.assertIn("exclusion_reason", ordinary_sql)
            self.assertIn("QA Catalogue Triplet", acceptance_sql)

    def test_acceptance_refuses_small_corpus_and_nonprivate_directory_before_writes(self):
        with self.assertRaises(ValueError):
            seed.ebook_library_seed(ROOT, Path("/private/tmp/not-used"), 7, catalogue_acceptance=True)
        with self.assertRaises(ValueError):
            seed.ebook_library_seed(ROOT, Path("/not-used"), 36, catalogue_acceptance=True)

    def test_refuses_invalid_size_before_any_fixture_write(self):
        with self.assertRaises(ValueError):
            seed.ebook_library_seed(ROOT, Path("/not-used"), 0)


if __name__ == "__main__":
    unittest.main()
