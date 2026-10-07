# Architecture

## System Overview

```
                            Internet
                               |
                          [ Cloudflare ]
                               |
                          [ Tailscale ]
                               |
                     +---------+---------+
                     |   osmium.rh host  |
                     |                   |
                     |  [ Traefik ]      |
                     |       |           |
                     |  [ Authelia ]     |
                     |       |           |
                     |  [ Durtal ]       |
                     |    :3000          |
                     +---------+---------+
                          |         |
                +---------+         +---------+
                |                             |
          [ Neon Postgres ]            [ AWS S3 ]
           (external DB)              (eu-central-1)
                                           |
                                    +-----------+
                                    |  bronze/  |  raw uploads
                                    |  silver/  |  validated/parsed
                                    |  gold/    |  production-ready
                                    +-----------+
```

All traffic enters through Cloudflare DNS, routes over Tailscale, and hits Traefik on the homelab host. Traefik forwards to the Durtal container after Authelia confirms the user's SSO session.

The application connects to two external services:
- **Neon** (PostgreSQL) — Over the internet via connection string with SSL.
- **AWS S3** — Over the internet via IAM credentials. Bucket organized in medallion layers.

---

## Application Layers

```
Browser
  |
  v
Next.js App Router
  |
  +--> Pages (Server Components)
  |      |
  |      +--> Server Actions (lib/actions/)
  |      |      |
  |      |      +--> Drizzle ORM --> Neon Postgres
  |      |      +--> S3 Client  --> AWS S3
  |      |
  |      +--> Client Components (components/)
  |             |
  |             +--> API Routes (app/api/) --> External APIs
  |
  +--> API Routes (REST)
         |
         +--> Google Books API
         +--> Open Library API
         +--> Nominatim (OpenStreetMap)
```

### Layer Responsibilities

| Layer | Location | Role |
|---|---|---|
| **Pages** | `src/app/*/page.tsx` | Server-rendered routes. Fetch data via server actions, compose UI from components. |
| **Server Actions** | `src/lib/actions/*.ts` | Business logic layer. All database operations go through here. Marked with `"use server"`. |
| **API Routes** | `src/app/api/*/route.ts` | REST endpoints for external API proxying, S3 pre-signing, and data consumed by the TUI. |
| **Components** | `src/components/` | UI layer. Server components for static rendering, client components for interactivity. |
| **Database** | `src/lib/db/` | Drizzle ORM schema definitions, connection management, migrations. |
| **S3** | `src/lib/s3/` | S3 client, key generation, image processing pipelines. |
| **External APIs** | `src/lib/api/` | HTTP clients for Google Books and Open Library. |
| **Validations** | `src/lib/validations/` | Zod schemas for all input validation. |
| **Types** | `src/lib/types/` | Shared TypeScript type definitions and enums. |

---

## Tech Stack Rationale

### Why Next.js Over Plain Node.js

Next.js is Node.js. It runs on the Node.js runtime but adds: file-based routing, React Server Components, server actions (RPC-like mutations), SSR/SSG, API routes, image optimization, and middleware. Using "plain Node.js" (Express/Fastify) would require building the frontend separately, losing SSR, and manually wiring what Next.js provides out of the box.

The App Router provides server components by default, which means database queries execute on the server without exposing connection strings or query logic to the client. Server actions eliminate the need for a separate API layer for CRUD operations — the component calls a function, and the function runs on the server.

The `standalone` output mode produces a minimal production build that can be containerized without shipping `node_modules`.

### Drizzle ORM over Prisma

Drizzle generates SQL that maps 1:1 to the TypeScript schema definitions. No binary engine, no runtime overhead. The relational query API (`db.query.works.findMany({ with: {...} })`) provides type-safe eager loading without raw SQL.

Schema changes produce SQL migration files that can be reviewed before applying.

### Neon (Serverless PostgreSQL)

Neon provides a PostgreSQL database accessible over HTTP, which aligns with the serverless execution model of Next.js server components and server actions. The HTTP driver (`@neondatabase/serverless`) avoids maintaining persistent TCP connections in a request/response environment.

The HTTP driver has no interactive transactions (`db.transaction()` throws). Writes that must succeed or fail together go through `atomic()` in `src/lib/db/atomic.ts`, which sends them as one `db.batch()` (Neon runs a batch as a single transaction; a local Postgres in tests runs the same queries in `db.transaction()`). Do every read and check first, give new rows their ids and slugs up front (`randomUUID()`, `uniqueSlug()`), upload any cover, then build every write inside `atomic((d) => [...])` without awaiting it. A failed write deletes the uploaded cover. The book writes share these plans in `src/lib/catalogue/book-store.ts`: the add-book wizard (`createBookFromWizard`), fast track, a new edition, and an order for a book not yet in the library each save in one write.

### Tailwind CSS 4

Version 4 replaces `tailwind.config.ts` with CSS-based configuration via `@theme` blocks. All design tokens (colors, fonts, radii) are defined in `src/styles/globals.css` as CSS custom properties, making the design system the single source of truth.

### AWS S3 with Medallion Architecture

All user-uploaded and API-fetched images flow through three tiers:
- **Bronze** — Raw uploads, unprocessed.
- **Silver** — Validated, parsed, conflict-checked.
- **Gold** — Production-ready (resized, converted to WebP, thumbnailed).

This prevents raw user data from ever reaching the UI and provides an audit trail for imports.

### Why Not Python for the Backend

The original brief mentioned Python for the backend. After analysis: Next.js API routes handle all server-side logic (metadata fetching, S3 operations, database queries, CSV parsing). Adding Python would mean two containers, two languages, inter-service communication overhead, and no tangible benefit. The medallion ETL pipeline is implemented in TypeScript within Next.js API routes — the data volumes (personal library, not millions of records) do not justify a separate data processing service.

### Python for Ingestion and TUI

The seed data pipeline (Excel parsing, data transformation, deduplication) and the terminal UI are better suited to Python than TypeScript. The source files are an Excel workbook (32 sheets, complex cross-references) and a Parquet file. Python with pandas + openpyxl is the correct tool for this kind of structured data wrangling. The scripts live in the durtal repo under `scripts/` but are development tools, not production code. Python also provides `textual` for the TUI — none of these have equivalent quality in the Node.js ecosystem.

---

## Key Dependencies

### Runtime

| Package | Version | Purpose |
|---|---|---|
| `next` | 15.x | Application framework |
| `react` / `react-dom` | 19.x | UI library |
| `typescript` | 5.x | Type safety |
| `tailwindcss` | 4.x | Utility-first CSS |
| `drizzle-orm` | latest | Database ORM |
| `@neondatabase/serverless` | latest | Neon PostgreSQL HTTP driver |
| `@aws-sdk/client-s3` | latest | S3 operations |
| `@aws-sdk/s3-request-presigner` | latest | Pre-signed URL generation |
| `sharp` | latest | Image processing (resize, WebP) |
| `zod` | latest | Schema validation |
| `cmdk` | latest | Command palette (`Cmd+K`) |
| `lucide-react` | latest | Icons (1.5px stroke, 16px) |
| `sonner` | latest | Toast notifications |

### Development

| Package | Version | Purpose |
|---|---|---|
| `drizzle-kit` | latest | Schema migrations CLI |
| `eslint` | latest | Linting |
| `@types/*` | latest | TypeScript definitions |

### Python (Ingestion & TUI)

| Package | Purpose |
|---|---|
| `pandas` | Data manipulation for ETL |
| `openpyxl` | Excel file reading |
| `pyarrow` | Parquet file reading |
| `psycopg2-binary` | PostgreSQL connection to Neon |
| `pydantic` | Data validation models |
| `click` | CLI interface |
| `httpx` | HTTP client (API enrichment + TUI) |
| `pillow` | Image processing for covers |
| `boto3` | S3 upload for covers |
| `python-dotenv` | Environment variable loading |
| `rich` | Console output formatting |
| `textual` | Terminal UI framework |

---

## Architectural Decisions

### No Authentication Layer in Application Code

Durtal is a single-user application. Authentication is handled externally by Authelia, which gates access at the reverse proxy level. No auth middleware, no session management, no user model exists in the codebase. If Authelia's SSO session is valid, the request reaches Durtal. If not, Authelia redirects to login.

### Server Actions over API Routes for CRUD

All create, read, update, and delete operations use Next.js server actions (`"use server"` functions). API routes exist only for:
- External API proxying (search, geocode)
- S3 pre-signed URL generation
- Endpoints consumed by the Python TUI
- Health checks

This keeps the data layer colocated with the UI layer and eliminates HTTP serialization overhead for server-rendered pages.

### Force-Dynamic on All Data Pages

The root layout (`src/app/layout.tsx`) sets `export const dynamic = "force-dynamic"`, so every page renders per request. This ensures fresh data on every request. There is no ISR or static generation — the catalogue changes frequently and stale data is unacceptable. It also keeps `next build` free of database credentials (the Docker build has none).

Guard: `getDb()` (`src/lib/db/index.ts`) throws when called during `next build` (`NEXT_PHASE === "phase-production-build"`). A route that starts pre-rendering with build-time data fails the build instead.

Reference data read through `cached()` (`src/lib/cache.ts`, `unstable_cache` with tags) is still cached per request; the matching server actions invalidate its tags.

### Collections Open by Switch

Books, perfumes, films and paintings share the `works` table, told apart by `works.kind`. Each collection is an entry in `WORK_DOMAINS` (`src/lib/catalogue/domains.ts`): its labels, routes, capabilities and an `enabled` switch. Navigation, menus, search, the dashboard and every collection page read `getEnabledWorkKinds()` and `canUseWorkCapability()`, so a closed collection answers 404 and no page names it. The database has its own gate: `works_kind_enabled_check` lists the kinds a row may have, and only an activation migration widens it (`0053_open_perfumes`, `0054_film_kind_enabled`, `0055_open_paintings`). A collection opens when both say so; closing one is the switch alone, so its rows stay valid and come back when it opens again (see `docs/11_DEPLOYMENT.md`, Release order and Rolling back a collection).

### Book Enrichment Job Queue

Book enrichment (SLN-460) runs its stages from a queue that is a database table, `enrichment_jobs`, not a queue service. A job is one stage of work on one book (identity, facts, length, popularity, research, extract). A worker claims the next job with one `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)` statement, because the app's Neon HTTP driver has no interactive transactions; two workers never get the same job, and a lease abandoned for 30 minutes is claimed again. The worker is a script run by hand on the Mac, not a server process: `scripts/enrichment/worker.ts` (SLN-464), which only parses flags; its logic is in `src/lib/enrichment/worker.ts`, and a test keeps SQL out of the scripts. Each job kind has a stage (`ENRICHMENT_STAGES`, `src/lib/enrichment/stages.ts`) that fetches source answers into a cache file, plans a job from it, writes the plan, and undoes its own writes. A run plans by default on a read-only session. With `--apply --backup FILE` (a pg_dump from the last hour) it releases the quota, rate-limit and budget holds of its kinds, runs each stage's steps, then claims and writes its jobs one at a time, each in its own transaction, under a worker id unique to the run; while a write runs, a heartbeat on a second connection renews the job's lease every 5 minutes. A source refusal during the fetch writes no job. `--undo RUN_ID` undoes a run's applies, newest first, and each stage's own writes. `--enqueue KIND --scope owned|on_order|wanted|all` queues a scope (`all` puts each book at its own scope's priority; a research scope skips books already researched, and `--only` names one again). The identity stage (SLN-464) is the first registered: it links books to their Open Library work, Wikidata item, OCLC work ID and edition LCCNs (docs/02, Book enrichment), and its steps run Pablo's review file, sweep the exact claims the daily cap held back and queue again the books whose QID was accepted. `--enable-identity-rules --dimensions KEY,… --approval URL` turns on the exact-match rules Pablo approved (with `--apply --backup`); `--disable-identity-rules` turns them off at once. The research stage (SLN-469) searches and stores pages in its `work` step, between a job's claim and its write, outside any transaction; a refusal of both search providers, the monthly budget or the book's cost ceiling holds the job without an attempt, and a plan makes no search, fetch or write. The extract stage (SLN-469) sends each stored document's passages to the extraction model in its `work` step, through the cost meter, and writes the extraction rows and the `agent` claims in the job's transaction; its step queues again the books a vocabulary change touches, and the run after works them. `--determinism-check N` sends N cached requests again and compares the answers (paid: with `--apply --backup` only). New books queue their identity and research jobs after their save (`queueNewBookEnrichment`, `src/lib/enrichment/queue.ts`). The queue functions are in `src/lib/enrichment/jobs.ts`.
||||||| parent of 1fd91b33 (SLN-469 PR 2: the extract stage, the extraction model and the extractions table (migration 0080))
Book enrichment (SLN-460) runs its stages from a queue that is a database table, `enrichment_jobs`, not a queue service. A job is one stage of work on one book (identity, facts, length, popularity, research, extract). A worker claims the next job with one `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)` statement, because the app's Neon HTTP driver has no interactive transactions; two workers never get the same job, and a lease abandoned for 30 minutes is claimed again. The worker is a script run by hand on the Mac, not a server process: `scripts/enrichment/worker.ts` (SLN-464), which only parses flags; its logic is in `src/lib/enrichment/worker.ts`, and a test keeps SQL out of the scripts. Each job kind has a stage (`ENRICHMENT_STAGES`, `src/lib/enrichment/stages.ts`) that fetches source answers into a cache file, plans a job from it, writes the plan, and undoes its own writes. A run plans by default on a read-only session. With `--apply --backup FILE` (a pg_dump from the last hour) it releases the quota, rate-limit and budget holds of its kinds, runs each stage's steps, then claims and writes its jobs one at a time, each in its own transaction, under a worker id unique to the run; while a write runs, a heartbeat on a second connection renews the job's lease every 5 minutes. A source refusal during the fetch writes no job. `--undo RUN_ID` undoes a run's applies, newest first, and each stage's own writes. `--enqueue KIND --scope owned|on_order|wanted` queues a scope. The identity stage (SLN-464) is the first registered: it links books to their Open Library work, Wikidata item, OCLC work ID and edition LCCNs (docs/02, Book enrichment), and its steps run Pablo's review file, sweep the exact claims the daily cap held back and queue again the books whose QID was accepted. `--enable-identity-rules --dimensions KEY,… --approval URL` turns on the exact-match rules Pablo approved (with `--apply --backup`); `--disable-identity-rules` turns them off at once. The research stage (SLN-469) searches and stores pages in its `work` step, between a job's claim and its write, outside any transaction; a refusal of both search providers, the monthly budget or the book's cost ceiling holds the job without an attempt, and a plan makes no search, fetch or write. New books queue their identity job after their save (`queueNewBookEnrichment`, `src/lib/enrichment/queue.ts`). The queue functions are in `src/lib/enrichment/jobs.ts`.

### Cascading Deletes

Foreign keys use `onDelete: "cascade"` throughout the schema. Deleting a work removes all its editions; deleting an edition removes all its instances. This matches the domain model: if a work does not exist, neither do its publications or copies.

### Singleton Database Connection

The Drizzle database client uses a module-level singleton pattern (stored on `globalThis` in development to survive HMR). This prevents connection pool exhaustion during development.
