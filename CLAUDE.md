# Agent Guidelines — Durtal

**Purpose**: Personal book catalogue and library index. Single source of truth for all books — physical and digital, across multiple locations.

---

## Quick Reference

- **Docs**: `docs/` directory (14 numbered documents, start with `00_README.md` and `01_ARCHITECTURE.md`)
- **Data model**: `docs/02_DATA_MODEL.md` (three-tier model, all tables, relationships)
- **Changelog**: `changelog/NNNN_TASK_description.md` (task-by-task implementation log)
- **Stack**: Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui, Drizzle ORM, Neon Postgres, AWS S3
- **Ingestion scripts**: Python 3.12 under `scripts/ingest/` (not part of the Next.js app)

---

## Critical Rules

### Do Not
- **NEVER** commit `.env`, `.env.local`, or any file containing secrets
- **NEVER** create documentation proactively — only when explicitly requested
- **NEVER** add emojis unless explicitly requested
- **NEVER** install dependencies without mentioning it first
- **NEVER** modify the database schema without updating `docs/02_DATA_MODEL.md` to match

### Always
- **ALWAYS** assess affected call sites and likely regressions before changing shared UI. Before merging, verify the rendered result with long, short and absent content across affected layouts and viewport sizes; readable text alone does not prove usable card proportions.
- **ALWAYS** read relevant docs under `docs/` before making architectural decisions
- **ALWAYS** use the three-tier data model: Work → Edition → Instance
- **ALWAYS** run `pnpm typecheck` before considering TypeScript changes complete
- **ALWAYS** run `pnpm test:local` before landing a change: `pnpm test` skips the database suites
- **ALWAYS** use Drizzle migrations for schema changes (never raw SQL in production)
- **ALWAYS** ask the user if uncertain rather than guessing
- **ALWAYS** check every front-end change for pixel-perfect alignment in the browser before calling it done: run `scripts/qa/alignment-audit.js` on each page it touches and fix every deviation over 0.5px. Measure; never judge alignment from a screenshot
- **ALWAYS** run `node scripts/qa/page-weight.js` before calling a front-end change done. It fails when a main route is over its HTML size or server time budget in `scripts/qa/page-weight.json`

---

## Project Structure

```
src/                    Next.js application (TypeScript)
  app/                  App Router pages and API routes
  components/           React components (ui/, catalogue/, layout/, shared/)
  lib/                  Server-side logic (db/, s3/, api/, import/, utils/)
  hooks/                Custom React hooks
  styles/               Global CSS
  types/                TypeScript type definitions

scripts/                Python ingestion scripts (not part of Docker image)
  ingest/               Seed data ETL pipeline

docs/                   Specifications and documentation
changelog/              Task-by-task implementation log
```

---

## Data Model (Three Tiers)

1. **Work** (`works` table) — Abstract intellectual creation. Carries: canonical title, original language, original year, series, catalogue status, rating.
2. **Edition** (`editions` table) — Specific publication. Carries: ISBN, publisher, imprint, language, page count, binding, dimensions, cover image. One work has many editions.
3. **Instance** (`instances` table) — Physical/digital copy at a location. Carries: format, condition, acquisition details, collector flags. One edition has many instances.

Authors link to **works** (as writer/co-author via `work_authors`) and to **editions** (as translator/editor/illustrator/etc. via `edition_contributors`).

Ownership is **derived**: a work with `catalogue_status='accessioned'` and at least one active instance is "owned". No redundant status field.

---

## Commands

```bash
# Node.js / Next.js
pnpm dev                    # Start dev server (http://localhost:3000)
pnpm build                  # Production build
pnpm typecheck              # TypeScript type checking
pnpm lint                   # ESLint
pnpm test                   # Vitest without the database suites (names each one it skips)
pnpm test:local             # Every suite, against a disposable PostgreSQL 16 (Docker)
pnpm db:generate            # Generate Drizzle migration from schema changes
pnpm db:migrate             # Apply pending migrations to Neon
pnpm db:studio              # Open Drizzle Studio (database browser)

# Python ingestion scripts
uv sync                     # Install Python dependencies
uv run python -m scripts.ingest.main --all --dry-run    # Dry run
uv run python -m scripts.ingest.main --all              # Full ingestion
uv run python -m scripts.ingest.main --step taxonomy    # Single step

# Docker
docker build -t durtal .    # Build production image
docker compose up -d        # Start local dev services (if any)

# Task runner
task dev                    # Start Next.js dev server
task build                  # Production build
task lint                   # Lint + typecheck
task ingest                 # Run full ingestion pipeline
task ingest:dry             # Dry run ingestion
```

---

## Design Language

Dark-mode only. Gothic-minimal aesthetic. Reference: `docs/03_DESIGN_LANGUAGE.md`.

Key constraints:
- Border radius: 4px controls, 6px floating surfaces; compact, subtly softened corners
- Colors: All desaturated, muted. No bright neons. Over an image, small controls and marks are `glass-chip`, larger layers use the `overlay`, `scrim` and `scrim-deep` tokens; never `bg-black` or `text-white`
- Text contrast is at least 4.5:1: text a reader needs uses `fg-secondary` or brighter; `fg-muted` is for placeholders, disabled text, separators and decoration only; interaction and red text use `accent-primary` / `accent-red-text`; primary confirmations use `action-fill` with `action-fg`. Check with `scripts/qa/design-audit.js`
- Typography: literary page/content headings (PP Cirka), functional dialog/form headings and body (Inter); long reading text (descriptions, bios) in EB Garamond through `<Prose>` (`src/components/shared/prose.tsx`, role `type-prose`)
- Type: seven sizes only (12, 14, 16, 21, 30, 38, 46px). Headings use the `type-*` roles; every titled block on a page uses `SectionHeading` (`src/components/shared/section-heading.tsx`). See `docs/03_DESIGN_LANGUAGE.md`, Typography
- Icons: Lucide, 1.5px stroke, 16px max for interface icons (image placeholders may use larger decorative ones)
- Tooltips: `data-tooltip` (and `data-tooltip-keys` for a shortcut), never the `title` attribute. Every icon-only control has an `aria-label` and a tooltip. See `docs/03_DESIGN_LANGUAGE.md`, Tooltips
- Glass: one material (`glass`, `glass-bar`, `glass-veil` in `globals.css`) for surfaces that float above the page: command palette, menus, popovers, tooltips, dialogs, selection toolbars. Never on page content. A glass surface never scrolls: it takes `overflow-hidden` and an element inside it scrolls. See `docs/03_DESIGN_LANGUAGE.md`, Glass
- Alignment is pixel-perfect:
  - An icon or small button beside text sits on the cap-height center of the text's first line: use `CapAligned` (`src/components/shared/cap-aligned.tsx`), never plain `items-center` beside serif text
  - Siblings in a row keep equal gaps
  - Cards stretch to the tallest item in their row. Titles and identifying metadata must wrap in full, never clamp for equal height. Use `CardHeading`, `card-body`, and container-aware grids/shelves with a 208px readable minimum (or the available width if smaller).
  - Book cover badges share one size and inset (`src/components/books/cover-chip.ts`). A cover carries only the rare, poison and digital marks; status and rating sit in the card's info row

---

## Changelog Convention

For each implementation task, create: `changelog/NNNN_TASK_kebab-case-description.md`

Format:
```markdown
# Task NNNN: [Title]

**Status**: [Not Started | In Progress | Completed]
**Created**: [Date]
**Priority**: [HIGH | MEDIUM | LOW]
**Type**: [Infrastructure | Feature | Enhancement | Fix]
**Depends On**: [Task IDs or "None"]
**Blocks**: [Task IDs or "None"]

## Overview
[What this task accomplishes]

## Implementation Details
[Technical details, code locations, decisions made]

## Completion Notes
[What was actually done, metrics, deviations from plan]
```
