# Durtal — Agent Handover

**Date**: 2026-09-25
**From**: Claude Code session (work account)
**To**: Next agent (Pablo's personal account)
**Repo**: `/Users/pabloaguirre/personal/durtal` (branch `main`)

This document gives you everything you need to continue. Read it fully before you act.

---

## 1. The User

- Pablo Aguirre. Owner of Durtal and of the Helium Mac config.
- Wants short, simple replies. Answer first. Say what you did, if it worked, and what to do next.
- Wants care with his machine config. Ask before anything risky or hard to undo.
- Global instruction: write replies in ASD-STE100 Simplified Technical English (short sentences, active voice, one idea per sentence).
- Develops on two machines:
  - **Rhodium**: NixOS. Uses the Nix flake dev shell through direnv.
  - **MacBook**: configured by **Helium** (`/Users/pabloaguirre/personal/helium`). Homebrew Bundle + chezmoi. No Nix.

---

## 2. The Project: Durtal

A self-hosted, single-user book catalogue ("Radarr for books"). Not a reading tracker.

### Stack

- Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui.
- Drizzle ORM on Neon Postgres. Images on AWS S3 (bronze/silver/gold layers).
- Python 3.12 scripts under `scripts/` (ingestion, TUI, Calibre sync, enrichment). Managed by `uv`.

### Data model (three tiers)

- **Work** (`works`) → **Edition** (`editions`) → **Instance** (`instances`, a physical or digital copy at a location).
- Authors link to works (`work_authors`) and to editions as contributors (`edition_contributors`).
- Ownership is derived, never stored. `catalogue_status` enum: `tracked`, `shortlisted`, `wanted`, `on_order`, `accessioned`, `deaccessioned`.

### Key locations

- `CLAUDE.md`: project rules. Read it first.
- `docs/00_README.md` … `docs/13_CONFIGURATION.md`: specs. `docs/02_DATA_MODEL.md` is the schema reference.
- `changelog/NNNN_TASK_*.md`: one file per task. Also used as the backlog ("Not Started").
- `src/lib/db/schema/`: Drizzle schema (40 tables). `src/lib/db/migrations/`: 21 migrations.
- `src/lib/actions/`: server actions (all database writes).
- `src/app/api/`: REST routes (TUI, S3, external lookups).

### Project rules (from CLAUDE.md)

- Never commit `.env` or `.env.local`.
- Never create docs unless asked. Never add emojis.
- Mention it before you install dependencies.
- Any schema change needs a Drizzle migration AND an update to `docs/02_DATA_MODEL.md`.
- Run `pnpm typecheck` before you call TypeScript work done.
- Create a changelog file for each implementation task (format in `CLAUDE.md`).

### Commands (on the Mac)

```bash
task dev            # dev server on http://localhost:3100
pnpm typecheck      # passes (0 errors)
pnpm test           # 9 files, 194 tests, all pass
pnpm lint
pnpm db:migrate     # nothing pending right now
```

---

## 3. Current State (verified 2026-09-25)

- `pnpm install` done. pnpm self-switches to the pinned `10.26.1`.
- Node on the Mac is Homebrew Node 26 (Docker image uses Node 22). Works fine.
- Typecheck passes. All 194 tests pass. `sharp` loads.
- Docker works through Colima (`colima start` after each reboot).
- `.env` and `.env.local` exist, are identical, and are gitignored. They hold real secrets. Never print or commit them.
  - Set: `DATABASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (eu-north-1), `S3_BUCKET` (durtal), `NEXT_PUBLIC_MAPBOX_TOKEN`, `GOOGLE_PLACES_API_KEY`, `ISBNDN_API_KEY`.
  - Not set (all optional in code): `GOOGLE_BOOKS_API_KEY`, `CALIBRE_WEB_URL`, `NEXT_PUBLIC_APP_URL`, `NODE_ENV`, `INGEST_EXCEL_PATH`, `INGEST_PARQUET_PATH`.
- Database connects: 334 works, 335 editions, 2,080 authors, 174 instances.
- Migrations: Drizzle sees nothing pending. (Bookkeeping oddity: `0000` and `0001` are not recorded in `drizzle.__drizzle_migrations`, but the schema is current. Do not "fix" this without asking.)
- S3: the `durtal-app` IAM user can list the bucket. It cannot call `GetBucketLocation` (not needed by the app).
- Changelog: 110 of 116 older tasks done. Not started: `0020` (occult library import), `0021` (extra editions import). Deferred: `0092`, `0093`, `0095`, `0096`.

---

## 4. What Was Done in This Session

### Durtal (uncommitted)

- `.envrc` changed so direnv loads the Nix flake only when `nix` exists:
  ```bash
  if has nix; then
    use flake
  fi
  ```
  NixOS behaves as before. On the Mac, direnv loads nothing. `flake.nix` and `nix/shell.nix` are unchanged.
- Six new task files added (untracked): `changelog/0116` … `changelog/0121`. See section 5.
- This file, `HANDOVER.md` (untracked). Delete it or keep it out of commits if Pablo prefers.

### Helium (uncommitted)

- `home/dot_Brewfile`: added the Nix shell tools that were missing. Each sits in its matching section, with comments:
  `git-lfs`, `htop`, `ncdu`, `httpie`, `hyperfine`, `go-task`, `typescript-language-server`, `tailwindcss-language-server`, `pnpm`, `awscli`, `colima`, `docker`, `docker-compose`, `docker-buildx`, `lazydocker`, `libpq` (with `link: true`), `gemini-cli`.
  Also reworded the `node` comment (it said "never at runtime", no longer true).
- Deliberately NOT added: `python312` (uv handles it), global `typescript` (Homebrew ships TS 7, projects pin 5.9), `basedpyright` (runs through `uv run`), C libs like `openssl`/`libxml2` (all Python deps have macOS arm64 wheels), `claude-monitor` (no formula).
- IMPORTANT: `home/dot_Brewfile` also contains Pablo's own uncommitted OmniWM edits. Helium has many other uncommitted WIP files. Commit with `git add -p` so only the intended hunks go in.

### Machine changes (outside any repo)

- All the Brewfile packages above are installed. `brew bundle check` passes.
- `~/.docker/config.json` created with `"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]`. Deliberately not managed by chezmoi (Colima and `docker login` write to it).
- `brew link --force libpq` so `psql` is on PATH.
- Deleted a stale cached download (`aerospace@0.12.0`) that crashed `brew cleanup`.
- `linear-sanctum` MCP server added with `--scope local` in the Durtal folder. Status: connected, but the workspace was never confirmed. Pablo abandoned this path. Remove it if not needed:
  ```bash
  cd /Users/pabloaguirre/personal/durtal && claude mcp remove linear-sanctum -s local
  ```

### Incident (resolved)

- `just packages` in Helium upgraded ~35 existing packages, including OmniWM 0.6.8 → 0.7.2, while OmniWM kept running.
- The new `omniwmctl` could not talk to the old app (`protocol_mismatch`). Karabiner shortcuts that use `~/.local/bin/omniwm-shortcut` (Caps+W terminal, etc.) broke.
- Fixed by restarting OmniWM. `omniwmctl ping` returns `pong`.

---

## 5. Open Backlog: Tasks 0116–0121 (to add to Linear)

Linear project: https://linear.app/sanctum-black/project/durtal-cefee8b74c85/overview

Each file in `changelog/` has full detail with file:line pointers. Summary:

| Task | Title | Type | Priority | Root cause |
|---|---|---|---|---|
| 0116 | Media brightness/contrast filter | Feature | MEDIUM | New. Copy the crop pattern: per-media columns, CSS-only, applied at ~15 render sites. Not the same as author monochrome `processing_params`. |
| 0117 | Wizard "Skip copies" still creates an Amsterdam copy | Fix | HIGH | Confirmed. `wizard.tsx` auto-fills Amsterdam into the empty draft on later steps; submit creates any draft with a `locationId`. |
| 0118 | Authors search bar disappears when nothing matches | Fix | MEDIUM | Confirmed. `authors/page.tsx` returns a full-page EmptyState before the shell (toolbar) renders. Same pattern in library, places, series. |
| 0119 | Accent-insensitive, fuzzy author search | Enhancement | HIGH | Confirmed. Plain `ilike` everywhere; no `unaccent`/`pg_trgm`. Pablo wants a sophisticated, ranked search (accents, word order, typos). |
| 0120 | Nationality filter fails for names with commas | Fix | HIGH | Confirmed. URL param is comma-joined and split, so "Hungary, Republic of" becomes two wrong values. |
| 0121 | Authors map: click should show that country's authors | Enhancement | MEDIUM | Partly confirmed. No click handler navigates to a nationality filter. Reproduce first. Depends on 0118 and 0120. |

Links: 0120 causes an empty result, which triggers 0118. 0121 depends on both.

Data check to do: books added with "Skip copies" may already have a wrong Amsterdam instance.

---

## 6. Other Open Items

1. **Commit the changes** (ask Pablo first):
   - Durtal: `.envrc` and `changelog/0116`–`0121`.
   - Helium: only the Brewfile hunks from this session (`git add -p home/dot_Brewfile`).
2. **Docs are out of date** (fix only if asked):
   - `CLAUDE.md` says `catalogue_status='catalogued'`; code uses `accessioned`. Some doc examples still use `catalogued` / `wishlist`.
   - `docs/02_DATA_MODEL.md` lacks `taxonomy_families`, `custom_taxonomy_items` and their junction tables (task 0115). This breaks the CLAUDE.md rule.
   - `docs/04_ROUTES_AND_VIEWS.md` lists `/tags` and `/subjects`; misses `/places`, `/provenance`, `/reader`, `/taxonomy`.
   - Docs say Next.js 15; code is Next.js 16.
   - `docs/12_DEVELOPMENT.md` refers to `docs/01_SPECS.md`, which does not exist. It also describes the Nix/direnv setup only.
3. **Optional Helium fix**: in `home/dot_local/bin/executable_omniwm-shortcut`, the second `jq` call in `open_ghostty_next_to_focus` has no `// empty` guard. When OmniWM does not answer, `set -eu` stops the script before Ghostty opens. A guard would keep the terminal shortcut working. Pablo has not approved this yet.

---

## 7. Warnings (read these)

- **Helium**: never run `just apply` (it applies Pablo's uncommitted WIP dotfiles). Do not use `just packages` just to install new tools: it also upgrades everything. Use:
  ```bash
  brew bundle --no-upgrade --file /Users/pabloaguirre/personal/helium/home/dot_Brewfile
  ```
- **OmniWM**: if Homebrew ever upgrades it, quit and reopen it, then check:
  ```bash
  osascript -e 'quit app "OmniWM"'
  open -a OmniWM
  omniwmctl ping
  ```
- **Secrets**: `.env` / `.env.local` hold live Neon, AWS, Mapbox and Google keys. Never print, log or commit them.
- **Database**: it is the live Neon database. Never run destructive queries or migrations without asking.
- **Docker**: run `colima start` after a reboot before any `docker` command.
- The pnpm "Ignored build scripts" warning is safe: `sharp` works without its script.
