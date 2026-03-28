"""Browse screen — works DataTable with detail panel."""

from __future__ import annotations

from typing import Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import Footer, Header, Input, Label, Static

from scripts.tui.api_client import DurtalClient
from scripts.tui.widgets.work_table import WorkTable


class DetailPanel(Static):
    """Right-hand detail view for the selected work."""

    DEFAULT_CSS = """
    DetailPanel {
        width: 40%;
        background: #0a0d10;
        border: solid #1e2228;
        padding: 1 2;
    }
    """

    def update_work(self, work: dict[str, Any]) -> None:
        authors = work.get("workAuthors", [])
        author_names = ", ".join(a["author"]["name"] for a in authors) or "\u2014"
        editions = work.get("editions", [])
        subjects = work.get("workSubjects", [])
        subject_names = ", ".join(s["subject"]["name"] for s in subjects) or "\u2014"
        media = work.get("media", [])

        lines = [
            f"[bold]{work.get('title', '\u2014')}[/bold]",
            f"[dim]by[/dim] {author_names}",
            "",
            f"[dim]Year:[/dim] {work.get('originalYear', '\u2014')}",
            f"[dim]Language:[/dim] {work.get('originalLanguage', '\u2014')}",
            f"[dim]Status:[/dim] {work.get('catalogueStatus', '\u2014')}",
            f"[dim]Rating:[/dim] {work.get('rating') or '\u2014'}/5",
            "",
            f"[dim]Editions:[/dim] {len(editions)}",
            f"[dim]Subjects:[/dim] {subject_names}",
            f"[dim]Media:[/dim] {len(media)} files",
        ]

        if work.get("description"):
            desc = work["description"][:200]
            if len(work["description"]) > 200:
                desc += "\u2026"
            lines += ["", f"[dim]{desc}[/dim]"]

        self.update("\n".join(lines))


class BrowseScreen(Screen):
    """Browse and search works."""

    BINDINGS = [
        Binding("escape", "app.pop_screen", "Back"),
        Binding("r", "refresh", "Refresh", show=True),
        Binding("/", "focus_search", "Search", show=True),
    ]

    def __init__(self, client: DurtalClient) -> None:
        super().__init__()
        self._client = client

    def compose(self) -> ComposeResult:
        yield Header()

        with Vertical():
            yield Label(
                "[bold]Browse Library[/bold]",
                classes="label-title",
            )
            yield Input(placeholder="Search works...", id="search-input")
            yield Label("", classes="spacer")

            with Horizontal():
                yield WorkTable(id="browse-table")
                yield DetailPanel(id="detail-panel")

        yield Footer()

    def on_mount(self) -> None:
        self._load_works()

    def action_refresh(self) -> None:
        self._load_works()

    def action_focus_search(self) -> None:
        self.query_one("#search-input", Input).focus()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self._load_works(search=event.value or None)

    def _load_works(self, search: str | None = None) -> None:
        self.run_worker(
            self._fetch_works(search), name="fetch_works", exclusive=True
        )

    async def _fetch_works(self, search: str | None = None) -> dict[str, Any]:
        return await self._client.get_works(search=search, limit=100)

    def on_worker_state_changed(self, event) -> None:
        if event.worker.name == "fetch_works" and event.worker.is_finished:
            if event.worker.result is None:
                return
            data = event.worker.result
            table = self.query_one("#browse-table", WorkTable)
            table.load_works(data.get("works", []))
            self._works_by_id = {w["id"]: w for w in data.get("works", [])}

        if event.worker.name == "fetch_detail" and event.worker.is_finished:
            if event.worker.result is None:
                return
            panel = self.query_one("#detail-panel", DetailPanel)
            panel.update_work(event.worker.result)

    def on_data_table_row_selected(self, event: WorkTable.RowSelected) -> None:
        work_id = str(event.row_key.value)
        self.run_worker(
            self._client.get_work(work_id), name="fetch_detail", exclusive=True
        )
