"""SLN-493 disposable seed regressions; standard library, no services or live files."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("preview_local_reader_sync", ROOT / "scripts/qa/preview-local.py")
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class ReaderSyncSeed(unittest.TestCase):
    def test_second_format_is_unique_and_keeps_the_epub_preferred(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixtures = root / "src/__tests__/fixtures/ebooks"
            fixtures.mkdir(parents=True)
            for _, name, *_ in preview.READER_EBOOKS:
                (fixtures / name).write_bytes(b"fixture " + name.encode())
            output = root / "objects"
            with patch.object(preview, "ROOT", root):
                sql = preview.reader_seed(output)
            alternate = (fixtures / "text.pdf").read_bytes() + b"\n% Durtal reader sync alternate format\n"
            sha = hashlib.sha256(alternate).hexdigest()
            target = output / "durtal-ebooks" / f"files/{sha[:2]}/{sha}.pdf"
            self.assertEqual(target.read_bytes(), alternate)
            self.assertIn("'00000000-0000-4000-a000-e00000000001', '00000000-0000-4000-a000-000000000001'", sql)
            self.assertIn(sha, sql)
            self.assertEqual(sql.count("insert into ebooks("), len(preview.READER_EBOOKS))
            self.assertEqual(sql.count("insert into ebook_files("), len(preview.READER_EBOOKS) + 1)
            self.assertNotIn("set preferred_file_id = '00000000-0000-4000-a000-e00000000001'", sql)
            self.assertEqual(len(list(output.rglob("*.*"))), len(preview.READER_EBOOKS) + 1)


if __name__ == "__main__":
    unittest.main()
