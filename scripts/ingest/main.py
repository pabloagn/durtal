"""CLI entrypoint for the Durtal ingestion pipeline.

Usage:
    uv run python -m scripts.ingest.main --all
    uv run python -m scripts.ingest.main --all --dry-run
    uv run python -m scripts.ingest.main --step reference
    uv run python -m scripts.ingest.main --step books --priority 5,4,3 --limit 20
"""

import click
from rich.console import Console

console = Console()

STEPS = {
    "reference": "scripts.ingest.seed_reference",
    "taxonomy": "scripts.ingest.seed_taxonomy",
    "publishers": "scripts.ingest.seed_publishers",
    "authors": "scripts.ingest.seed_authors",
    "books": "scripts.ingest.seed_books",
    "series": "scripts.ingest.seed_series",
}

STEP_ORDER = ["reference", "taxonomy", "publishers", "authors", "books", "series"]


@click.command()
@click.option("--all", "run_all", is_flag=True, help="Run all steps in order")
@click.option("--step", type=click.Choice(STEP_ORDER), help="Run a single step")
@click.option("--dry-run", is_flag=True, help="Preview without writing to database")
@click.option("--priority", default="5,4,3", help="Comma-separated priority values for books filter")
@click.option("--limit", type=int, default=None, help="Limit number of rows processed per step")
def main(run_all: bool, step: str | None, dry_run: bool, priority: str, limit: int | None):
    """Durtal seed data ingestion pipeline."""
    priorities = {int(x.strip()) for x in priority.split(",")}

    if not run_all and not step:
        console.print("[red]Specify --all or --step <name>[/red]")
        raise SystemExit(1)

    console.rule("[bold cyan]Durtal Ingestion Pipeline")
    if dry_run:
        console.print("[yellow]DRY RUN MODE[/yellow]\n")

    steps_to_run = STEP_ORDER if run_all else [step]

    for step_name in steps_to_run:
        console.print(f"\n[bold]Running step: {step_name}[/bold]")
        try:
            if step_name == "reference":
                from scripts.ingest.seed_reference import run as run_reference
                run_reference(dry_run=dry_run)
            elif step_name == "taxonomy":
                from scripts.ingest.seed_taxonomy import run as run_taxonomy
                run_taxonomy(dry_run=dry_run)
            elif step_name == "publishers":
                from scripts.ingest.seed_publishers import run as run_publishers
                run_publishers(dry_run=dry_run)
            elif step_name == "authors":
                from scripts.ingest.seed_authors import run as run_authors
                run_authors(dry_run=dry_run, limit=limit)
            elif step_name == "books":
                from scripts.ingest.seed_books import run as run_books
                run_books(dry_run=dry_run, priorities=priorities, limit=limit)
            elif step_name == "series":
                from scripts.ingest.seed_series import run as run_series
                run_series(dry_run=dry_run)

        except Exception as e:
            console.print(f"[red]Step '{step_name}' failed: {e}[/red]")
            raise

    console.rule("[bold green]Pipeline complete")


if __name__ == "__main__":
    main()
