"""Step readings: the seed spreadsheet's reading history as a Durtal reading CSV (SLN-450).

Reads the Books sheet as seed_books.py does (the same COL indices; rows with
duplicated_entry "Y" skipped) and resolves each row's book read-only: by the
slug seed_books.py computes, then by the edition's Goodreads id, then by the
id in works.goodreads_url. It writes files, never data:

  readings.csv          the Durtal reading CSV (DURTAL_READING_COLUMNS), to
                        import through Reading > Import with its preview
  priority-ratings.csv  works whose Rating cell is empty and whose rating
                        equals their Priority: the seed's priorities stored
                        as ratings, for Joris to decide on

A `read` value whose meaning is unclear stops the step and lists it.

    uv run python -m scripts.ingest.main --step readings --out DIR
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import re
import unicodedata
from pathlib import Path

from scripts.ingest.seed_books import COL
from scripts.ingest.utils import clean, extract_goodreads_id, invert_author_name, slugify, split_authors

ROOT = Path(__file__).resolve().parents[2]
DURTAL_FORMAT = ROOT / "src/lib/reading/import/durtal-format.ts"

# The `read` cell: what each known value means. Anything else stops the step.
READ_VALUES = {
    "": None,
    "n": None,
    "no": None,
    "false": None,
    "0": None,
    "y": "finished",
    "yes": "finished",
    "true": "finished",
    "x": "finished",
    "1": "finished",
    "read": "finished",
    "done": "finished",
    "finished": "finished",
    "reading": "reading",
    "currently reading": "reading",
    "in progress": "reading",
    "paused": "paused",
    "dnf": "abandoned",
    "abandoned": "abandoned",
    "did not finish": "abandoned",
}


class UnclearValues(Exception):
    """Values the step cannot map without asking: it stops and lists them."""

    def __init__(self, values: dict[str, int]):
        self.values = values
        listed = ", ".join(f"{v!r} ({n} rows)" for v, n in sorted(values.items()))
        super().__init__(f"The read column holds values whose meaning is unclear: {listed}")


def durtal_columns() -> list[str]:
    """DURTAL_READING_COLUMNS, read from the TypeScript file: the one list."""
    source = DURTAL_FORMAT.read_text(encoding="utf-8")
    block = re.search(r"DURTAL_READING_COLUMNS\s*=\s*\[(.*?)\]\s*as const", source, re.S)
    if not block:
        raise RuntimeError(f"DURTAL_READING_COLUMNS not found in {DURTAL_FORMAT}")
    return re.findall(r'"([a-z0-9_]+)"', block.group(1))


def normalize_key_text(value: str | None) -> str:
    """normalizeKeyText of src/lib/reading/source-keys.ts: NFKD, marks dropped,
    lower case, every run of characters that are neither letters nor digits one space."""
    s = unicodedata.normalize("NFKD", value or "")
    s = "".join(c for c in s if not unicodedata.category(c).startswith("M")).lower()
    s = "".join(c if unicodedata.category(c)[0] in ("L", "N") else " " for c in s)
    return " ".join(s.split())


def key_hash(*parts: str | None) -> str:
    return hashlib.sha256("|".join(normalize_key_text(p) for p in parts).encode("utf-8")).hexdigest()


def seed_reading_key(title: str, first_author: str) -> str:
    """seedReadingKey of src/lib/reading/source-keys.ts"""
    return f"seed:{key_hash(title, first_author)}"


def map_read(value) -> str | None:
    """The reading status a `read` cell means: a date is a finished read."""
    if isinstance(value, (dt.date, dt.datetime)):
        return "finished"
    text = "" if value is None else str(value).strip()
    if isinstance(value, float) and value.is_integer():
        text = str(int(value))
    key = text.lower()
    if key in READ_VALUES:
        return READ_VALUES[key]
    if parse_date(value)[0]:
        return "finished"
    raise UnclearValues({text: 1})


def parse_date(value) -> tuple[str | None, str]:
    """A date cell as (YYYY-MM-DD, precision): an Excel date is a day, a year
    number a year, "YYYY-MM" a month. (None, "unknown") when empty or unreadable."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, "unknown"
    if isinstance(value, dt.datetime):
        return value.date().isoformat(), "day"
    if isinstance(value, dt.date):
        return value.isoformat(), "day"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if float(value).is_integer() and 1000 <= int(value) <= 2999:
            return f"{int(value):04d}-01-01", "year"
        return None, "unknown"
    s = str(value).strip()
    m = re.fullmatch(r"(\d{4})", s)
    if m:
        return f"{m.group(1)}-01-01", "year"
    m = re.fullmatch(r"(\d{4})[-/](\d{1,2})", s)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{m.group(1)}-{int(m.group(2)):02d}-01", "month"
    m = re.fullmatch(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?", s)
    if m:
        try:
            return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat(), "day"
        except ValueError:
            return None, "unknown"
    return None, "unknown"


def parse_rating(value) -> float | None:
    """The Rating cell: 0.5 to 5 in half steps; 0 or empty is none."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        r = float(str(value).strip())
    except ValueError:
        return None
    if r <= 0 or r > 5 or (r * 2) != int(r * 2):
        return None
    return r


def _cell(row, key: str):
    idx = COL[key]
    return row[idx] if idx < len(row) else None


def _number(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def build_readings(rows, books: dict) -> dict:
    """The reading CSV's rows and every count the step prints. `rows` are the
    sheet's data rows; `books` holds the read-only lookups (see load_books)."""
    columns = durtal_columns()
    out: list[dict] = []
    seen: dict[str, int] = {}
    stats = {
        "rows": 0,
        "skipped_dup": 0,
        "with_reading": 0,
        "written": 0,
        "by_slug": 0,
        "by_goodreads_id": 0,
        "by_goodreads_link": 0,
        "unresolved": 0,
        "duplicate_keys": [],
        "unparsed_dates": [],
        "unparsed_ratings": [],
        "read_values": {},
        "priority_ratings": [],
    }
    unclear: dict[str, int] = {}
    for line, row in enumerate(rows, start=2):
        stats["rows"] += 1
        if clean(_cell(row, "duplicated_entry")) == "Y":
            stats["skipped_dup"] += 1
            continue
        title = clean(_cell(row, "title"))
        if not title:
            continue
        raw_read = _cell(row, "read")
        shown = raw_read.isoformat() if isinstance(raw_read, (dt.date, dt.datetime)) else ("" if raw_read is None else str(raw_read).strip())
        label = "a date" if isinstance(raw_read, (dt.date, dt.datetime)) or (shown and parse_date(raw_read)[0] and shown.lower() not in READ_VALUES) else shown
        try:
            status = map_read(raw_read)
        except UnclearValues:
            unclear[shown] = unclear.get(shown, 0) + 1
            continue
        stats["read_values"].setdefault(label, {"status": status or "nothing", "rows": 0})["rows"] += 1

        author_raw = clean(_cell(row, "author"))
        authors = [invert_author_name(a) for a in split_authors(author_raw)] if author_raw else []
        first_sort = split_authors(author_raw)[0] if author_raw else None
        slug = slugify(f"{title}-by-{invert_author_name(first_sort) if first_sort else 'unknown'}") or slugify(title)
        goodreads_id = extract_goodreads_id(clean(_cell(row, "goodreads_url")) or clean(_cell(row, "goodreads_path")))
        work_id = edition_id = None
        how = None
        if slug in books["slugs"]:
            work_id, how = books["slugs"][slug], "by_slug"
        elif goodreads_id and goodreads_id in books["editions"]:
            edition_id, work_id = books["editions"][goodreads_id]
            how = "by_goodreads_id"
        elif goodreads_id and goodreads_id in books["links"]:
            work_id, how = books["links"][goodreads_id], "by_goodreads_link"

        # The seed's priorities stored as ratings: an empty Rating, and the book's rating equal to its Priority
        rating = parse_rating(_cell(row, "rating"))
        priority = _cell(row, "priority")
        if rating is None and work_id and priority not in (None, "") and work_id in books["ratings"]:
            current = books["ratings"][work_id]
            try:
                if current is not None and float(current) == float(priority):
                    stats["priority_ratings"].append(
                        {"work_id": work_id, "slug": books["work_slugs"].get(work_id, ""), "title": title, "rating": _number(float(current)), "priority": _number(float(priority))}
                    )
            except (TypeError, ValueError):
                pass
        if not status:
            continue
        stats["with_reading"] += 1
        stats[how or "unresolved"] += 1

        rating_cell = _cell(row, "rating")
        if rating is None and rating_cell not in (None, "") and str(rating_cell).strip() not in ("0", "0.0"):
            stats["unparsed_ratings"].append((line, str(rating_cell)[:40]))
        started, started_precision = parse_date(_cell(row, "started_date"))
        finished, finished_precision = parse_date(_cell(row, "finished_date"))
        for key, value, parsed in (("started_date", _cell(row, "started_date"), started), ("finished_date", _cell(row, "finished_date"), finished)):
            if value not in (None, "") and not parsed:
                stats["unparsed_dates"].append((line, key, str(value)[:40]))
        # A date in the read cell is the finish when the finish cell is empty
        if not finished and isinstance(raw_read, (dt.date, dt.datetime, str)) and parse_date(raw_read)[0] and shown.lower() not in READ_VALUES:
            finished, finished_precision = parse_date(raw_read)
        if status in ("reading", "paused"):
            finished, finished_precision = None, "unknown"
        key = seed_reading_key(title, authors[0] if authors else "")
        if key in seen:
            stats["duplicate_keys"].append((line, seen[key], title))
            continue
        seen[key] = line
        record = {c: "" for c in columns}
        record.update(
            {
                "work_id": work_id or "",
                "edition_id": edition_id or "",
                "title": title,
                "authors": "; ".join(authors),
                "status": status,
                "format": "print",
                "started_on": started or "",
                "started_precision": started_precision,
                "finished_on": finished or "",
                "finished_precision": finished_precision,
                "rating": _number(rating) if rating is not None and status == "finished" else "",
                "source_key": key,
            }
        )
        out.append(record)
        stats["written"] += 1
    if unclear:
        raise UnclearValues(unclear)
    return {"columns": columns, "rows": out, "stats": stats}


def write_files(out_dir: Path, built: dict) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    readings = out_dir / "readings.csv"
    with readings.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=built["columns"])
        writer.writeheader()
        writer.writerows(built["rows"])
    priority = out_dir / "priority-ratings.csv"
    with priority.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["work_id", "slug", "title", "rating", "priority"])
        writer.writeheader()
        writer.writerows(built["stats"]["priority_ratings"])
    return readings, priority


def load_books(cur) -> dict:
    """Every lookup in three queries: slugs, editions by Goodreads id, works by Goodreads link."""
    cur.execute("SELECT id::text, slug, rating FROM works WHERE kind = 'book'")
    slugs, ratings, work_slugs = {}, {}, {}
    for work_id, slug, rating in cur.fetchall():
        if slug:
            slugs[slug] = work_id
            work_slugs[work_id] = slug
        ratings[work_id] = rating
    cur.execute(
        "SELECT e.goodreads_id, e.id::text, e.work_id::text FROM editions e JOIN works w ON w.id = e.work_id AND w.kind = 'book' "
        "WHERE e.goodreads_id IS NOT NULL ORDER BY e.created_at"
    )
    editions: dict[str, tuple[str, str]] = {}
    for goodreads_id, edition_id, work_id in cur.fetchall():
        editions.setdefault(str(goodreads_id), (edition_id, work_id))
    cur.execute("SELECT substring(goodreads_url from '/book/show/(\\d+)'), id::text FROM works WHERE kind = 'book' AND goodreads_url ~ '/book/show/\\d+'")
    links = {}
    for goodreads_id, work_id in cur.fetchall():
        links.setdefault(goodreads_id, work_id)
    return {"slugs": slugs, "ratings": ratings, "work_slugs": work_slugs, "editions": editions, "links": links}


def run(out: str | Path) -> dict:
    """The step: read the sheet, resolve read-only, write the two files, print the counts."""
    import openpyxl
    import psycopg2
    from rich.console import Console

    from scripts.ingest.config import DATABASE_URL, EXCEL_PATH

    console = Console()
    wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)
    ws = wb["Books"]
    conn = psycopg2.connect(DATABASE_URL, options="-c default_transaction_read_only=on")
    try:
        with conn.cursor() as cur:
            books = load_books(cur)
        conn.rollback()
    finally:
        conn.close()
    try:
        built = build_readings(ws.iter_rows(min_row=2, values_only=True), books)
    except UnclearValues as err:
        console.print(f"[red]{err}[/red]")
        console.print("The step stopped: ask what these values mean before mapping them.")
        raise SystemExit(2) from None
    readings, priority = write_files(Path(out), built)
    s = built["stats"]
    console.print(f"Rows: {s['rows']} ({s['skipped_dup']} duplicated entries skipped)")
    console.print("The read column:")
    for value, info in sorted(s["read_values"].items(), key=lambda kv: -kv[1]["rows"]):
        console.print(f"  {value or '(empty)'!r}: {info['rows']} rows -> {info['status']}")
    console.print(
        f"Readings: {s['written']} written, {s['with_reading']} rows with a read; books by slug {s['by_slug']}, "
        f"by Goodreads id {s['by_goodreads_id']}, by Goodreads link {s['by_goodreads_link']}, not found {s['unresolved']}"
    )
    for line, first, title in s["duplicate_keys"]:
        console.print(f"  Row {line} gives the same key as row {first} ({title}): left out")
    for line, key, value in s["unparsed_dates"]:
        console.print(f"  Row {line}: {key} {value!r} is not a date this step reads")
    for line, value in s["unparsed_ratings"]:
        console.print(f"  Row {line}: rating {value!r} is not 0.5 to 5 in half steps")
    console.print(f"Priority ratings: {len(s['priority_ratings'])} (in {priority})")
    console.print(f"Reading CSV: {readings}")
    return s
