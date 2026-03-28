"""Dashboard screen — stats overview and recent works."""

from __future__ import annotations

from typing import Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import Footer, Header, Label

from scripts.tui.api_client import DurtalClient
from scripts.tui.widgets.stat_card import StatCard
from scripts.tui.widgets.work_table import WorkTable


class DashboardScreen(Screen):
    """Library overview with stats and recent additions."""

    BINDINGS = [
        Binding("r", "refresh", "Refresh", show=True),
    ]

    def __init__(self, client: DurtalClient) -> None:
        super().__init__()
        self._client = client

    def compose(self) -> ComposeResult:
        yield Header()

        with Vertical():
            yield Label(
                "[bold]D U R T A L[/bold]  \u2014  Library Dashboard",
                classes="label-title",
            )
            yield Label("", classes="spacer")

            # Stats row
            with Horizontal(classes="row"):
                yield StatCard("Works", id="stat-works")
                yield StatCard("Editions", id="stat-editions")
                yield StatCard("Instances", id="stat-instances")
                yield StatCard("Authors", id="stat-authors")

            yield Label("", classes="spacer")
            yield Label("[bold]Recent Additions[/bold]", classes="label-subtitle")
            yield WorkTable(id="recent-table")

        yield Footer()

    def on_mount(self) -> None:
        self._load_stats()

    def action_refresh(self) -> None:
        self._load_stats()

    def _load_stats(self) -> None:
        self.run_worker(self._fetch_stats(), name="fetch_stats", exclusive=True)

    async def _fetch_stats(self) -> dict[str, Any]:
        return await self._client.get_stats()

    def on_worker_state_changed(self, event) -> None:
        if event.worker.name == "fetch_stats" and event.worker.is_finished:
            if event.worker.result is None:
                return
            stats = event.worker.result
            self.query_one("#stat-works", StatCard).update_value(stats.get("works", 0))
            self.query_one("#stat-editions", StatCard).update_value(
                stats.get("editions", 0)
            )
            self.query_one("#stat-instances", StatCard).update_value(
                stats.get("instances", 0)
            )
            self.query_one("#stat-authors", StatCard).update_value(
                stats.get("authors", 0)
            )
            table = self.query_one("#recent-table", WorkTable)
            table.load_works(stats.get("recentWorks", []))
