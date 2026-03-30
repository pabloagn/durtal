"""CLI entrypoint for the Durtal enrichment pipeline.

Usage:
    uv run python -m scripts.enrich.main --all --dry-run
    uv run python -m scripts.enrich.main --all
    uv run python -m scripts.enrich.main --author "Marcel Proust"
    uv run python -m scripts.enrich.main --backfill-countries
"""

from __future__ import annotations

import click
from rich.console import Console

console = Console()


@click.command()
@click.option("--all", "run_all", is_flag=True, help="Enrich all authors missing birth/death places")
@click.option("--author", "author_name", default=None, help="Enrich a single author by name")
@click.option("--backfill-countries", is_flag=True, help="Backfill country centroid coordinates")
@click.option("--dry-run", is_flag=True, help="Preview without writing to database")
@click.option("--limit", type=int, default=None, help="Limit number of authors to process")
def main(
    run_all: bool,
    author_name: str | None,
    backfill_countries: bool,
    dry_run: bool,
    limit: int | None,
):
    """Durtal data enrichment pipeline."""

    if not run_all and not author_name and not backfill_countries:
        console.print("[red]Specify --all, --author <name>, or --backfill-countries[/red]")
        raise SystemExit(1)

    console.rule("[bold cyan]Durtal Enrichment Pipeline")
    if dry_run:
        console.print("[yellow]DRY RUN MODE — no data will be written[/yellow]\n")

    if backfill_countries:
        console.print("\n[bold]Backfilling country centroids...[/bold]")
        from scripts.enrich.country_centroids import run as run_centroids
        try:
            stats = run_centroids(dry_run=dry_run)
            console.print(f"  updated:    {stats['updated']}")
            console.print(f"  skipped:    {stats['skipped']} (already had coordinates)")
            console.print(f"  not found:  {stats['not_found']} (no centroid in dict)")
            console.print("[green]Country centroids complete.[/green]")
        except Exception as e:
            console.print(f"[red]Country centroid backfill failed: {e}[/red]")
            raise

    if run_all or author_name:
        console.print("\n[bold]Enriching author birth/death places...[/bold]")
        try:
            stats = _enrich_authors(
                author_name=author_name,
                dry_run=dry_run,
                limit=limit,
            )
            console.print(f"\n  enriched:        {stats['enriched']}")
            console.print(f"  places created:  {stats['places_created']}")
            console.print(f"  skipped:         {stats['skipped']} (already had places)")
            console.print(f"  no result:       {stats['no_result']} (not found in Wikidata)")
            console.print(f"  failed:          {stats['failed']}")
            console.print("[green]Author enrichment complete.[/green]")
        except Exception as e:
            console.print(f"[red]Author enrichment failed: {e}[/red]")
            raise

    console.rule("[bold green]Pipeline complete")


def _enrich_authors(
    *,
    author_name: str | None = None,
    dry_run: bool = False,
    limit: int | None = None,
) -> dict:
    """Core enrichment loop.

    For each author missing birth_place_id / death_place_id:
    1. Query Wikidata
    2. Resolve place (find or create)
    3. Update author row
    """
    from scripts.enrich.db import transaction, get_connection
    from scripts.enrich.wikidata import search_author
    from scripts.enrich.places_resolver import resolve_or_create_place

    stats = {
        "enriched": 0,
        "places_created": 0,
        "skipped": 0,
        "no_result": 0,
        "failed": 0,
    }

    # Fetch authors to process using a read connection
    conn = get_connection()
    try:
        import psycopg2.extras
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            if author_name:
                cur.execute(
                    """
                    SELECT id, name, birth_year
                    FROM authors
                    WHERE LOWER(name) = LOWER(%s)
                    ORDER BY name
                    """,
                    (author_name.strip(),),
                )
            else:
                limit_clause = f"LIMIT {limit}" if limit else ""
                cur.execute(
                    f"""
                    SELECT id, name, birth_year
                    FROM authors
                    WHERE birth_place_id IS NULL
                      AND death_place_id IS NULL
                    ORDER BY name
                    {limit_clause}
                    """
                )
            authors = cur.fetchall()
    finally:
        conn.close()

    total = len(authors)
    console.print(f"  Found {total} author(s) to process.\n")

    for idx, author_row in enumerate(authors, start=1):
        author_id = author_row["id"]
        name = author_row["name"]
        birth_year = author_row["birth_year"]

        console.print(f"  [{idx}/{total}] {name} ({birth_year or '?'})", end="  ")

        try:
            result = search_author(name, birth_year=birth_year)
        except Exception as exc:
            console.print(f"[red]ERROR: {exc}[/red]")
            stats["failed"] += 1
            continue

        if not result:
            console.print("[dim]not found in Wikidata[/dim]")
            stats["no_result"] += 1
            continue

        birth_place = result.birth_place
        death_place = result.death_place

        if not birth_place and not death_place:
            console.print("[dim]no place data[/dim]")
            stats["no_result"] += 1
            continue

        bp_label = birth_place.name if birth_place else None
        dp_label = death_place.name if death_place else None
        console.print(f"[cyan]birth={bp_label!r} death={dp_label!r}[/cyan]")

        if dry_run:
            stats["enriched"] += 1
            continue

        # Resolve or create places, then update author in a transaction
        try:
            with transaction() as cur:
                birth_place_id: str | None = None
                death_place_id: str | None = None

                places_before = _count_places(cur)

                if birth_place:
                    birth_place_id = resolve_or_create_place(cur, birth_place, dry_run=False)

                if death_place:
                    death_place_id = resolve_or_create_place(cur, death_place, dry_run=False)

                places_after = _count_places(cur)
                stats["places_created"] += places_after - places_before

                if birth_place_id or death_place_id:
                    cur.execute(
                        """
                        UPDATE authors
                        SET
                            birth_place_id = COALESCE(%s, birth_place_id),
                            death_place_id = COALESCE(%s, death_place_id),
                            updated_at     = NOW()
                        WHERE id = %s
                        """,
                        (birth_place_id, death_place_id, author_id),
                    )
                    stats["enriched"] += 1
                else:
                    stats["no_result"] += 1

        except Exception as exc:
            console.print(f"  [red]  -> DB error for {name!r}: {exc}[/red]")
            stats["failed"] += 1

    return stats


def _count_places(cur) -> int:
    """Return current count of rows in places table."""
    cur.execute("SELECT COUNT(*) FROM places")
    row = cur.fetchone()
    return row[0] if row else 0


if __name__ == "__main__":
    main()
