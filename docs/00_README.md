# Durtal

Durtal is a self-hosted personal book catalogue and library index. It serves as the single source of truth for every book in the owner's collection — physical and digital, across multiple geographic locations.

Think Radarr/Sonarr for books: a comprehensive index with full metadata, ownership tracking, location management, and a world-class interface. No reading tracker, no social features, no automated downloading. An obsessively organized catalogue.

The name references Durtal, the protagonist of Joris-Karl Huysmans' tetralogy — a character who moves through decadence, occultism, and monastic discipline. This informs the application's aesthetic: an occult library rendered in clean, modern design language.

---

## Core Concept

A book enters Durtal one of three ways:

1. **ISBN Lookup** — Enter an ISBN or search by title/author. Durtal fetches metadata from external APIs (Google Books, Open Library), populates all fields, and downloads the cover. Like Radarr matching against TMDB. Review and confirm.
2. **Manual Entry** — Fill in all fields by hand. For rare, out-of-print, or unindexed books.
3. **Bulk Import** — Upload a Goodreads CSV export, Calibre library export, or custom CSV. Data flows through the S3 medallion pipeline: raw file lands in bronze, gets parsed and cleaned in silver, and loads into the production database from gold.

Once catalogued, the user assigns the book to one or more locations (physical or digital) and sets its status. The UI provides instant filtering, search, and visualization across the entire library.

---

## Data Architecture

Durtal uses a three-tier data model drawn from library science (FRBR):

| Tier | Table | Represents | Example |
|---|---|---|---|
| **Work** | `works` | The abstract intellectual creation | "Don Quixote" |
| **Edition** | `editions` | A specific publication with its own ISBN, translator, publisher | The 2003 Penguin Classics English translation |
| **Instance** | `instances` | A physical or digital copy at a specific location | My hardcover on the Amsterdam shelf |

This structure correctly handles: the same ISBN existing in multiple locations, multiple translations of the same novel, and the distinction between original publication date and edition publication date.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) |
| UI | React 19, Tailwind CSS 4, shadcn/ui |
| ORM | Drizzle ORM |
| Database | Neon (serverless PostgreSQL) |
| Storage | AWS S3 (medallion architecture) |
| Containerization | Docker (multi-stage build) |
| Reverse Proxy | Traefik |
| Auth | Authelia (SSO) |
| Access | Tailscale mesh network |
| Scripts | Python 3.12 (ingestion, TUI) |

---

## Quick Start

### Prerequisites

- [Nix](https://nixos.org/) with flakes enabled (provides all tooling via `flake.nix`)
- Alternatively: Node.js 22, pnpm 10, Python 3.12, uv

### Setup

```bash
# Clone and enter dev shell
cd durtal
direnv allow          # Activates Nix dev shell automatically

# Install dependencies
pnpm install          # Node.js / Next.js
uv sync               # Python ingestion scripts

# Configure environment
cp .env.example .env.local
# Edit .env.local with your Neon, S3, and API credentials

# Set up database
pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Apply migrations to Neon

# Run
pnpm dev              # Start dev server at http://localhost:3000
```

### Common Commands

```bash
pnpm dev              # Development server (Turbopack)
pnpm build            # Production build
pnpm typecheck        # TypeScript type checking
pnpm lint             # ESLint
pnpm db:studio        # Drizzle Studio (database browser)
task tui              # Launch terminal UI
```

See [12_DEVELOPMENT.md](12_DEVELOPMENT.md) for the full command reference.

---

## Documentation Index

| Document | Contents |
|---|---|
| [01_ARCHITECTURE.md](01_ARCHITECTURE.md) | Tech stack rationale, system topology, application layers |
| [02_DATA_MODEL.md](02_DATA_MODEL.md) | Three-tier model, all tables, relationships, derived status logic, example queries |
| [03_DESIGN_LANGUAGE.md](03_DESIGN_LANGUAGE.md) | Color palette, typography, spatial system, component patterns, iconography |
| [04_ROUTES_AND_VIEWS.md](04_ROUTES_AND_VIEWS.md) | Application routes, page-by-page UI descriptions, navigation |
| [05_API_REFERENCE.md](05_API_REFERENCE.md) | REST API endpoints: methods, parameters, payloads, responses |
| [06_SERVER_ACTIONS.md](06_SERVER_ACTIONS.md) | Server-side business logic: every action by module |
| [07_STORAGE.md](07_STORAGE.md) | S3 medallion architecture, cover and media pipelines |
| [08_EXTERNAL_INTEGRATIONS.md](08_EXTERNAL_INTEGRATIONS.md) | Google Books, Open Library, Nominatim geocoding, Calibre-Web |
| [09_INGESTION_PIPELINE.md](09_INGESTION_PIPELINE.md) | Python ETL: source files, field mappings, execution order |
| [10_TUI.md](10_TUI.md) | Terminal UI: screens, widgets, API client |
| [11_DEPLOYMENT.md](11_DEPLOYMENT.md) | Docker, CI/CD, osmium.rh, Traefik, Authelia, Tailscale |
| [12_DEVELOPMENT.md](12_DEVELOPMENT.md) | Nix environment, project structure, commands, dependencies |
| [13_CONFIGURATION.md](13_CONFIGURATION.md) | Environment variables, config files, Taskfile |

---

## Non-Goals

Explicitly out of scope:

- **Reading tracker** — Goodreads handles this. Durtal is a catalogue, not a reading log.
- **Social features** — No friends, no feed, no sharing. Single user.
- **Book recommendations** — No ML, no "you might like". This is an index.
- **Automated downloading** — No integration with book download services. This is not Readarr.
- **E-reader sync** — No Kobo/Kindle sync. Calibre-Web handles OPDS/Kobo.
- **Multi-user** — Single owner. Authelia provides the auth gate.
- **Mobile app** — Responsive web only. PWA if needed later.
- **Light mode** — Dark mode only. No theme toggle.

---

## Success Criteria

1. Add a book by ISBN and see it fully populated with metadata and cover within 3 seconds.
2. Assign a book to one or more physical/digital locations with a single interaction.
3. Filter the entire catalogue by any combination of: location, status, genre, author, tag, format.
4. Import a Goodreads CSV through the medallion pipeline with conflict resolution.
5. Responsive and usable on mobile, tablet, and desktop.
6. Docker image builds and deploys via GitHub Actions to osmium.rh with zero manual intervention after push to `main`.
7. The interface looks and feels like it belongs alongside Linear and the personal website — dark, typographic, precise, quietly unsettling.
