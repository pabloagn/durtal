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
|   |   +-- page.tsx           Dashboard
|   |   +-- layout.tsx         Root layout (fonts, shell)
|   |   +-- library/           Library pages (browse, detail, add, import)
|   |   +-- authors/           Author pages (index, detail)
|   |   +-- series/            Series pages (index, detail)
|   |   +-- locations/         Location management
|   |   +-- collections/       Collection management
|   |   +-- tags/              Tag management
|   |   +-- settings/          Settings page
|   |   +-- api/               REST API routes
|   |       +-- health/        Health check
|   |       +-- stats/         Library statistics
|   |       +-- search/        External book search
|   |       +-- works/         Works endpoints
|   |       +-- authors/       Authors endpoints
|   |       +-- media/         Media upload/process
|   |       +-- s3/            S3 pre-signing
|   |       +-- geocode/       Nominatim geocoding proxy
|   |
|   +-- components/            React components
|   |   +-- ui/                Primitives (button, card, badge, input, table, dialog, etc.)
|   |   +-- layout/            Shell, sidebar, command palette, page header
|   |   +-- books/             Book card, grid, list, table, view switcher
|   |   +-- locations/         Address input modes (manual, postal, map)
|   |   +-- media/             Gallery, upload zone, lightbox, hero background
|   |
|   +-- lib/                   Server-side logic
|   |   +-- db/                Database (Drizzle ORM)
|   |   |   +-- schema/        Table definitions (10 files)
|   |   |   +-- index.ts       Connection singleton (Neon HTTP)
|   |   |   +-- migrations/    SQL migration files
|   |   +-- actions/           Server actions (business logic)
|   |   +-- s3/                S3 client, keys, covers, media processing
|   |   +-- api/               External API clients (Google Books, Open Library)
|   |   +-- validations/       Zod schemas for input validation
|   |   +-- types/             TypeScript type definitions and enums
|   |   +-- hooks/             Custom React hooks
|   |
|   +-- styles/
|       +-- globals.css        Tailwind 4 theme + base styles
|
+-- scripts/                   Python scripts
|   +-- tui/                   Terminal UI (Textual)
|   +-- ingest/                Seed data ETL pipeline
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
| `task db:migrate` | Apply pending migrations to Neon |
| `task db:push` | Push schema directly (dev only, no migration) |
| `task db:studio` | Open Drizzle Studio browser |
| `task ingest` | Run full ingestion pipeline |
| `task ingest:dry` | Dry run ingestion |
| `task ingest:step -- <name>` | Run single ingestion step |
| `task ingest:report` | Generate ingestion quality report |
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
| `pnpm db:generate` | `drizzle-kit generate` |
| `pnpm db:migrate` | `drizzle-kit migrate` |
| `pnpm db:push` | `drizzle-kit push` |
| `pnpm db:studio` | `drizzle-kit studio` |

---

## Database Management

### Drizzle ORM Workflow

1. **Modify schema** in `src/lib/db/schema/*.ts`
2. **Generate migration**: `task db:generate` (creates SQL file in `src/lib/db/migrations/`)
3. **Review migration**: Inspect the generated SQL
4. **Apply migration**: `task db:migrate` (runs against Neon)
5. **Update docs**: Update `docs/01_SPECS.md` if the schema change is architectural

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

- Next.js ESLint config (`eslint-config-next`)
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
