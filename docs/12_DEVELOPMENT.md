# Development

## Prerequisites

The project uses Nix flakes to provide a reproducible development environment. All tooling is declaratively specified — no manual installation required.

**Option A (recommended)**: Install [Nix](https://nixos.org/) with flakes enabled, then `direnv allow` in the project root. Everything else is automatic.

**Option B**: Install manually:
- Node.js 22
- pnpm 10
- Python 3.12
- uv (Python package manager)
- go-task (task runner)

---

## Nix Development Shell

The development shell is defined in `flake.nix` and `nix/shell.nix`.

### Activation

```bash
cd durtal
direnv allow    # .envrc calls: use flake
```

Or manually:

```bash
nix develop
```

### Provided Tooling

| Category | Packages |
|---|---|
| **Version Control** | git, git-lfs, gh, difftastic |
| **Node.js** | nodejs 22, pnpm, typescript |
| **Python** | python 3.12, uv |
| **Task Runner** | go-task |
| **Language Servers** | typescript-language-server, tailwindcss-language-server, basedpyright, taplo, yaml-language-server, vscode-langservers-extracted |
| **Cloud** | awscli2 |
| **Containers** | docker, docker-compose, lazydocker |
| **Database** | postgresql (psql client) |
| **HTTP Testing** | curl, jq, httpie |
| **Debugging** | ncdu, htop, hyperfine |
| **System Libs** | libxml2, libxslt, zlib, libffi, openssl, pkg-config |
| **AI Tools** | claude-code (unstable), claude-monitor (unstable), codex, gemini-cli |

### Shell Hook

The shell hook:
1. Sets `SSL_CERT_FILE` for uv-managed Python
2. Strips Nix-injected Python 3.13 site-packages from `PYTHONPATH` to prevent ABI conflicts
3. Activates `.venv` if it exists

---

## Project Structure

```
durtal/
+-- docs/                      Documentation (this set of files)
+-- changelog/                 Task-by-task implementation log
|
+-- src/                       Next.js application (TypeScript)
|   +-- app/                   App Router pages and API routes
|   |   +-- (catalogue)/       The app's pages under one layout (fonts, shell, force-dynamic)
|   |   |   +-- page.tsx       Dashboard
|   |   |   +-- library/       Books: browse, detail, add
|   |   |   +-- people/        People: index, detail, map
|   |   |   +-- series/  collections/  publishers/  organizations/  places/  locations/
|   |   |   +-- reading/       Reading: hub, journal, notes, stats, year, suggestions, import
|   |   |   +-- statistics/  ebooks/  taxonomy/  recommenders/  provenance/  harmonize/
|   |   |   +-- films/  perfumes/  paintings/
|   |   |   +-- settings/      Settings pages
|   |   +-- (offline)/         Offline pages (offline e-books, the offline notice)
|   |   +-- reader/            The e-book reader, with its own layout
|   |   +-- api/               REST API routes, one folder per resource
|   |
|   +-- components/            React components, one folder per area (ui/, layout/, shared/, books/, reading/, ...)
|   +-- hooks/                 Custom React hooks used by components
|   |
|   +-- lib/                   Server-side logic
|   |   +-- db/                Drizzle schema, connection (Neon HTTP), migrations
|   |   +-- actions/           Server actions (business logic)
|   |   +-- catalogue/  library/  works/  books/  authors/  series/  publishers/  collections/
|   |   +-- reading/           Reading history, stats, journal, suggestions, imports
|   |   +-- ebooks/  reader/   E-book ingestion and the reader's server side
|   |   +-- interchange/       Import and export of the catalogue
|   |   +-- s3/  media/  color/  Storage, images and cover colours
|   |   +-- api/  providers/  wikidata/  match/  External lookups
|   |   +-- types/             TypeScript type definitions and enums
|   |   +-- hooks/             Shared React hooks (settings, preferences, selection, search)
|   |   +-- validations/  utils/  ui/  ...
|   |
|   +-- styles/
|   |   +-- globals.css        Tailwind 4 theme + base styles
|   |   +-- root-fonts.ts      The three font families
|   +-- vendor/                Vendored foliate-js
|
+-- scripts/                   Tools that run outside the app (none in the Docker image)
|   +-- ingest/                Python: seed data from the spreadsheet (docs/09)
|   +-- tui/                   Python: terminal UI (docs/10)
|   +-- ebooks/                TypeScript: e-book ingest, matching and imports
|   +-- qa/                    Audits, page weight, the local preview and its seeds
|   +-- deploy/                The Mac release and launcher (docs/11)
|   +-- aws/  maintenance/  reader-fonts/  review/  authors/  books/  publishers/  enrich/  enrichment/
|
+-- drizzle.config.ts          Drizzle ORM configuration
+-- next.config.ts             Next.js configuration
+-- tsconfig.json              TypeScript configuration
+-- postcss.config.mjs         PostCSS configuration
+-- package.json               Node.js dependencies and scripts
+-- pyproject.toml             Python dependencies and tooling
+-- Dockerfile                 Multi-stage production build
+-- docker-compose.yml         Local dev compose
+-- Taskfile.yml               Task runner commands
+-- flake.nix                  Nix flake definition
+-- nix/shell.nix              Nix shell configuration
+-- .envrc                     direnv configuration
+-- .env.example               Environment variable template
+-- .gitignore                 Git ignore rules
+-- CLAUDE.md                  AI agent instructions
```

---

## Commands Reference

### Taskfile (Primary Interface)

All commands can be run via `task <name>`:

| Command | Description |
|---|---|
| `task install` | Install all dependencies (pnpm + uv) |
| `task dev` | Start Next.js dev server (Turbopack) |
| `task build` | Production build |
| `task start` | Start production server |
| `task lint` | ESLint + TypeScript type check |
| `task format` | Format code with Prettier |
| `task typecheck` | TypeScript type check only |
| `task db:generate` | Generate Drizzle migration from schema changes |
| `task db:migrate` | Apply pending migrations to the database in `DATABASE_URL` (live migrations go through docs/11, Release order) |
| `task db:push` | Push schema directly (dev only, no migration) |
| `task db:studio` | Open Drizzle Studio browser |
| `task ingest` | Run full ingestion pipeline |
| `task ingest:dry` | Dry run ingestion |
| `task ingest:step -- <name>` | Run single ingestion step |
| `task docker:build` | Build production Docker image |
| `task docker:run` | Run Docker image locally |
| `task tui` | Launch terminal UI |
| `task py:lint` | Lint Python scripts (ruff) |
| `task py:format` | Format Python scripts (ruff) |
| `task py:typecheck` | Type check Python scripts (basedpyright) |
| `task clean` | Remove all generated artifacts |

The Taskfile loads `.env.local` and `.env` automatically (`dotenv` directive).

### pnpm Scripts (Direct)

| Script | Description |
|---|---|
| `pnpm dev` | Start dev server with Turbopack |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run `tsc --noEmit` |
| `pnpm format` | Format with Prettier |
| `pnpm format:check` | Check formatting |
| `pnpm test` | Vitest. Skips the database suites and names each one it skipped |
| `pnpm test:local` | Every Vitest suite, including the database suites, against a disposable PostgreSQL 16 container (`scripts/qa/test-local.py`). It migrates one template database per run and resets each test's database to a copy of it, with test files running side by side. Needs Docker and the `postgres:16` image. Run it before landing a change |
| `pnpm db:generate` | `drizzle-kit generate` |
| `pnpm db:migrate` | `drizzle-kit migrate` |
| `pnpm db:push` | `drizzle-kit push` |
| `pnpm db:studio` | `drizzle-kit studio` |
| `pnpm ebooks:ingest` | Plan, apply, resume or undo an e-book ingestion (`docs/09_INGESTION_PIPELINE.md`, eBook ingestion). `--preview PORT` runs it against a running preview's database and S3 folder (`scripts/qa/preview-local.py --start --port PORT --s3-dir DIR`) |
| `pnpm ebooks:reconcile` | Reconcile folders, the catalogue and the bucket; read-only. `--preview PORT` as above |
| `pnpm ebooks:verify` | Verify every stored e-book file against its row (`docs/07_STORAGE.md`, Verification) |

---

## Database Management

### Drizzle ORM Workflow

1. **Modify schema** in `src/lib/db/schema/*.ts`
2. **Generate migration**: `task db:generate` (creates SQL file in `src/lib/db/migrations/`)
3. **Review migration**: Inspect the generated SQL
4. **Apply migration**: locally, `pnpm test:local` and `preview-local.py` apply it to their disposable databases; live, it goes through the release's backup, rehearsal and `live_migrate.py migrate` (docs/11, Release order)
5. **Update docs**: Update `docs/02_DATA_MODEL.md` to match the schema, and `docs/01_ARCHITECTURE.md` if the change is architectural

For rapid development:
- `task db:push` applies schema changes directly without creating a migration file. Useful during iteration, but all production changes should go through migrations.

### Drizzle Studio

```bash
task db:studio
```

Opens a browser-based database browser connected to Neon. Allows direct inspection and editing of data.

---

## Code Quality

### TypeScript

- Strict mode enabled (`tsconfig.json`)
- Target: ES2017
- Module: ESNext
- Path alias: `@/*` maps to `./src/*`
- Always run `pnpm typecheck` before considering TypeScript changes complete

### ESLint

- `typescript-eslint` recommended, `eslint-plugin-react-hooks` and `@next/eslint-plugin-next` (recommended and Core Web Vitals rules), in `eslint.config.mjs`
- The React Compiler rules of `eslint-plugin-react-hooks` warn for now; `rules-of-hooks` and the Next rules fail the run
- Run via `pnpm lint` or `task lint`

### Prettier

- Formats `.ts`, `.tsx`, `.css` files under `src/`
- Run via `pnpm format` or `task format`

### Python

| Tool | Purpose | Command |
|---|---|---|
| ruff | Linter + formatter | `task py:lint`, `task py:format` |
| basedpyright | Type checker | `task py:typecheck` |
| pytest | Testing | `uv run pytest` |

Ruff configuration in `pyproject.toml`:
- Line length: 88
- Target: Python 3.12
- Enabled rules: E, W, F, I, B, C4, UP

---

## Local Preview and QA

Front-end and speed checks run against a disposable preview, never the live app or database. CLAUDE.md requires the alignment audit, the design audit and `page-weight.js` before a front-end change is done.

### The local preview

`python3 scripts/qa/preview-local.py [flags]` starts PostgreSQL 16 in Docker on a loopback port, applies every migration, loads a small synthetic catalogue and serves the app on http://127.0.0.1:3410. The app's Neon driver is bridged to that database (`scripts/qa/neon-local-bridge.mjs`), which refuses any other host. No environment file, live database or S3 credential is read. Ctrl-C stops it and removes the container. The script's docstring has the detail of each flag.

| Flag | What it does |
|---|---|
| `--port PORT` | Serve on PORT instead of 3410 |
| `--start` | Serve the production build in `.next` (run `pnpm build` first) instead of `next dev` |
| `--from-dump FILE` | Restore a `pg_dump --format=custom` backup (pg_dump 16) instead of the synthetic catalogue, apply the pending migrations and print the rows they changed: the rehearsal of a live migration |
| `--seed-large N` | Add N perfumes, N films and N paintings (`seed-large.sql`) |
| `--log-sql FILE` | Append every query the app sends, with its time and rows, to FILE as JSON lines |
| `--s3-dir DIR` | Keep S3 objects as files under DIR, so uploads, imports and e-books work |
| `--seed-reader` | Store and catalogue the e-book fixtures (needs `--s3-dir`) |
| `--reader-large DIR` | With `--seed-reader`, also the large fixtures `make-ebook-fixtures.mjs --large DIR` wrote |
| `--ebooks M` | Add M synthetic e-books with valid files and covers (needs `--s3-dir`) |
| `--ebooks-acceptance` | With `--ebooks 6000` or `7000`, the library acceptance fixtures |
| `--seed-highlights N` | Reader marks on the first N e-books (`seed-highlights.sql`) |
| `--seed-places N` | N saved places on the first e-book (`seed-places.sql`) |
| `--seed-review` | Spread the synthetic pending e-books over the review queue (`seed-review.sql`) |
| `--seed-heavy-book` | A well-used book for `page-weight-heavy.json` (`seed-heavy-book.sql`) |
| `--api-token` | A random `DURTAL_API_TOKEN` for this run, printed once |
| `--upload-service DIR` | Run an e-book upload service for this preview, its state in the new folder DIR (needs `--s3-dir`) |

For checks at scale, `scripts/qa/seed-scale.sql` adds about 5,000 books with their people, publishers, series, collections and venues to a running preview: `docker exec -i <durtal-preview container> psql -U durtal_preview -d durtal_preview < scripts/qa/seed-scale.sql` (`docker ps` names the container).

**Seeded ids are valid UUIDs.** Use `gen_random_uuid()`, or, where a seed must refer to its own rows, a version-4 id built from a name (`seed_uuid` in `seed-scale.sql`, `vu` in `seed-heavy-book.sql`). Never `md5(…)::uuid`: `z.uuid()` refuses it, so every page that checks its id answers 404 (SLN-1167).

### Audits in the page

These run in a page after it has painted. Paste the file into the browser console, or evaluate its text with a headless browser (Playwright's `page.evaluate(source)`). Each returns JSON. Check at 1440, 390 and 320 px in Chromium, Firefox and WebKit.

| Script | Finds | Passes when |
|---|---|---|
| `scripts/qa/alignment-audit.js` | Icons off the cap-height center of their text, controls off a heading's cap height, ghost buttons off their text edge | `issues` is empty (tolerance 0.5 px) |
| `scripts/qa/design-audit.js` | Text under 4.5:1 (3:1 at 24 px or more), unnamed controls, nested controls; the sizes, colours, radii and icons in use | `lowContrast`, `unnamed` and `nested` are 0 |
| `scripts/qa/overflow-audit.js` | Sideways scroll and the elements past the right edge, at phone width | `overflow` is 0 and `offenders` is empty |
| `scripts/qa/touch-audit.js` | Controls under 44 × 44 px, with a coarse pointer emulated | `issues` is empty |
| `scripts/qa/layout-audit.js` | Squeezed titles, commands that look like plain text, drifting edges in cards | No new finding (`phone-audit.mjs` marks those in `layout-audit-known.json` as known) |

### Command-line checks

Point these at a running preview.

- `node scripts/qa/page-weight.js [baseUrl]`: each main route's HTML size and server time against its budget in `scripts/qa/page-weight.json`; exits 1 when one is over. `PAGE_WEIGHT_CONFIG=scripts/qa/page-weight-heavy.json` checks the heavy book (`--seed-heavy-book`).
- `node scripts/qa/phone-audit.mjs [--base URL] [--strict] [route...]`: the overflow and layout audits at phone widths in headless Chrome.
- `node scripts/qa/interaction-audit.mjs --disposable [--base URL] [route...]`: keyboard, focus, dialogs, reduced motion and touch with real key presses. It opens dialogs, so it refuses to run without `--disposable`.
- `node scripts/qa/journeys.mjs --disposable [baseUrl] [journey ...]`: a reader's journeys through the app (the three open collections, `collect`, `books`, `kinds`, `reading` and the rest the file's header lists), each making what it needs and deleting its books at the end.

---

## Dependencies

### Node.js (Runtime)

| Package | Version | Purpose |
|---|---|---|
| `next` | ^16.2 | Application framework |
| `react` / `react-dom` | ^19.2 | UI library |
| `tailwindcss` | ^4.2 | Utility-first CSS |
| `drizzle-orm` | ^0.45 | Database ORM |
| `drizzle-kit` | ^0.31 | Schema migrations |
| `@neondatabase/serverless` | ^1.0 | Neon PostgreSQL driver |
| `@aws-sdk/client-s3` | ^3.1019 | S3 operations |
| `@aws-sdk/s3-request-presigner` | ^3.1019 | Pre-signed URLs |
| `sharp` | ^0.34 | Image processing |
| `zod` | ^4.3 | Schema validation |
| `cmdk` | ^1.1 | Command palette |
| `lucide-react` | ^1.7 | Icons |
| `sonner` | ^2.0 | Toast notifications |
| `nuqs` | ^2.8 | URL search params state |
| `csv-parse` | ^6.2 | CSV parsing for imports |
| `isbn3` | ^2.0 | ISBN validation |
| `leaflet` / `react-leaflet` | ^1.9 / ^5.0 | Map component for locations |
| `@zip.js/zip.js` | ^2.23 | Reading e-book zips (EPUB, CBZ, FB2Z) by range, without loading the whole file |
| `htmlparser2` | ^10.1 | Parsing OPF, NCX, XHTML and FB2 for metadata and text counts |
| `pdfjs-dist` | 6.4.299 (exact) | PDF metadata, text and first-page covers (the legacy build in Node) |
| `@napi-rs/canvas` | ^1.0 | The canvas pdf.js draws a PDF's first page on |

### Node.js (Development)

| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5.9 | Type system |
| `eslint` / `eslint-config-next` | ^10.1 / ^16.2 | Linting |
| `prettier` | ^3.8 | Formatting |
| `@types/node` | ^25.5 | Node type definitions |
| `@types/react` / `@types/react-dom` | ^19.2 | React type definitions |
| `@types/leaflet` | ^1.9 | Leaflet type definitions |
| `dotenv` | ^17.3 | .env loading |
| `postgres` | ^3.4 | PostgreSQL client (development) |

### Python

| Package | Version | Purpose |
|---|---|---|
| `pandas` | >=2.2 | Data manipulation |
| `openpyxl` | >=3.1 | Excel reading |
| `pyarrow` | >=15.0 | Parquet reading |
| `psycopg2-binary` | >=2.9 | PostgreSQL connection |
| `pydantic` / `pydantic-settings` | >=2.6 / >=2.0 | Validation |
| `click` | >=8.1 | CLI interface |
| `rich` | >=13.7 | Console formatting |
| `textual` | >=3.0 | Terminal UI framework |
| `typer` | >=0.15 | CLI helpers |
| `httpx` | >=0.27 | HTTP client |
| `pillow` | >=10.3 | Image processing |
| `boto3` | >=1.34 | S3 client |
| `python-dotenv` | >=1.0 | .env loading |
| `isbnlib` | >=3.10 | ISBN handling |

Python dev dependencies: `pytest` (>=8.0), `ruff` (>=0.5.0), `basedpyright` (>=1.12.0).


### Reader speech source validation boundary (SLN-508)

Checkpoint `1640c284` passed 163 lightweight cases across 13 affected suites using existing dependencies. The subsequent accessibility/selection mounting passed 45 cases across five suites and scoped TypeScript before the root's QUIET-494 window. Follow-up engine enumeration and selection readiness tests are committed but unrun. Resume tests, scoped types/lint/formatting and full acceptance only after root releases the quiet window; a source-only commit is not final test acceptance.

The remaining acceptance includes approved PDF/decorations/presentation/note runtimes, native Chromium/Firefox/WebKit at 1440/768/390, full accessibility and interaction audits, trusted touch, 200% zoom/text spacing, real speech/turn/section/idle measurements, the full zero-skip DB suite, project static/build/CI gates and root-authorized deployment. Test-double speech callbacks and happy-dom frame assertions establish source behavior only. Keep physical device/screen-reader proof separate. Do not run these against the primary checkout or manual port 3100, and do not install dependencies for a gated checkpoint.
