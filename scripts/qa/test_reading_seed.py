"""Seed reading step tests (SLN-450); no dependencies, environment files or network."""
import csv
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load_step():
    # Stub the step's imports so the real mapping code runs without live config,
    # a spreadsheet library, a database driver or the console libraries.
    stubs = {name: types.ModuleType(name) for name in ("openpyxl", "psycopg2", "psycopg2.extras", "rich", "rich.console", "click", "dotenv")}
    stubs["rich.console"].Console = lambda *a, **k: types.SimpleNamespace(print=lambda *a, **k: None)
    stubs["dotenv"].load_dotenv = lambda *a, **k: None
    config = types.ModuleType("scripts.ingest.config")
    config.DATABASE_URL = "unused"
    config.EXCEL_PATH = "unused"
    config.LOCATION_MAP = {}
    config.METADATA_SOURCE = "test"
    stubs["scripts.ingest.config"] = config
    with patch.dict(sys.modules, stubs):
        sys.path.insert(0, str(ROOT))
        try:
            for name in ("scripts.ingest.seed_readings", "scripts.ingest.seed_books", "scripts.ingest.db", "scripts.ingest.utils"):
                sys.modules.pop(name, None)
            spec = importlib.util.spec_from_file_location("scripts.ingest.seed_readings", ROOT / "scripts/ingest/seed_readings.py")
            step = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(step)
        finally:
            sys.path.remove(str(ROOT))
    return step


def sheet_row(**cells):
    """A Books sheet row: the cells by the COL names, the rest empty."""
    from_col = STEP.COL
    row = [None] * (max(from_col.values()) + 1)
    for key, value in cells.items():
        row[from_col[key]] = value
    return tuple(row)


STEP = load_step()
BOOKS = {
    "slugs": {"watt-by-samuel-beckett": "w-watt"},
    "work_slugs": {"w-watt": "watt-by-samuel-beckett", "w-molloy": "molloy-by-samuel-beckett"},
    "ratings": {"w-watt": 4, "w-molloy": None},
    "editions": {"111": ("e-molloy", "w-molloy")},
    "links": {"222": "w-murphy"},
}


class ReadValues(unittest.TestCase):
    def test_known_values_map(self):
        for value, status in [("Yes", "finished"), ("y", "finished"), (True, "finished"), (1, "finished"), ("", None), (None, None), ("No", None), ("DNF", "abandoned"), ("Reading", "reading")]:
            with self.subTest(value=value):
                self.assertEqual(STEP.map_read(value), status)

    def test_a_date_means_finished(self):
        self.assertEqual(STEP.map_read(dt.datetime(2019, 4, 14)), "finished")
        self.assertEqual(STEP.map_read("2019-04-14"), "finished")

    def test_an_unclear_value_stops_the_step_and_lists_it(self):
        rows = [sheet_row(title="Watt", author="Beckett, Samuel", read="Maybe"), sheet_row(title="Molloy", author="Beckett, Samuel", read="Maybe"), sheet_row(title="Murphy", author="Beckett, Samuel", read="?")]
        with self.assertRaises(STEP.UnclearValues) as caught:
            STEP.build_readings(rows, BOOKS)
        self.assertEqual(caught.exception.values, {"Maybe": 2, "?": 1})


class Dates(unittest.TestCase):
    def test_precisions(self):
        cases = [
            (dt.datetime(2019, 4, 14, 0, 0), ("2019-04-14", "day")),
            (dt.date(2019, 4, 14), ("2019-04-14", "day")),
            (2015, ("2015-01-01", "year")),
            (2015.0, ("2015-01-01", "year")),
            ("2015", ("2015-01-01", "year")),
            ("2015-04", ("2015-04-01", "month")),
            ("2015/4/14", ("2015-04-14", "day")),
            ("2015-02-30", (None, "unknown")),
            ("spring", (None, "unknown")),
            (None, (None, "unknown")),
        ]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(STEP.parse_date(value), expected)


class Keys(unittest.TestCase):
    def test_the_python_copy_agrees_with_the_fixture(self):
        fixture = json.loads((ROOT / "src/__tests__/fixtures/reading/source-keys.json").read_text(encoding="utf-8"))
        for case in fixture["normalize"]:
            self.assertEqual(STEP.normalize_key_text(case["input"]), case["expected"], case["input"])
        seeds = [k for k in fixture["keys"] if k["builder"] == "seedReadingKey"]
        self.assertGreater(len(seeds), 2)
        for case in seeds:
            self.assertEqual(STEP.seed_reading_key(case["input"]["title"], case["input"]["firstAuthor"]), case["expected"], case["input"])


class Readings(unittest.TestCase):
    def test_header_is_the_durtal_columns(self):
        source = (ROOT / "src/lib/reading/import/durtal-format.ts").read_text(encoding="utf-8")
        block = re.search(r"DURTAL_READING_COLUMNS = \[(.*?)\] as const", source, re.S).group(1)
        expected = re.findall(r'"([a-z_0-9]+)"', block)
        self.assertEqual(len(expected), 26)
        built = STEP.build_readings([sheet_row(title="Watt", author="Beckett, Samuel", read="Yes", rating=4, finished_date=dt.datetime(2019, 4, 14))], BOOKS)
        with tempfile.TemporaryDirectory() as out:
            readings, _ = STEP.write_files(Path(out), built)
            with readings.open(encoding="utf-8") as f:
                rows = list(csv.reader(f))
        self.assertEqual(rows[0], expected)
        record = dict(zip(rows[0], rows[1]))
        self.assertEqual(
            {k: record[k] for k in ("work_id", "title", "authors", "status", "finished_on", "finished_precision", "started_precision", "rating", "format")},
            {"work_id": "w-watt", "title": "Watt", "authors": "Samuel Beckett", "status": "finished", "finished_on": "2019-04-14", "finished_precision": "day", "started_precision": "unknown", "rating": "4", "format": "print"},
        )
        self.assertEqual(record["source_key"], STEP.seed_reading_key("Watt", "Samuel Beckett"))

    def test_books_resolve_by_slug_goodreads_id_and_link_and_the_rest_stay_empty(self):
        rows = [
            sheet_row(title="Watt", author="Beckett, Samuel", read="Yes"),
            sheet_row(title="Molloy", author="Beckett, Samuel", read="Yes", goodreads_url="https://www.goodreads.com/book/show/111.Molloy"),
            sheet_row(title="Murphy", author="Beckett, Samuel", read="Yes", goodreads_path="/book/show/222"),
            sheet_row(title="Unknown", author="Nobody, A.", read="Yes"),
            sheet_row(title="Watt", author="Beckett, Samuel", read="Yes", duplicated_entry="Y"),
            sheet_row(title="Watt", author="Beckett, Samuel", read="Yes"),
            sheet_row(title="Not read", author="Nobody, A."),
        ]
        built = STEP.build_readings(rows, BOOKS)
        self.assertEqual([(r["title"], r["work_id"], r["edition_id"]) for r in built["rows"]], [("Watt", "w-watt", ""), ("Molloy", "w-molloy", "e-molloy"), ("Murphy", "w-murphy", ""), ("Unknown", "", "")])
        stats = built["stats"]
        self.assertEqual((stats["by_slug"], stats["by_goodreads_id"], stats["by_goodreads_link"], stats["unresolved"]), (2, 1, 1, 1))
        self.assertEqual(stats["skipped_dup"], 1)
        self.assertEqual([(line, first) for line, first, _ in stats["duplicate_keys"]], [(7, 2)])

    def test_an_open_read_has_no_finish_and_unparsed_dates_are_listed(self):
        built = STEP.build_readings([sheet_row(title="Watt", author="Beckett, Samuel", read="Reading", started_date="2024-09", finished_date="soon")], BOOKS)
        record = built["rows"][0]
        self.assertEqual((record["status"], record["started_on"], record["started_precision"], record["finished_on"], record["finished_precision"]), ("reading", "2024-09-01", "month", "", "unknown"))
        self.assertEqual(built["stats"]["unparsed_dates"], [(2, "finished_date", "soon")])


class PriorityRatings(unittest.TestCase):
    def test_an_empty_rating_with_the_priority_as_rating_is_listed(self):
        books = {**BOOKS, "ratings": {"w-watt": 4, "w-molloy": 3}}
        rows = [
            sheet_row(title="Watt", author="Beckett, Samuel", priority=4),
            sheet_row(title="Molloy", author="Beckett, Samuel", priority=4, goodreads_url="/book/show/111"),
        ]
        built = STEP.build_readings(rows, books)
        self.assertEqual(built["stats"]["priority_ratings"], [{"work_id": "w-watt", "slug": "watt-by-samuel-beckett", "title": "Watt", "rating": "4", "priority": "4"}])

    def test_a_filled_rating_is_not_listed(self):
        built = STEP.build_readings([sheet_row(title="Watt", author="Beckett, Samuel", priority=4, rating=4)], BOOKS)
        self.assertEqual(built["stats"]["priority_ratings"], [])


if __name__ == "__main__":
    unittest.main()
