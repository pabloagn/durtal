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

Every page that reads from the database uses `export const dynamic = "force-dynamic"`. This ensures fresh data on every request. There is no ISR or static generation — the catalogue changes frequently and stale data is unacceptable.

### Cascading Deletes

Foreign keys use `onDelete: "cascade"` throughout the schema. Deleting a work removes all its editions; deleting an edition removes all its instances. This matches the domain model: if a work does not exist, neither do its publications or copies.

### Singleton Database Connection

The Drizzle database client uses a module-level singleton pattern (stored on `globalThis` in development to survive HMR). This prevents connection pool exhaustion during development.
