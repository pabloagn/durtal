"""DataTable pre-configured for displaying works."""

from __future__ import annotations

from typing import Any

from textual.widgets import DataTable


class WorkTable(DataTable):
    """A DataTable for browsing works."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(
            cursor_type="row",
            zebra_stripes=True,
            **kwargs,
        )

    def on_mount(self) -> None:
        self.add_columns("Title", "Author", "Year", "Language", "Copies", "Rating")

    def load_works(self, works: list[dict[str, Any]]) -> None:
        """Clear and reload the table with work data."""
        self.clear()
        for w in works:
            authors = w.get("workAuthors", [])
            author_name = authors[0]["author"]["name"] if authors else "—"
            editions = w.get("editions", [])
            first_ed = editions[0] if editions else {}
            instance_count = sum(
                len(e.get("instances", [])) for e in editions
            )
            year = first_ed.get("publicationYear") or w.get("originalYear") or "—"
            language = first_ed.get("language", "—")
            rating = w.get("rating") or "—"

            self.add_row(
                w.get("title", "—"),
                author_name,
                str(year),
                str(language),
                str(instance_count),
                str(rating),
                key=w["id"],
            )
