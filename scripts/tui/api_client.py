"""Async HTTP client for the Durtal REST API."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

# Load .env.local from project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(_PROJECT_ROOT / ".env.local")

_BASE_URL = os.environ.get("DURTAL_API_URL", "http://localhost:3003")


class DurtalClient:
    """Thin async wrapper around the Durtal Next.js API."""

    def __init__(self, base_url: str = _BASE_URL) -> None:
        self._base_url = base_url.rstrip("/")
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=30.0,
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ── Health ───────────────────────────────────────────────────────────

    async def health(self) -> dict[str, Any]:
        c = await self._get_client()
        r = await c.get("/api/health")
        r.raise_for_status()
        return r.json()

    # ── Stats ────────────────────────────────────────────────────────────

    async def get_stats(self) -> dict[str, Any]:
        c = await self._get_client()
        r = await c.get("/api/stats")
        r.raise_for_status()
        return r.json()

    # ── Works ────────────────────────────────────────────────────────────

    async def get_works(
        self,
        *,
        search: str | None = None,
        sort: str = "recent",
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        c = await self._get_client()
        params: dict[str, Any] = {"sort": sort, "limit": limit, "offset": offset}
        if search:
            params["q"] = search
        r = await c.get("/api/works", params=params)
        r.raise_for_status()
        return r.json()

    async def get_work(self, work_id: str) -> dict[str, Any]:
        c = await self._get_client()
        r = await c.get(f"/api/works/{work_id}")
        r.raise_for_status()
        return r.json()

    # ── Authors ──────────────────────────────────────────────────────────

    async def get_authors(
        self,
        *,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        c = await self._get_client()
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if search:
            params["q"] = search
        r = await c.get("/api/authors", params=params)
        r.raise_for_status()
        return r.json()

    async def get_author(self, author_id: str) -> dict[str, Any]:
        c = await self._get_client()
        r = await c.get(f"/api/authors/{author_id}")
        r.raise_for_status()
        return r.json()

    # ── Media Upload ─────────────────────────────────────────────────────

    async def presign_media(
        self,
        entity_type: str,
        entity_id: str,
        filename: str,
        content_type: str,
    ) -> dict[str, Any]:
        c = await self._get_client()
        r = await c.post(
            "/api/media/process",
            json={
                "action": "presign",
                "entityType": entity_type,
                "entityId": entity_id,
                "filename": filename,
                "contentType": content_type,
            },
        )
        r.raise_for_status()
        return r.json()

    async def process_media(
        self,
        entity_type: str,
        entity_id: str,
        media_type: str,
        file_id: str,
        bronze_key: str,
        original_filename: str,
        mime_type: str,
        size_bytes: int,
    ) -> dict[str, Any]:
        c = await self._get_client()
        r = await c.post(
            "/api/media/process",
            json={
                "action": "process",
                "entityType": entity_type,
                "entityId": entity_id,
                "mediaType": media_type,
                "fileId": file_id,
                "bronzeKey": bronze_key,
                "originalFilename": original_filename,
                "mimeType": mime_type,
                "sizeBytes": size_bytes,
            },
        )
        r.raise_for_status()
        return r.json()

    async def upload_file_to_presigned(
        self, url: str, data: bytes, content_type: str
    ) -> None:
        """PUT raw bytes to a pre-signed S3 URL."""
        async with httpx.AsyncClient(timeout=120.0) as c:
            r = await c.put(url, content=data, headers={"Content-Type": content_type})
            r.raise_for_status()
