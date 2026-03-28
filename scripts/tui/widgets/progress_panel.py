"""Progress tracking panel for batch uploads."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Label, ProgressBar, Static


class ProgressPanel(Static):
    """Tracks upload progress for multiple files."""

    DEFAULT_CSS = """
    ProgressPanel {
        height: auto;
        background: #0a0d10;
        border: solid #1e2228;
        padding: 1 2;
    }
    """

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._items: dict[str, tuple[Label, ProgressBar]] = {}

    def compose(self) -> ComposeResult:
        yield Label("[bold]Upload Progress[/bold]", classes="label-title")
        yield Vertical(id="progress-items")

    def add_item(self, key: str, filename: str) -> None:
        container = self.query_one("#progress-items", Vertical)
        label = Label(f"  {filename}")
        bar = ProgressBar(total=100, show_percentage=True)
        self._items[key] = (label, bar)
        container.mount(label)
        container.mount(bar)

    def update_item(self, key: str, progress: float, status: str = "") -> None:
        if key not in self._items:
            return
        label, bar = self._items[key]
        bar.update(progress=progress)
        if status:
            label.update(f"  {status}")

    def clear_all(self) -> None:
        container = self.query_one("#progress-items", Vertical)
        container.remove_children()
        self._items.clear()
