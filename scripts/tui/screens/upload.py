"""Batch media upload screen."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import (
    Button,
    DirectoryTree,
    Footer,
    Header,
    Input,
    Label,
    Select,
)

from scripts.tui.api_client import DurtalClient
from scripts.tui.widgets.progress_panel import ProgressPanel

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"}


class UploadScreen(Screen):
    """Batch upload images to works or authors."""

    BINDINGS = [
        Binding("escape", "app.pop_screen", "Back"),
    ]

    def __init__(self, client: DurtalClient) -> None:
        super().__init__()
        self._client = client
        self._selected_files: list[Path] = []
        self._entity_type = "work"
        self._entity_id = ""
        self._media_type = "gallery"

    def compose(self) -> ComposeResult:
        yield Header()

        with Vertical():
            yield Label("[bold]Batch Media Upload[/bold]", classes="label-title")
            yield Label(
                "Select a directory, configure the target, and upload.",
                classes="label-subtitle",
            )

            with Horizontal(classes="row"):
                # Left: file browser
                with Vertical():
                    yield Label("[dim]Select directory with images:[/dim]")
                    yield DirectoryTree(".", id="dir-tree")

                # Right: config + progress
                with Vertical():
                    yield Label("[dim]Entity type:[/dim]")
                    yield Select(
                        [("Work", "work"), ("Author", "author")],
                        value="work",
                        id="entity-type",
                    )

                    yield Label("[dim]Entity ID (UUID):[/dim]")
                    yield Input(placeholder="Paste entity UUID...", id="entity-id")

                    yield Label("[dim]Media type:[/dim]")
                    yield Select(
                        [
                            ("Poster", "poster"),
                            ("Background", "background"),
                            ("Gallery", "gallery"),
                        ],
                        value="gallery",
                        id="media-type",
                    )

                    yield Label("", classes="spacer")

                    with Horizontal():
                        yield Button("Upload All", classes="primary", id="btn-upload")
                        yield Button("Clear", classes="secondary", id="btn-clear")

                    yield Label("", classes="spacer")
                    yield ProgressPanel(id="progress")

        yield Footer()

    def on_directory_tree_file_selected(
        self, event: DirectoryTree.FileSelected
    ) -> None:
        path = Path(str(event.path))
        if path.suffix.lower() in _IMAGE_EXTS and path not in self._selected_files:
            self._selected_files.append(path)

    def on_directory_tree_directory_selected(
        self, event: DirectoryTree.DirectorySelected
    ) -> None:
        dir_path = Path(str(event.path))
        for f in sorted(dir_path.iterdir()):
            if f.is_file() and f.suffix.lower() in _IMAGE_EXTS:
                if f not in self._selected_files:
                    self._selected_files.append(f)

    def on_select_changed(self, event: Select.Changed) -> None:
        if event.select.id == "entity-type":
            self._entity_type = str(event.value)
        elif event.select.id == "media-type":
            self._media_type = str(event.value)

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id == "entity-id":
            self._entity_id = event.value.strip()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-upload":
            self._start_upload()
        elif event.button.id == "btn-clear":
            self._selected_files.clear()
            panel = self.query_one("#progress", ProgressPanel)
            panel.clear_all()

    def _start_upload(self) -> None:
        if not self._entity_id or not self._selected_files:
            return
        self.run_worker(self._do_upload(), name="batch_upload", exclusive=True)

    async def _do_upload(self) -> None:
        panel = self.query_one("#progress", ProgressPanel)
        panel.clear_all()

        for i, filepath in enumerate(self._selected_files):
            fname = filepath.name
            panel.add_item(fname, fname)

            try:
                content_type = mimetypes.guess_type(fname)[0] or "image/jpeg"
                data = filepath.read_bytes()

                # 1. Presign
                panel.update_item(fname, 20, f"\u2192 {fname} (presigning)")
                presign = await self._client.presign_media(
                    self._entity_type, self._entity_id, fname, content_type
                )

                # 2. Upload to S3
                panel.update_item(fname, 50, f"\u2192 {fname} (uploading)")
                await self._client.upload_file_to_presigned(
                    presign["url"], data, content_type
                )

                # 3. Process
                panel.update_item(fname, 80, f"\u2192 {fname} (processing)")
                await self._client.process_media(
                    entity_type=self._entity_type,
                    entity_id=self._entity_id,
                    media_type=self._media_type,
                    file_id=presign["fileId"],
                    bronze_key=presign["bronzeKey"],
                    original_filename=fname,
                    mime_type=content_type,
                    size_bytes=len(data),
                )

                panel.update_item(fname, 100, f"\u2713 {fname}")
            except Exception as exc:
                panel.update_item(fname, 0, f"\u2717 {fname}: {exc}")

        self._selected_files.clear()
