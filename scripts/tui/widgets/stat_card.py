"""Simple stat card widget for the dashboard."""

from __future__ import annotations

from textual.widgets import Static


class StatCard(Static):
    """Displays a single statistic with label and value."""

    def __init__(
        self,
        label: str,
        value: str | int = "—",
        *,
        id: str | None = None,
    ) -> None:
        super().__init__(id=id)
        self._label = label
        self._value = str(value)

    def render(self) -> str:
        return f"[bold]{self._value}[/bold]\n[dim]{self._label}[/dim]"

    def update_value(self, value: str | int) -> None:
        self._value = str(value)
        self.refresh()
