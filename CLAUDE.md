# Agent Guidelines — Durtal

**Purpose**: Personal book catalogue and library index. Single source of truth for all books — physical and digital, across multiple locations.

---

## Quick Reference

- **Docs**: `docs/` directory (14 numbered documents, start with `00_README.md` and `01_ARCHITECTURE.md`)
- **Data model**: `docs/02_DATA_MODEL.md` (three-tier model, all tables, relationships)
- **Changelog**: `changelog/NNNN_TASK_description.md` (task-by-task implementation log)
- **Stack**: Next.js 15, TypeScript, Tailwind CSS 4, shadcn/ui, Drizzle ORM, Neon Postgres, AWS S3
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
- **ALWAYS** read relevant docs under `docs/` before making architectural decisions
- **ALWAYS** use the three-tier data model: Work → Edition → Instance
- **ALWAYS** run `pnpm typecheck` before considering TypeScript changes complete
- **ALWAYS** use Drizzle migrations for schema changes (never raw SQL in production)
- **ALWAYS** ask the user if uncertain rather than guessing

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

Ownership is **derived**: a work with `catalogue_status='catalogued'` and at least one instance is "owned". No redundant status field.

---

## Commands

```bash
# Node.js / Next.js
pnpm dev                    # Start dev server (http://localhost:3000)
pnpm build                  # Production build
pnpm typecheck              # TypeScript type checking
pnpm lint                   # ESLint
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
- Border radius: 2px default (squared, not rounded)
- Colors: All desaturated, muted. No bright neons.
- Typography: Serif headings (EB Garamond), sans body (Inter)
- Icons: Lucide, 1.5px stroke, 16px max
- Glassmorphism: Navigation bar and command palette ONLY

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
