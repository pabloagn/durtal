"""Book identity regression tests; no dependencies, environment files or network."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch


def load_helpers():
    # The helpers' connection factory is not exercised here. Stub its imports so
    # the actual lookup/upsert code can be tested without importing live config.
    pg = types.ModuleType("psycopg2")
    config = types.ModuleType("scripts.ingest.config")
    config.DATABASE_URL = "unused"
    spec = importlib.util.spec_from_file_location("ingest_helpers", Path(__file__).parents[1] / "ingest/db.py")
    helpers = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"psycopg2": pg, "psycopg2.extras": types.ModuleType("psycopg2.extras"), "scripts.ingest.config": config}):
        spec.loader.exec_module(helpers)
    return helpers


class BookImportIdentity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helpers = load_helpers()

    def test_existing_book_reuses_its_id(self):
        cur = Mock()
        cur.fetchone.return_value = ("book-id", "book")
        self.assertEqual(self.helpers.lookup_id(cur, "works", "slug", "same-title"), "book-id")

    def test_non_book_slug_collision_is_rejected_before_linking(self):
        for kind in ("film", "perfume", "painting"):
            with self.subTest(kind=kind):
                cur = Mock()
                cur.fetchone.return_value = ("other-id", kind)
                with self.assertRaisesRegex(ValueError, "non-book"):
                    self.helpers.lookup_id(cur, "works", "slug", "same-title")
                self.assertEqual(cur.execute.call_count, 1)
                self.assertTrue(cur.execute.call_args.args[0].startswith("SELECT"))

    def test_conflict_retry_requires_a_book(self):
        cur = Mock()
        cur.fetchone.side_effect = [None, None]
        with self.assertRaisesRegex(ValueError, "non-book"):
            self.helpers.upsert_returning_id(cur, "works", ["kind", "slug"], ("book", "same-title"), "slug")
        self.assertIn("DO NOTHING", cur.execute.call_args_list[0].args[0])
        self.assertIn("kind = 'book'", cur.execute.call_args_list[1].args[0])

    def test_conflict_retry_can_reuse_a_book(self):
        cur = Mock()
        cur.fetchone.side_effect = [None, ("book-id",)]
        self.assertEqual(self.helpers.upsert_returning_id(cur, "works", ["slug"], ("same-title",), "slug"), "book-id")

    def test_import_cannot_overwrite_an_existing_work(self):
        cur = Mock()
        with self.assertRaisesRegex(ValueError, "overwrite"):
            self.helpers.upsert_returning_id(cur, "works", ["slug", "title"], ("same-title", "Changed"), "slug", update_on_conflict=True, update_columns=["title"])
        cur.execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
