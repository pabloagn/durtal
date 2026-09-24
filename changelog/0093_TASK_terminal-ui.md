# Task 0093: Terminal UI

**Status**: Deferred
**Created**: 2026-04-06
**Priority**: LOW
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview
Document and track the Python-based TUI built with Textual under `scripts/tui/`. The TUI provides a keyboard-driven interface for browsing the library, viewing statistics, and uploading media from the terminal. It communicates with the Next.js application via REST API endpoints.

## Implementation Details
- Architecture: `scripts/tui/` (app.py, api_client.py, screens/, widgets/, styles/)
- Spec: `docs/10_TUI.md`
- Screens: Dashboard, Browse, Upload
- API contract: `/api/stats`, `/api/works`, `/api/media/process`

## Completion Notes
Deferred. TUI files exist but were never tracked in the changelog. Future work may include additional screens and polish.
