"""The dashboard's Reading panel text (SLN-458). Pure: no textual, no httpx.

`stats` is the JSON of GET /api/stats. Its `reading` field holds the open
readings, the year's numbers and the year's goals. An older server has no
such field, and the panel says so instead of failing.
"""

from __future__ import annotations

from typing import Any

UNITS = {"books": ("book", "books"), "pages": ("page", "pages"), "hours": ("hour", "hours")}


def _number(value: float) -> str:
    """1234 -> "1,234"; 12.5 -> "12.5"; 12.0 -> "12"."""
    if float(value).is_integer():
        return f"{int(value):,}"
    return f"{value:,.1f}"


def _amount(value: float, metric: str) -> str:
    one, many = UNITS.get(metric, (metric, metric))
    return f"{_number(value)} {one if value == 1 else many}"


def hours_text(hours: float) -> str:
    """0 -> "0 hours"; 1 -> "1 hour"; 85.5 -> "85.5 hours"."""
    return _amount(hours, "hours")


def _open_line(reading: dict[str, Any]) -> str:
    title = reading.get("title") or "Untitled"
    parts = []
    percent = reading.get("percent")
    if percent is not None:
        parts.append(f"{_number(round(float(percent), 1))}%")
    if reading.get("status") == "paused":
        parts.append("paused")
    return f"{title} ({', '.join(parts)})" if parts else title


def reading_panel_lines(stats: dict[str, Any] | None) -> list[str]:
    """The panel's lines: what is open, the year's numbers, then each goal."""
    reading = (stats or {}).get("reading")
    if not isinstance(reading, dict):
        return ["Reading needs a newer Durtal server"]
    lines: list[str] = []
    open_readings = reading.get("open") or []
    if open_readings:
        lines.append("Reading now:")
        lines.extend(f"  {_open_line(r)}" for r in open_readings)
    else:
        lines.append("Not reading anything right now")
    year = reading.get("year")
    numbers = [
        _amount(reading.get("finishedThisYear") or 0, "books") + " finished",
        _amount(reading.get("pagesThisYear") or 0, "pages"),
        hours_text(reading.get("hoursThisYear") or 0),
    ]
    lines.append(f"{year if year else 'This year'}: " + ", ".join(numbers))
    for goal in reading.get("goals") or []:
        metric = goal.get("metric", "books")
        lines.append(f"Goal: {_number(goal.get('progress') or 0)} of {_amount(goal.get('target') or 0, metric)}")
    return lines
