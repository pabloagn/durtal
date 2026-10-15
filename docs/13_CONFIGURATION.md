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
| `AWS_REGION` | No | `us-east-1` | S3 bucket region (`eu-north-1` in production) |
| `S3_BUCKET` | No | `durtal` | S3 bucket name |

### eBook storage

E-books use the existing private bucket and layer-first prefixes (SLN-569; `docs/07_STORAGE.md`). These app variables are optional; Settings, Integrations shows whether each is set, never credentials. Non-preview CLI commands require `--aws-profile durtal-personal`; that session does not replace app IAM credentials.

| Variable | Required | Default | Description |
|---|---|---|---|
| `EBOOKS_BUCKET` | No | `durtal` | Existing private bucket; no new bucket is provisioned |
| `EBOOKS_PREFIX` | No | empty | Legacy key prefix, ending in a slash (`ebooks/`). New bronze/silver/gold eBook keys ignore it |
| `EBOOKS_REGION` | No | `AWS_REGION` | The e-book bucket's region |
| `EBOOK_DELIVERY` | No | `app` | `cloudfront`: the browser reads files through signed CloudFront URLs. `app`: the app streams them itself by byte range (development, previews; `scripts/qa/preview-local.py` always sets `app`) |
| `EBOOK_CDN_URL` | With `cloudfront` | — | The distribution's address, `https://<id>.cloudfront.net` |
| `EBOOK_CDN_KEY_PAIR_ID` | With `cloudfront` | — | The id of the key group's public key |
| `EBOOK_CDN_PRIVATE_KEY` | With `cloudfront` | — | Its private key: base64 PEM in the server process environment. The Mac launcher reads the existing owner signing Keychain item and validates its public fingerprint at launch; never put it in env files, runtime config, argv, plists, reports or image layers |
| `EBOOK_UPLOAD_BRIDGE` | No | — | The absolute path of the upload service's private `bridge.json` (`pnpm ebooks:upload-service init`; docs/11_DEPLOYMENT.md, Browser uploads). Unset, the upload routes answer 503 |

`EBOOK_DELIVERY=cloudfront` with any of the three CDN variables missing stops the server at startup with one message naming each.

### External APIs

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_BOOKS_API_KEY` | No | Google Cloud API key with Books API enabled. Without it, requests are anonymous and hit the shared rate limit (HTTP 429) |
| `GOOGLE_PLACES_API_KEY` | No | Google Cloud API key with Places API (New) enabled. Without it, venue search answers 503 |
| `ISBNDB_API_KEY` | No | ISBNdb API key. Without it, ISBNdb search is skipped. The misspelled `ISBNDN_API_KEY` is still accepted, with a warning, for one release |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | No | Mapbox public token for the authors map. Inlined into the client bundle at build time |
| `ELEVENLABS_API_KEY` | No | ElevenLabs API key for the reader's natural read-aloud voices (`src/lib/reader/narration/`). The key needs the Text to Speech and Voices (read) permissions; reading uses about one credit per character with the default model. It stays on the server: the browser asks `/api/reader/narration` and never sees it. Not set: Read aloud uses the device's own voices. Keep it in `.env.local` only; the Mac standalone runtime takes it as a secret in `runtimeNames`, and the voice and model below in `environment` (`scripts/deploy/mac_release.py`) |
| `ELEVENLABS_VOICE_ID` | No | The default narrator's voice id. Not set: George (`JBFqnCBsd6RMkjVDRZzb`), or the account's first voice if George is not in it. The reader's voice menu can pick any voice in the account |
| `ELEVENLABS_MODEL_ID` | No | The ElevenLabs model. Not set: `eleven_multilingual_v2`, the most natural for long reading. `eleven_flash_v2_5` costs half as much and answers faster |

### Book enrichment

| Variable | Required | Default | Description |
|---|---|---|---|
| `ENRICHMENT_CONTACT` | For enrichment | — | The contact every enrichment request names in its User-Agent, `DurtalBot/1.0 (personal book catalogue; <contact>)` (`src/lib/enrichment/user-agent.ts`). Not set: the evidence fetcher refuses to start. The film and perfume Wikidata lookups add it to their own User-Agent when it is set (`src/lib/providers/wikidata.ts`). Keep it in `.env.local` only |
| `ENRICHMENT_MONTHLY_CAP_USD` | No | — | The monthly cap of metered enrichment calls (search and model providers), in US dollars, a decimal such as `20` or `7.50`. The month is the calendar month in `APP_TIMEZONE`. `0` lets free-tier calls through (they are still metered) and stops every paid call. Not set: every metered call stops. See the cost meter in [02_DATA_MODEL.md](02_DATA_MODEL.md) (`enrichment_costs`) |
| `TAVILY_API_KEY` | For research | — | The research agent's main search, Tavily (SLN-469). Get it at https://app.tavily.com; the free plan gives 1,000 credits a month, one per search. Not set: `--apply --kinds research` refuses. Keep it in `.env.local` only |
| `BRAVE_SEARCH_API_KEY` | No | — | The research agent's fallback search, Brave Search API (SLN-469), $5 per 1,000 requests. Get it at https://brave.com/search/api/. Not set: no fallback, and the run report says so. Keep it in `.env.local` only |
| `ANTHROPIC_API_KEY` | For extraction | — | The research agent's extraction model, `claude-opus-5-5` (SLN-469): $4 input and $20 output per million tokens, about $0.50 a book. Get it at https://console.anthropic.com. Not set: `--apply --kinds extract` refuses. Keep it in `.env.local` only |

### Application

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Node environment (`development`, `production` or `test`) |
| `DURTAL_API_TOKEN` | No | — | Bearer token for the REST API write routes (orders, copies, works). Not set: every API write is refused. Make one with `openssl rand -hex 32`. See [05_API_REFERENCE.md](05_API_REFERENCE.md) |
| `DURTAL_ALLOWED_HOSTS` | No | — | The names the app answers to besides `localhost` (and names under `.localhost`), IP addresses, names under `.local` (the Mac's own network name) and Tailscale names under `.ts.net`, which are always allowed. Comma-separated host names without a port or scheme, such as `durtal.example.com`; each is allowed on any port. A page or API request on any other name answers `421`, so a page that points its own name at the Mac (DNS rebinding) reaches nothing. An entry that is not a host name stops the server at startup. See [05_API_REFERENCE.md](05_API_REFERENCE.md), Host check |
| `APP_TIMEZONE` | No | `Europe/Amsterdam` | IANA time zone the server uses for "today" (default order, shipped and delivered dates; export file names) |
| `ADMIN_TOKEN` | No | — | Token for the bulk media endpoints (`/api/media/reprocess`, `/api/media/backfill-palettes`, `/api/media/apply-crops`), sent as the `x-admin-token` header. Not set: these endpoints refuse every call (SLN-423). Make one with `openssl rand -hex 32` |

### Python Scripts

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL`, `AWS_*`, `S3_BUCKET` | — | — | Same as above |
| `INGEST_EXCEL_PATH` | For ingestion | `~/dev/phantom/.../knowledge_base.xlsx` | Absolute path to `knowledge_base.xlsx` |
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

### `src/lib/catalogue/domains.ts`

The collections and their switches. Each entry of `WORK_DOMAINS` has `enabled`: `false` closes the collection in the app (404 on its pages, no menu, switch or dashboard section) without touching its rows. The database check `works_kind_enabled_check` is changed only by a reviewed activation migration. All four collections are open. See `docs/01_ARCHITECTURE.md`, Collections Open by Switch.

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
