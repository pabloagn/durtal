"""Calibre Library Sync — reads Calibre metadata.db, uploads files to S3,
and upserts metadata into Durtal (Neon Postgres).

Run this on the machine that has the Calibre library on its filesystem.

Usage:
    uv run python -m scripts.calibre_sync.main
    uv run python -m scripts.calibre_sync.main --dry-run
    uv run python -m scripts.calibre_sync.main --calibre-path /path/to/library

Required environment variables:
    DATABASE_URL          Neon Postgres connection string
    AWS_ACCESS_KEY_ID     AWS credentials for S3
    AWS_SECRET_ACCESS_KEY
    AWS_REGION            (default: eu-central-1)
    S3_BUCKET             (default: durtal)
    CALIBRE_LIBRARY_PATH  (default: /mnt/data/Books-Library)
"""

import os
import sqlite3
import json
import mimetypes
from pathlib import Path

import boto3
import click
import psycopg2
import psycopg2.extras
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn
from rich.table import Table

console = Console()

# ── Config ───────────────────────────────────────────────────────────────────

DEFAULT_CALIBRE_PATH = os.environ.get(
    "CALIBRE_LIBRARY_PATH", "/mnt/data/Books-Library"
)
DATABASE_URL = os.environ.get("DATABASE_URL", "")
S3_BUCKET = os.environ.get("S3_BUCKET", "durtal")
AWS_REGION = os.environ.get("AWS_REGION", "eu-central-1")

CONTENT_TYPES = {
    "epub": "application/epub+zip",
    "pdf": "application/pdf",
    "mobi": "application/x-mobipocket-ebook",
    "azw3": "application/x-mobi8-ebook",
    "cbz": "application/x-cbz",
    "txt": "text/plain",
}


def s3_book_key(calibre_id: int, filename: str, fmt: str) -> str:
    """S3 key for an ebook file: gold/calibre/{id}/{filename}.{format}"""
    return f"gold/calibre/{calibre_id}/{filename}.{fmt}"


def s3_cover_key(calibre_id: int) -> str:
    """S3 key for a cover image: gold/calibre/{id}/cover.jpg"""
    return f"gold/calibre/{calibre_id}/cover.jpg"


# ── Calibre DB ───────────────────────────────────────────────────────────────


def get_calibre_db(library_path: str) -> sqlite3.Connection:
    """Open Calibre's metadata.db in read-only mode."""
    db_path = Path(library_path) / "metadata.db"
    if not db_path.exists():
        raise FileNotFoundError(f"Calibre database not found at {db_path}")
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def fetch_calibre_books(calibre_conn: sqlite3.Connection) -> list[dict]:
    """Extract all books with their formats and identifiers from Calibre."""
    cur = calibre_conn.cursor()

    cur.execute("""
        SELECT
            b.id, b.title, b.sort, b.author_sort, b.path,
            b.has_cover, b.uuid, b.pubdate
        FROM books b
        ORDER BY b.sort
    """)
    books_raw = cur.fetchall()

    cur.execute("SELECT book, format, name, uncompressed_size FROM data")
    formats_raw = cur.fetchall()
    formats_by_book: dict[int, list[dict]] = {}
    for row in formats_raw:
        book_id = row["book"]
        if book_id not in formats_by_book:
            formats_by_book[book_id] = []
        formats_by_book[book_id].append({
            "format": row["format"].lower(),
            "fileName": row["name"],
            "sizeBytes": row["uncompressed_size"],
        })

    cur.execute("SELECT book, val FROM identifiers WHERE type = 'isbn'")
    isbns_raw = cur.fetchall()
    isbn_by_book: dict[int, str] = {}
    for row in isbns_raw:
        isbn_by_book[row["book"]] = row["val"]

    books = []
    for row in books_raw:
        book_id = row["id"]
        formats = formats_by_book.get(book_id, [])
        if not formats:
            continue

        books.append({
            "calibre_id": book_id,
            "calibre_uuid": row["uuid"],
            "title": row["title"],
            "author_sort": row["author_sort"],
            "path": row["path"],
            "has_cover": bool(row["has_cover"]),
            "isbn": isbn_by_book.get(book_id),
            "formats": formats,  # Keep as list, not JSON string yet
            "pubdate": row["pubdate"],
        })

    return books


# ── S3 Upload ────────────────────────────────────────────────────────────────


def get_s3_client():
    """Create a boto3 S3 client."""
    return boto3.client(
        "s3",
        region_name=AWS_REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def s3_key_exists(s3_client, key: str) -> bool:
    """Check if an S3 object already exists."""
    try:
        s3_client.head_object(Bucket=S3_BUCKET, Key=key)
        return True
    except s3_client.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            return False
        raise


def upload_book_files(
    s3_client,
    library_path: str,
    books: list[dict],
    dry_run: bool,
    force: bool = False,
) -> tuple[int, int]:
    """Upload ebook files and covers to S3.

    Returns (files_uploaded, files_skipped) counts.
    Mutates each book's formats list to include s3Key.
    Sets cover_s3_key on each book dict.
    """
    uploaded = 0
    skipped = 0
    errors = 0

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("{task.completed}/{task.total}"),
        console=console,
    ) as progress:
        task = progress.add_task("Uploading to S3...", total=len(books))

        for book in books:
            calibre_id = book["calibre_id"]
            book_dir = Path(library_path) / book["path"]

            # Upload each format
            for fmt_entry in book["formats"]:
                fmt = fmt_entry["format"]
                file_name = fmt_entry["fileName"]
                key = s3_book_key(calibre_id, file_name, fmt)

                local_path = book_dir / f"{file_name}.{fmt}"
                if not local_path.exists():
                    # No local file — don't set s3Key
                    continue

                # Set s3Key only if file exists locally
                fmt_entry["s3Key"] = key

                if dry_run:
                    uploaded += 1
                    continue

                if not force and s3_key_exists(s3_client, key):
                    skipped += 1
                else:
                    try:
                        content_type = CONTENT_TYPES.get(
                            fmt, mimetypes.guess_type(str(local_path))[0] or "application/octet-stream"
                        )
                        s3_client.upload_file(
                            str(local_path),
                            S3_BUCKET,
                            key,
                            ExtraArgs={"ContentType": content_type},
                        )
                        uploaded += 1
                    except Exception as e:
                        console.print(f"[red]  Failed to upload {key}: {e}[/red]")
                        fmt_entry.pop("s3Key", None)
                        errors += 1

            # Upload cover
            cover_key = s3_cover_key(calibre_id)
            if book["has_cover"]:
                cover_path = book_dir / "cover.jpg"

                if cover_path.exists():
                    book["cover_s3_key"] = cover_key

                    if dry_run:
                        uploaded += 1
                    elif not force and s3_key_exists(s3_client, cover_key):
                        skipped += 1
                    else:
                        try:
                            s3_client.upload_file(
                                str(cover_path),
                                S3_BUCKET,
                                cover_key,
                                ExtraArgs={"ContentType": "image/jpeg"},
                            )
                            uploaded += 1
                        except Exception as e:
                            console.print(f"[red]  Failed to upload cover for {calibre_id}: {e}[/red]")
                            book["cover_s3_key"] = None
                            errors += 1
                else:
                    book["cover_s3_key"] = None
            else:
                book["cover_s3_key"] = None

            progress.advance(task)

    if errors:
        console.print(f"[yellow]{errors} upload(s) failed — see errors above[/yellow]")

    return uploaded, skipped


# ── Matching ─────────────────────────────────────────────────────────────────


def match_to_durtal_works(pg_cur, books: list[dict]) -> dict[int, str]:
    """Match Calibre books to Durtal works via ISBN.

    Returns {calibre_id: work_id}.
    """
    matches: dict[int, str] = {}

    isbn_to_calibre_id: dict[str, int] = {}
    for book in books:
        isbn = book.get("isbn")
        if isbn:
            normalized = isbn.replace("-", "").replace(" ", "")
            isbn_to_calibre_id[normalized] = book["calibre_id"]

    if not isbn_to_calibre_id:
        return matches

    isbn_list = list(isbn_to_calibre_id.keys())
    pg_cur.execute("""
        SELECT isbn_13, isbn_10, work_id
        FROM editions
        WHERE isbn_13 = ANY(%s) OR isbn_10 = ANY(%s)
    """, (isbn_list, isbn_list))

    for row in pg_cur.fetchall():
        isbn13 = (row["isbn_13"] or "").replace("-", "").replace(" ", "")
        isbn10 = (row["isbn_10"] or "").replace("-", "").replace(" ", "")
        work_id = row["work_id"]

        if isbn13 in isbn_to_calibre_id:
            matches[isbn_to_calibre_id[isbn13]] = work_id
        elif isbn10 in isbn_to_calibre_id:
            matches[isbn_to_calibre_id[isbn10]] = work_id

    return matches


# ── Upsert ───────────────────────────────────────────────────────────────────


def upsert_calibre_books(
    pg_cur, books: list[dict], matches: dict[int, str], dry_run: bool
) -> tuple[int, int, int]:
    """Upsert Calibre books into the calibre_books table.

    Returns (inserted, updated, matched) counts.
    """
    inserted = 0
    updated = 0
    matched = 0

    for book in books:
        calibre_id = book["calibre_id"]
        work_id = matches.get(calibre_id)

        if work_id:
            matched += 1

        # Serialize formats (now includes s3Key)
        formats_json = json.dumps(book["formats"])

        if dry_run:
            pg_cur.execute(
                "SELECT id FROM calibre_books WHERE calibre_id = %s",
                (calibre_id,),
            )
            if pg_cur.fetchone():
                updated += 1
            else:
                inserted += 1
            continue

        pg_cur.execute(
            """
            INSERT INTO calibre_books (
                calibre_id, calibre_uuid, title, author_sort, path,
                has_cover, cover_s3_key, isbn, formats, pubdate,
                work_id, last_synced
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (calibre_id) DO UPDATE SET
                calibre_uuid = EXCLUDED.calibre_uuid,
                title = EXCLUDED.title,
                author_sort = EXCLUDED.author_sort,
                path = EXCLUDED.path,
                has_cover = EXCLUDED.has_cover,
                cover_s3_key = EXCLUDED.cover_s3_key,
                isbn = EXCLUDED.isbn,
                formats = EXCLUDED.formats,
                pubdate = EXCLUDED.pubdate,
                work_id = COALESCE(EXCLUDED.work_id, calibre_books.work_id),
                last_synced = NOW()
            RETURNING (xmax = 0) AS is_insert
            """,
            (
                calibre_id,
                book["calibre_uuid"],
                book["title"],
                book["author_sort"],
                book["path"],
                book["has_cover"],
                book.get("cover_s3_key"),
                book["isbn"],
                formats_json,
                book["pubdate"],
                work_id,
            ),
        )
        row = pg_cur.fetchone()
        if row and row["is_insert"]:
            inserted += 1
        else:
            updated += 1

    return inserted, updated, matched


# ── CLI ──────────────────────────────────────────────────────────────────────


@click.command()
@click.option(
    "--calibre-path",
    default=DEFAULT_CALIBRE_PATH,
    show_default=True,
    help="Path to Calibre library directory",
)
@click.option("--dry-run", is_flag=True, help="Preview without writing to database or S3")
@click.option("--force", is_flag=True, help="Re-upload files even if they already exist in S3")
@click.option("--skip-upload", is_flag=True, help="Skip S3 upload (metadata-only sync)")
def main(calibre_path: str, dry_run: bool, force: bool, skip_upload: bool):
    """Sync Calibre library into Durtal: metadata to Neon, files to S3."""
    if not DATABASE_URL:
        console.print("[red]DATABASE_URL environment variable is not set[/red]")
        raise SystemExit(1)

    console.rule("[bold cyan]Calibre Library Sync")
    if dry_run:
        console.print("[yellow]DRY RUN MODE — no writes to database or S3[/yellow]\n")

    # Phase 1: Read from Calibre
    console.print(f"Reading Calibre library at [bold]{calibre_path}[/bold]...")
    calibre_conn = get_calibre_db(calibre_path)
    books = fetch_calibre_books(calibre_conn)
    calibre_conn.close()
    console.print(f"Found [bold]{len(books)}[/bold] books with files\n")

    if not books:
        console.print("[yellow]No books found. Nothing to sync.[/yellow]")
        return

    # Show sample
    table = Table(title="Sample books", show_lines=False)
    table.add_column("ID", style="dim")
    table.add_column("Title")
    table.add_column("Author")
    table.add_column("Formats")
    table.add_column("ISBN", style="dim")
    for book in books[:10]:
        fmt_str = ", ".join(f["format"] for f in book["formats"])
        table.add_row(
            str(book["calibre_id"]),
            book["title"][:50],
            (book["author_sort"] or "")[:30],
            fmt_str,
            book["isbn"] or "-",
        )
    if len(books) > 10:
        table.add_row("...", f"({len(books) - 10} more)", "", "", "")
    console.print(table)
    console.print()

    # Phase 2: Upload to S3
    files_uploaded = 0
    files_skipped = 0
    if not skip_upload:
        console.print(f"Uploading files to S3 bucket [bold]{S3_BUCKET}[/bold]...")
        s3_client = get_s3_client()
        files_uploaded, files_skipped = upload_book_files(
            s3_client, calibre_path, books, dry_run, force
        )
        console.print(
            f"S3: [bold]{files_uploaded}[/bold] uploaded, "
            f"[dim]{files_skipped}[/dim] already exist\n"
        )
    else:
        console.print("[dim]Skipping S3 upload (--skip-upload)[/dim]\n")
        # Still populate s3Key fields for metadata
        for book in books:
            for fmt_entry in book["formats"]:
                fmt_entry["s3Key"] = s3_book_key(
                    book["calibre_id"], fmt_entry["fileName"], fmt_entry["format"]
                )
            if book["has_cover"]:
                book["cover_s3_key"] = s3_cover_key(book["calibre_id"])
            else:
                book["cover_s3_key"] = None

    # Phase 3: Match to Durtal works
    console.print("Matching against Durtal editions (by ISBN)...")
    pg_conn = psycopg2.connect(DATABASE_URL)
    try:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            matches = match_to_durtal_works(cur, books)
            console.print(
                f"Matched [bold]{len(matches)}[/bold] / {len(books)} books to Durtal works\n"
            )

            # Phase 4: Upsert metadata
            console.print("Upserting into calibre_books table...")
            inserted, updated, matched = upsert_calibre_books(
                cur, books, matches, dry_run
            )

            if not dry_run:
                pg_conn.commit()

    finally:
        pg_conn.close()

    # Summary
    console.print()
    summary = Table(title="Sync Summary", show_lines=False)
    summary.add_column("Metric")
    summary.add_column("Count", justify="right")
    summary.add_row("Total Calibre books", str(len(books)))
    summary.add_row("Files uploaded to S3", str(files_uploaded))
    summary.add_row("Files already in S3", str(files_skipped))
    summary.add_row("DB rows inserted", str(inserted))
    summary.add_row("DB rows updated", str(updated))
    summary.add_row("Matched to Durtal works", str(matched))
    console.print(summary)

    console.rule("[bold green]Sync complete")


if __name__ == "__main__":
    main()
