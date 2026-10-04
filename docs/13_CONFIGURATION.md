# Configuration

## Environment Variables

All environment variables are listed in `.env.example`. Copy it to `.env.local` for Next.js and `.env` for Python scripts.

`src/lib/env.ts` is the only place the app reads them. `serverEnv()` validates the server variables with zod, and `src/instrumentation.ts` calls it when the server starts. A missing or invalid required variable stops the server with one error that lists every problem. `next build` does not validate, so a build needs no secrets. Empty values count as unset.

### Database

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string. Format: `postgresql://user:pass@host.neon.tech/durtal?sslmode=require` |

### AWS S3

| Variable | Required | Default | Description |
|---|---|---|---|
| `AWS_ACCESS_KEY_ID` | Yes | — | IAM access key for the `durtal-app` user |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | IAM secret key |
| `AWS_REGION` | No | `us-east-1` | S3 bucket region (`eu-central-1` in production) |
| `S3_BUCKET` | No | `durtal` | S3 bucket name |

### External APIs

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_BOOKS_API_KEY` | No | Google Cloud API key with Books API enabled. Without it, requests are anonymous and hit the shared rate limit (HTTP 429) |
| `GOOGLE_PLACES_API_KEY` | No | Google Cloud API key with Places API (New) enabled. Without it, venue search answers 503 |
| `ISBNDB_API_KEY` | No | ISBNdb API key. Without it, ISBNdb search is skipped. The misspelled `ISBNDN_API_KEY` is still accepted, with a warning, for one release |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | No | Mapbox public token for the authors map. Inlined into the client bundle at build time |

### Application

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Node environment (`development`, `production` or `test`) |
| `DURTAL_API_TOKEN` | No | — | Bearer token for the REST API write routes (orders, copies, works). Not set: every API write is refused. Make one with `openssl rand -hex 32`. See [05_API_REFERENCE.md](05_API_REFERENCE.md) |
| `APP_TIMEZONE` | No | `Europe/Amsterdam` | IANA time zone the server uses for "today" (default order, shipped and delivered dates; export file names) |
| `ADMIN_TOKEN` | No | — | Token for the bulk media endpoints (`/api/media/reprocess`, `/api/media/backfill-palettes`, `/api/media/apply-crops`), sent as the `x-admin-token` header. Not set: these endpoints refuse every call (SLN-423). Make one with `openssl rand -hex 32` |

### Python Scripts

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL`, `AWS_*`, `S3_BUCKET` | — | — | Same as above |
| `INGEST_EXCEL_PATH` | For ingestion | `~/dev/phantom/.../knowledge_base.xlsx` | Absolute path to `knowledge_base.xlsx` |
| `CALIBRE_LIBRARY_PATH` | No | `/mnt/data/Books-Library` | Calibre library root for `scripts/calibre_sync` |
| `DURTAL_API_URL` | No | `http://localhost:3003` | API base URL for the TUI client (loaded from `.env.local`) |

### Tests

Integration tests read their own `DURTAL_*_TEST_DATABASE_URL` variables and skip when they are unset. `vitest.config.ts` sets placeholder values for the variables `src/lib/env.ts` requires.

---

## Config Files

### `next.config.ts`

```typescript
const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "covers.openlibrary.org" },
    ],
  },
};
```

| Setting | Value | Purpose |
|---|---|---|
| `output` | `"standalone"` | Minimal production build for Docker (no `node_modules` needed at runtime) |
| `images.remotePatterns` | Google Books, Open Library | Allows `next/image` to optimize remote cover images from these domains |

### `drizzle.config.ts`

```typescript
export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
});
```

| Setting | Value | Purpose |
|---|---|---|
| `schema` | `./src/lib/db/schema/index.ts` | Schema source (barrel export of all tables) |
| `out` | `./src/lib/db/migrations` | Migration output directory |
| `dialect` | `postgresql` | Database dialect |
| `verbose` | `true` | Log generated SQL |

Loads environment via `import "dotenv/config"` at the top.

### `tsconfig.json`

| Setting | Value | Purpose |
|---|---|---|
| `target` | `ES2017` | JavaScript output target |
| `module` | `esnext` | ES module system |
| `moduleResolution` | `bundler` | Next.js bundler resolution |
| `strict` | `true` | Full TypeScript strict mode |
| `jsx` | `react-jsx` | React JSX transform |
| `incremental` | `true` | Faster rebuilds |
| `paths.@/*` | `./src/*` | Import alias (`@/lib/db` maps to `./src/lib/db`) |
| `exclude` | `node_modules`, `scripts` | Python scripts excluded from TS compilation |

### `postcss.config.mjs`

```javascript
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

Tailwind CSS 4 uses PostCSS as its integration layer. No separate `tailwind.config.ts` — all configuration lives in `src/styles/globals.css` via `@theme` blocks.

### `pyproject.toml`

| Section | Value | Purpose |
|---|---|---|
| `project.name` | `durtal-scripts` | Python package name |
| `project.requires-python` | `>=3.12` | Minimum Python version |
| `project.scripts.durtal-tui` | `scripts.tui.app:main` | TUI entry point (run via `uv run durtal-tui`) |
| `build-system` | hatchling | Build backend |
| `tool.ruff.line-length` | 88 | Max line length |
| `tool.ruff.target-version` | `py312` | Target Python version |
| `tool.basedpyright.typeCheckingMode` | `standard` | Type checking strictness |

### `Taskfile.yml`

Loads `.env.local` and `.env` automatically via the `dotenv` directive. See [12_DEVELOPMENT.md](12_DEVELOPMENT.md) for the full command reference.

### `.envrc`

```
use flake
```

Tells direnv to activate the Nix flake development shell.

### `.gitignore`

Key entries:
- `.env.local`, `.env` — Secrets never committed
- `.next/` — Build output
- `node_modules/` — Dependencies
- `.venv/` — Python virtual environment
- `__pycache__/` — Python bytecode
- `*.parquet` — Data files
- `*.xlsx` — Source data files

---

## Changelog Convention

Each implementation task gets a changelog file: `changelog/NNNN_TASK_kebab-case-description.md`

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

Tasks are numbered sequentially. Dependencies and blocking relationships are tracked in the frontmatter.
