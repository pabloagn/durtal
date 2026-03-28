"""Durtal TUI — Terminal interface for library management."""

from __future__ import annotations

from pathlib import Path

from textual.app import App
from textual.binding import Binding

from scripts.tui.api_client import DurtalClient
from scripts.tui.screens.browse import BrowseScreen
from scripts.tui.screens.dashboard import DashboardScreen
from scripts.tui.screens.upload import UploadScreen

_STYLES_DIR = Path(__file__).parent / "styles"


class DurtalApp(App):
    """Durtal TUI — browse, upload, and manage your book catalogue."""

    TITLE = "D U R T A L"
    SUB_TITLE = "Library Management TUI"
    CSS_PATH = str(_STYLES_DIR / "durtal.tcss")
    ENABLE_COMMAND_PALETTE = False

    BINDINGS = [
        Binding("q", "quit", "Quit", show=True, priority=True),
        Binding("d", "go('dashboard')", "Dashboard", show=True),
        Binding("b", "go('browse')", "Browse", show=True),
        Binding("u", "go('upload')", "Upload", show=True),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._client = DurtalClient()

    def on_mount(self) -> None:
        self.push_screen(DashboardScreen(self._client))

    def action_go(self, screen_name: str) -> None:
        """Navigate to a named screen, resetting the stack."""
        # Pop everything above the default screen
        while len(self.screen_stack) > 1:
            self.pop_screen()

        screens = {
            "dashboard": lambda: DashboardScreen(self._client),
            "browse": lambda: BrowseScreen(self._client),
            "upload": lambda: UploadScreen(self._client),
        }

        factory = screens.get(screen_name)
        if factory:
            self.push_screen(factory())

    async def action_quit(self) -> None:
        await self._client.close()
        self.exit()


def main() -> None:
    """Launch the Durtal TUI."""
    app = DurtalApp()
    app.run()


if __name__ == "__main__":
    main()
