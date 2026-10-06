"""The TUI dashboard's Reading panel text (SLN-458); no textual, httpx or network."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


def load_panel():
    # The panel imports no third-party module; textual and httpx are stubbed
    # anyway, so a stray import shows up as an AttributeError here, not a crash in CI
    stubs = {name: types.ModuleType(name) for name in ("textual", "httpx")}
    spec = importlib.util.spec_from_file_location("reading_panel", Path(__file__).parents[1] / "tui/reading_panel.py")
    panel = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, stubs):
        spec.loader.exec_module(panel)
    return panel


def stats(**reading):
    base = {"open": [], "year": 2026, "finishedThisYear": 0, "pagesThisYear": 0, "hoursThisYear": 0, "goals": []}
    return {"works": 700, "reading": {**base, **reading}}


class ReadingPanel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.panel = load_panel()

    def lines(self, value):
        return self.panel.reading_panel_lines(value)

    def test_an_older_server_without_the_field(self):
        self.assertEqual(self.lines({"works": 700}), ["Reading needs a newer Durtal server"])
        self.assertEqual(self.lines(None), ["Reading needs a newer Durtal server"])

    def test_no_open_readings_and_no_goal(self):
        self.assertEqual(
            self.lines(stats(finishedThisYear=12, pagesThisYear=3456, hoursThisYear=85.5)),
            ["Not reading anything right now", "2026: 12 books finished, 3,456 pages, 85.5 hours"],
        )

    def test_open_readings_with_a_percent_and_with_none(self):
        lines = self.lines(
            stats(
                open=[
                    {"title": "The Recognitions", "status": "reading", "percent": 44.5},
                    {"title": "Nadja", "status": "paused", "percent": None},
                    {"title": "Watt", "status": "reading", "percent": None},
                ],
                finishedThisYear=1,
                pagesThisYear=1,
                hoursThisYear=1,
            )
        )
        self.assertEqual(
            lines,
            [
                "Reading now:",
                "  The Recognitions (44.5%)",
                "  Nadja (paused)",
                "  Watt",
                "2026: 1 book finished, 1 page, 1 hour",
            ],
        )

    def test_one_goal_and_two_goals(self):
        one = self.lines(stats(goals=[{"metric": "books", "target": 30, "progress": 12}]))
        self.assertEqual(one[-1], "Goal: 12 of 30 books")
        two = self.lines(
            stats(goals=[{"metric": "books", "target": 30, "progress": 12}, {"metric": "hours", "target": 100, "progress": 85.5}])
        )
        self.assertEqual(two[-2:], ["Goal: 12 of 30 books", "Goal: 85.5 of 100 hours"])

    def test_hours_formatting(self):
        self.assertEqual(self.panel.hours_text(0), "0 hours")
        self.assertEqual(self.panel.hours_text(1), "1 hour")
        self.assertEqual(self.panel.hours_text(2.0), "2 hours")
        self.assertEqual(self.panel.hours_text(85.5), "85.5 hours")
        self.assertEqual(self.panel.hours_text(1234.4), "1,234.4 hours")


if __name__ == "__main__":
    unittest.main()
