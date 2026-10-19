# Deployment

Durtal runs on one Mac. The live app is the standalone release on 127.0.0.1:3110, which launchd runs as `com.durtal.production` through `scripts/deploy/runtime_launcher.py`, with the live Neon database and S3. The development server on http://localhost:3100 runs from the main checkout (`~/personal/durtal`) and is not the live app. A release is the order below. The Docker image further down is what CI builds on every pull request to prove the Dockerfile works; no host runs it today, and the homelab sections (osmium.rh) describe a setup that is not in use.

---

## Release order

A release takes these steps in this order (SLN-382). A step that fails stops the release. The old release keeps serving until step 11. `mac_release.py` is `scripts/deploy/mac_release.py` and `live_migrate.py` is `scripts/deploy/live_migrate.py` (SLN-1318). Each `live_migrate.py` step leaves a private receipt in a new folder under `--receipts`, which never lives under /tmp or /private/tmp.

1. **Merge.** The pull request is green in CI: lint, typecheck, the full test suite with its database suites (`pnpm test:local`) and the Docker image build.
2. **Update the main checkout.** Fast-forward `~/personal/durtal` to `origin/main`, only when its uncommitted files do not overlap the change.
3. **Prepare.** `mac_release.py prepare --repo REPO --commit SHA --destination DIR --node NODE --pnpm PNPM --public-inputs FILE` archives that exact commit into a new private folder outside the checkout, pinned to Node 22 and pnpm 10.26.1.
4. **Build.** `mac_release.py build --directory DIR --allow-build` installs with the frozen lockfile and runs `pnpm build` with no database URL and no secrets.
5. **Package.** `mac_release.py package --directory DIR --destination RELEASE --retain CURRENT` copies the standalone server, its static and public files and the deploy tools, keeps the current release's served assets, and writes a hash manifest. `mac_release.py verify --release RELEASE` checks it.
6. **Back up.** Every release, since step 10 needs the migration evidence that step 9 writes even with nothing pending: `live_migrate.py backup --config CONFIG --config-sha256 SHA --receipts DIR` dumps the live database (pg_dump 16, custom format, as Backups, Recovery and Rollback says under Database) and refuses an empty or unreadable dump. When a step deletes or overwrites files in S3, refresh the bucket's copy first (same section, Files).
7. **Rehearse.** `live_migrate.py rehearse --preparation DIR --backup RECEIPT --receipts DIR` restores that dump into a throwaway local postgres:16, applies the pending migrations there and reads the ledger back, with no live connection. `python3 scripts/qa/preview-local.py --from-dump FILE` restores the same dump and prints the tables whose rows changed: only the tables the release names may change. A dump that does not restore stops the release.
8. **Check the numbering.** Each new migration's `when` in `src/lib/db/migrations/meta/_journal.json` is later than the last one applied on live (`drizzle.__drizzle_migrations`); the migrator skips an older one silently.
9. **Migrate.** The commit prepared in step 3 must be on `origin/main`: `migrate` applies that archive's journal, wherever it is run from, and an apply from a branch can make a later merge skip another branch's migration. `live_migrate.py migrate --config CONFIG --config-sha256 SHA --preparation DIR --rehearsal RECEIPT --receipts DIR` applies the journal entries the live ledger lacks, in order and in one transaction, and runs only with a backup under an hour old whose rehearsal passed against exactly the ledger live still has. With nothing pending it ends as NOTHING_PENDING and still writes `live-migrations.json`, the evidence step 10 needs. `live_migrate.py status` names the pending migrations. `pnpm db:migrate` cannot reach Neon over TLS from the Mac.
10. **Plan the switch.** `mac_release.py launchd-plan --config CONFIG --output NEW_PLIST` writes the new release's plist. `mac_release.py transition-plan --current CURRENT --target RELEASE --compatibility FILE --live-migrations FILE` refuses unless the new release keeps the served assets and a reviewed compatibility attestation is supplied. Neither installs or starts anything. Keep the current release's plist: it is the way back.
11. **Switch.** `mac_release.py switch --current-plist CURRENT --target-plist NEW_PLIST --receipts DIR` (SLN-1319) refuses unless the current release is the one serving. It stops the running `com.durtal.production` job, waits up to 60 s for the port to free, loads the new plist and waits up to 180 s for the new release to serve. If it doesn't, the switch stops it and loads the current plist again, and says so. Either way it writes a receipt. The launcher verifies the release again before it starts `node server.js`.
12. **Data steps.** The steps the release names, on the new release, each checked first without writing (for example a reading import's preview at `/reading/import/<id>` before its commit). Catalogue changes go through the REST API, never through SQL.
13. **Verify.** The changed pages on 127.0.0.1:3110, `node scripts/qa/page-weight.js http://127.0.0.1:3110`, and the release's own checks.

A collection (perfumes, films, paintings, a new one) opens only when its gates pass: its switch in `src/lib/catalogue/domains.ts` (`enabled`) and, for a new kind, the activation migration that widens `works_kind_enabled_check` ship together. Closing one again is a code change only (Rolling back a collection, below).

---

## Docker Image

### Multi-Stage Build

The Dockerfile produces a minimal production image in three stages:

```
Stage 1: deps      Node 22 Alpine  → Install node_modules (pnpm, frozen lockfile)
Stage 2: builder   Node 22 Alpine  → Next.js production build (standalone output)
Stage 3: runner    Node 22 Alpine  → Copy standalone output only (~150MB final image)
```

**Stage 1 (deps)**:
- Base: `node:22-alpine`
- Installs `libc6-compat` for Alpine compatibility
- Copies `package.json` and `pnpm-lock.yaml`
- Runs `pnpm install --frozen-lockfile`

**Stage 2 (builder)**:
- Copies `node_modules` from stage 1
- Copies full source
- Disables Next.js telemetry
- Runs `pnpm build`

**Stage 3 (runner)**:
- Creates non-root user `nextjs` (uid 1001)
- Copies only: `public/`, `.next/standalone/`, `.next/static/`
- Exposes port 3000
- Runs `node server.js`

### Build Commands

Secrets are runtime-only. `.dockerignore` keeps every `.env*` file at any depth (and `.git`, docs, Python scripts) out of the build context, and no page reads the database at build time, so the image contains no credentials. The only build argument is the public, browser-visible `NEXT_PUBLIC_MAPBOX_TOKEN`, which Next.js inlines into the client bundle.

```bash
# Local build (the Mapbox token is read from the shell environment)
docker build --build-arg NEXT_PUBLIC_MAPBOX_TOKEN -t durtal:latest .

# Run locally: secrets are passed when the container starts
docker run --rm -p 3000:3000 --env-file .env.local durtal:latest

# Via Taskfile
task docker:build
task docker:run
```

### Local Development Compose

`docker-compose.yml` provides a local development container:

```yaml
services:
  durtal:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        - NEXT_PUBLIC_MAPBOX_TOKEN=${NEXT_PUBLIC_MAPBOX_TOKEN}
    container_name: durtal-dev
    ports:
      - "3100:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - AWS_REGION=${AWS_REGION}
      - S3_BUCKET=${S3_BUCKET}
      - EBOOKS_BUCKET=${EBOOKS_BUCKET}
      - EBOOKS_PREFIX=${EBOOKS_PREFIX}
      - EBOOKS_REGION=${EBOOKS_REGION}
      - EBOOK_DELIVERY=${EBOOK_DELIVERY}
      - EBOOK_CDN_URL=${EBOOK_CDN_URL}
      - EBOOK_CDN_KEY_PAIR_ID=${EBOOK_CDN_KEY_PAIR_ID}
      - EBOOK_CDN_PRIVATE_KEY=${EBOOK_CDN_PRIVATE_KEY}
      - GOOGLE_BOOKS_API_KEY=${GOOGLE_BOOKS_API_KEY}
      - GOOGLE_PLACES_API_KEY=${GOOGLE_PLACES_API_KEY}
      - ISBNDB_API_KEY=${ISBNDB_API_KEY}
      - ISBNDN_API_KEY=${ISBNDN_API_KEY} # old name, accepted for one release
      - ADMIN_TOKEN=${ADMIN_TOKEN}
      - DURTAL_API_TOKEN=${DURTAL_API_TOKEN}
      - NODE_ENV=production
    restart: unless-stopped
```

### Admin Token

Three media maintenance routes rewrite S3 files and media rows in bulk: `POST /api/media/reprocess`, `POST /api/media/apply-crops` and `POST /api/media/backfill-palettes`. They run only with the `x-admin-token` header set to `ADMIN_TOKEN`.

| `ADMIN_TOKEN` | Answer |
|---|---|
| Not set | 503, the routes are disabled |
| Set, header missing or wrong | 401 |
| Set, header matches | The route runs |

Make a token with `openssl rand -hex 32` and put it in `.env.local` (never commit it). Restart the server so it reads the new value. Settings, Integrations shows whether it is set. Call a route like this:

```bash
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3100/api/media/backfill-palettes
```

---

## CI/CD Pipeline

`.github/workflows/ci.yml` runs on every pull request, every push to `main` and every `v*` tag:

```
GitHub (pull request, push to main, v* tag)
  |
  +---> lint     ESLint + type check (tsc)
  +---> test     python3 scripts/qa/test-local.py: the Python book import tests
  |              and every Vitest suite, including the database suites, against
  |              a disposable postgres:16 container
  +---> docker   Build the Docker image (after lint and test pass). Not pushed.
```

The workflow needs no secrets. Durtal runs only on the owner's Mac, so there is no registry to push to and no host to deploy. Add a push step (for example to GHCR) only when a remote host exists.

---

## osmium.rh Integration

Durtal runs as part of the homelab stack on osmium.rh.

### Stack Location

```
/home/pabloagn/dev/osmium.rh/stacks/libraries/durtal/compose.yml
```

### Compose Configuration

```yaml
services:
  durtal:
    image: registry.{DOMAIN}/durtal:latest
    container_name: durtal
    restart: unless-stopped
    networks:
      - proxy
    environment:
      - DATABASE_URL=${DURTAL_DATABASE_URL}
      - AWS_ACCESS_KEY_ID=${DURTAL_AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${DURTAL_AWS_SECRET_ACCESS_KEY}
      - AWS_REGION=${DURTAL_AWS_REGION}
      - S3_BUCKET=${DURTAL_S3_BUCKET}
      - GOOGLE_BOOKS_API_KEY=${DURTAL_GOOGLE_BOOKS_API_KEY}
      # The public name: any other name answers 421 (docs/13)
      - DURTAL_ALLOWED_HOSTS=${SUBDOMAIN_DURTAL}.${DOMAIN}
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.durtal.rule=Host(`${SUBDOMAIN_DURTAL}.${DOMAIN}`)"
      - "traefik.http.routers.durtal.entrypoints=websecure"
      - "traefik.http.routers.durtal.middlewares=authelia@docker"
      - "traefik.http.services.durtal.loadbalancer.server.port=3000"
      - "homepage.group=Libraries"
      - "homepage.name=Durtal"
      - "homepage.icon=book.svg"
      - "homepage.href=https://${SUBDOMAIN_DURTAL}.${DOMAIN}"
      - "homepage.description=Book Catalogue"
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Network Topology

```
Internet --> Cloudflare DNS --> Tailscale --> Traefik --> Authelia --> Durtal (:3000)
```

- **Traefik**: Reverse proxy with automatic HTTPS via Let's Encrypt. Routes `library.{DOMAIN}` to the Durtal container.
- **Authelia**: SSO middleware. All requests must have a valid session before reaching Durtal. No auth logic in the application itself.
- **Tailscale**: Mesh VPN. All traffic between Cloudflare and the host stays on the Tailscale network. The registry is only accessible within the mesh.
- **Homepage**: Dashboard integration via Docker labels. Durtal appears under "Libraries" group.

### Phone shortcuts

The iPhone Shortcuts of docs/05 (Readings) call `/api/readings` with only the bearer token. A Shortcut has no Authelia session, so behind Authelia it would get the login redirect. One access-control rule lets these paths through, on the Durtal host only, with the host reachable only over Tailscale:

```yaml
# Authelia configuration.yml, access_control.rules, above the rule that covers the Durtal host
access_control:
  rules:
    - domain: "${SUBDOMAIN_DURTAL}.${DOMAIN}"
      resources:
        - "^/api/readings([/?].*)?$"
      policy: bypass
```

Every `/api/readings` route checks `DURTAL_API_TOKEN` itself, GETs included, so the token stays their lock: without `DURTAL_API_TOKEN` they answer `503`, with a wrong token `401`. The rule is homelab configuration outside this repo; the app never changes it.

On the Mac (no Traefik, no Authelia) no rule is needed. The development server on :3100 listens on every interface, so a phone on the same network calls `http://<Mac name>.local:3100`, and a phone elsewhere needs the Mac on the same tailnet. The live release listens on 127.0.0.1:3110 only and is reached through the Mac's private Tailscale HTTPS (changelog 0448).

### Health Check

The container uses `wget` to probe `GET /api/health` every 30 seconds. The endpoint returns:

```json
{ "status": "ok", "service": "durtal", "timestamp": "..." }
```

Start period of 40 seconds allows for Next.js cold start.

---

## Infrastructure Prerequisites

The following external resources must be created before deployment:

| # | Resource | Service | Details |
|---|---|---|---|
| 1 | Neon database | Neon | Create project `durtal`, database `durtal`, get connection string |
| 2 | S3 bucket | AWS | Create bucket `durtal` in `eu-north-1`, configure CORS for app domain; the e-book bucket and CloudFront: [eBook storage](#ebook-storage) |
| 3 | IAM user | AWS | Create user `durtal-app` with S3 read/write policy scoped to `durtal` bucket |
| 4 | Google Books API key | Google Cloud | Enable Books API, create API key, restrict to server IP |
| 5 | GitHub repo | GitHub | Create `pabloagn/durtal`, configure Actions secrets |
| 6 | Registry access | osmium.rh | Ensure Tailscale GitHub Action can reach registry, or configure GHCR fallback |
| 7 | DNS record | Cloudflare | Add `library` subdomain pointing to Tailscale IP |
| 8 | osmium.rh stack entry | osmium.rh | Add compose file to `stacks/libraries/durtal/` and include in main compose |
| 9 | Environment variables | osmium.rh | Add `DURTAL_*` variables to `.env` |

### osmium.rh Environment Variables

Add to the osmium.rh `.env` file:

```bash
SUBDOMAIN_DURTAL=library
DURTAL_DATABASE_URL=postgresql://...@...neon.tech/durtal?sslmode=require
DURTAL_AWS_ACCESS_KEY_ID=xxx
DURTAL_AWS_SECRET_ACCESS_KEY=xxx
DURTAL_AWS_REGION=eu-north-1
DURTAL_S3_BUCKET=durtal
DURTAL_EBOOK_DELIVERY=cloudfront
DURTAL_EBOOK_CDN_URL=https://dxxxxxxxxxxxxx.cloudfront.net
DURTAL_EBOOK_CDN_KEY_PAIR_ID=KXXXXXXXXXXXXX
DURTAL_EBOOK_CDN_PRIVATE_KEY=xxx
DURTAL_GOOGLE_BOOKS_API_KEY=xxx
```

### eBook storage

SLN-569 uses the existing private `durtal` bucket in `eu-north-1`. The setup
script requires AWS CLI v2 and Python, discards ambient AWS credentials and
endpoint overrides, and uses only `--profile durtal-personal`. It checks
configured personal account and the bucket region before proceeding.

```bash
scripts/aws/ebooks-storage.sh plan --expected-account "$EBOOKS_AWS_ACCOUNT_ID" --admin-arn "$EBOOKS_ADMIN_ARN" --output-dir /tmp/ebooks-infra-plan
scripts/aws/ebooks-storage.sh apply --expected-account "$EBOOKS_AWS_ACCOUNT_ID" --admin-arn "$EBOOKS_ADMIN_ARN" --apply-reviewed-plan
```

Review the rendered before/after documents before apply. The script merges
its own scoped policy statements and lifecycle rules, retaining unrelated
statements/rules. It changes only the eBook deletion/conditional-creation
bucket policy, the eBook incomplete-multipart lifecycle rules and the separate
`durtal-ebooks-multipart` app inline policy. It preserves managed
`DurtalS3Access`, images and bucket-wide settings. Versioning remains as found;
silver versions are immutable report keys, not S3 object versions.

The deletion exception is the exact administrator role supplied through `--admin-arn`. Set `EBOOKS_AWS_ACCOUNT_ID` and `EBOOKS_ADMIN_ARN` locally to the reviewed personal account and IAM role; absent or mismatched values fail closed. These identifiers are runtime configuration.
Existing media IAM credentials are unchanged. Ingestion CLI commands require
`--aws-profile durtal-personal` and `EBOOKS_AWS_ACCOUNT_ID` outside previews; refreshed temporary login
credentials and session tokens stay in memory and are never printed or stored.
Plans and multipart state bind to their storage/credential identity.

Default `EBOOK_DELIVERY=app` supports private Range delivery. Existing CDN
signing code and JSON templates remain for a separately reviewed SLN-491 CDN
rollout. This script no longer provisions a bucket, CDN/key group or budget,
modifies no existing distribution/budget and prints no generated CDN settings.
Configure a future private distribution's OAC for accepted gold and required
legacy delivery prefixes only, with a trusted signing key group. Private key
material belongs only in the server environment; never in a report or commit.

### Browser uploads

Uploads from `/ebooks/upload` (new e-books, an added format, a replaced file) go through the e-book upload service (SLN-506), a separate process on the machine that runs the app, as the same user. The app streams each upload's bytes to it over a private Unix socket; the service keeps them in a private spool, checks each file in a locked-down inspector container (no network, read-only root, 1 CPU, bounded memory and processes, `--pull=never`), and only then adds or replaces the e-book. Without the service, every upload route answers 503: "Uploads are not available on this server yet" when the app has no bridge, "The upload service is not running" when it has one and the service is down, "Uploads need the Mac to sign in to AWS again" when the service stopped because its AWS sign-in expired, and "Uploads stopped because the last three file checks failed" when it stopped itself after three failed checks in a row (the upload page says the same before a file is chosen).

It needs Docker with a Linux engine on cgroup v2 and its default seccomp profile, with no engine warnings (Docker Desktop on the Mac qualifies), and the containerd image store, so a locally built image has a content digest (Docker Desktop: Settings, General, "Use containerd for pulling and storing images"). The state folder (default `~/.durtal/ebook-upload`) must be in a folder Docker can bind-mount (`/Users` on Docker Desktop).

```bash
pnpm ebooks:upload-service build-inspector                       # infra/ebooks/inspector at this commit; prints the pinned image
pnpm ebooks:upload-service init --aws-profile durtal-personal    # once: service.json + bridge.json, private (0600) in a private folder
pnpm ebooks:upload-service start --aws-profile durtal-personal   # runs until SIGINT/SIGTERM; non-zero exit on failure
```

- `init` binds the service to this database (refuses another), the inspector image (by digest), the Docker socket, a fixed loopback port (`--port`, default 47615: the service's host lock, held while it runs) and a new volume id. It never overwrites the files: run again after a new `build-inspector` and it only moves the service to the new image (the binding stays). A new database needs another `--state-dir`.
- The app reads `EBOOK_UPLOAD_BRIDGE=<state folder>/bridge.json` at startup (`src/instrumentation.ts`): the socket path, a 32-byte secret, the database fingerprint and the binding. A bridge for another database, or a file others can read, leaves uploads off with one error line and the rest of the app up. The development server reads it from `.env.local`; the Mac standalone runtime config accepts it in `environment`.
- `start` is a long-running process, kept running on the Mac by a launchd agent (below). It exits non-zero on a failure, and 78 when it cannot start or refresh because the AWS sign-in expired; it then leaves a private `status.json` beside its socket, which the app reads to show the sign-in message, and clears it once it is ready again. After three file checks fail in a row (a broken inspector build, a full disk) it stops, leaves a `checks_failing` note the same way, and exits 0, so launchd leaves it stopped instead of failing the next queued file a minute later; once the cause is fixed, start it again with `launchctl kickstart`, which clears the note. The first start writes the volume's row in `ebook_upload_capacity`; restarts recover any upload in progress before admitting new ones. Stop it with SIGTERM, never SIGKILL: it waits for running inspections and keeps its spool reservations until they are settled.
- The launchd agent (`scripts/deploy/upload_agent.py`, label `com.durtal.ebook-upload`) runs `start` from a checkout under the pinned Node, so launchd's SIGTERM reaches the service. It restarts the service after any non-zero exit, at most once a minute, and leaves it stopped after a clean stop; launchd waits 300 s before it kills, longer than an inspection and the cleanup. `plan` writes the plist (0600, never over an existing file) and installs nothing; it refuses anything under `/tmp`, `/private/tmp` or macOS's per-user temporary folders (`/var/folders`), a state folder or log folder that isn't private, a state folder without a private `service.json`, a checkout without its packages or `.env.local`, and relative tool paths. No secret goes into the plist.

  ```bash
  mkdir -p ~/Library/Logs/Durtal && chmod 700 ~/Library/Logs/Durtal                        # the log folder must be private
  python3 scripts/deploy/upload_agent.py plan --repo ~/personal/durtal --state-dir ~/.durtal/ebook-upload \
    --log-directory ~/Library/Logs/Durtal --node "$(command -v node)" --docker "$(command -v docker)" \
    --aws "$(command -v aws)" --output ~/Library/LaunchAgents/com.durtal.ebook-upload.plist
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.durtal.ebook-upload.plist   # install and start
  launchctl kill SIGTERM gui/$(id -u)/com.durtal.ebook-upload                              # restart, 1: stop it cleanly (it stays stopped)
  launchctl kickstart gui/$(id -u)/com.durtal.ebook-upload                                 # restart, 2: once print shows it is not running
  launchctl print gui/$(id -u)/com.durtal.ebook-upload | grep -E 'state|last exit code'    # check; 78 = sign in again; 0 while the app says checks failed = read the log
  launchctl bootout gui/$(id -u)/com.durtal.ebook-upload                                   # stop and uninstall
  ```

  When the app says uploads need the Mac to sign in again, run `aws sso login --profile durtal-personal`; the agent starts the service again within a minute and the message goes away. The log is `<log folder>/ebook-upload.log`. The plist holds the resolved paths of node, aws and docker, so after upgrading any of them (a Homebrew upgrade moves its folder), boot the agent out, delete the plist and run `plan` and `bootstrap` again.
- A disposable preview runs its own service: `scripts/qa/preview-local.py --s3-dir S3DIR --upload-service DIR` (DIR a new folder: the preview's database is new each time) runs `init` and `start` with `--preview` after the database is up and before the app, and stops the service with SIGTERM when the preview stops.

### Mac standalone delivery configuration

The existing `scripts/deploy/mac_release.py` and `runtime_launcher.py` support
explicit `app` or `cloudfront` delivery. Runtime config contains public settings
only. CloudFront mode requires its reviewed HTTPS CloudFront domain and public
key ID plus `cdn: {fingerprint, publicKeyPem}`; the fingerprint is the SHA-256 of
the exact public SPKI PEM. Bind these public values to the reviewed distribution
and trusted key; a config hash does not establish AWS ownership by itself.

The packaged `phone_secrets.py` continues to read selected ordinary app values
from the existing owner `.env.local` in memory and verify the unchanged app IAM
pair. Do not import again. At actual CloudFront launch only, the launcher loads
the packaged, hash-verified `macos-secrets.py` and reads one existing owner login
Keychain item: service `com.durtal.ebooks.cloudfront-private-key`, account
`608240934043:<fingerprint>`. Budget and runtime Keychain capabilities are disabled.
The handle is closed on read success/failure. There is no key creation, rotation,
Keychain write, budget access or fallback key source.

The pinned Node 22 executable derives the public SPKI PEM from the private PEM
through stdin, requires RSA-2048, and returns only its SHA-256. Mismatch, missing
or locked Keychain, invalid key, provider failure or timeout stops before any
server spawn. Only after success is base64 PEM added to the child process's
`EBOOK_CDN_PRIVATE_KEY`; keys stay out of argv/config/files/plists and log output.
The redactor receives raw PEM and base64 forms in memory. Parent/child secret
values remain in process memory during serving; no memory-zeroing guarantee is
claimed. Bounded crash restarts reuse the verified environment; rotation needs
an explicit fresh launch. App mode performs no signing Keychain lookup.

Existing commands remain `mac_release.py verify --release RELEASE`,
`mac_release.py launchd-plan --config CONFIG --output NEW_PLIST`, and the packaged
`runtime_launcher.py --config CONFIG --config-sha256 REVIEWED_SHA256`, invoked by
the configured absolute hash-pinned Python. `launchd-plan` writes a private plan
and does not install/start the service. Config uses an unused loopback port other
than development port 3100, the exact build Node identity, packaged
`deploy/phone_secrets.py` helper identity, and private logs outside the immutable
release. Full source/build/transition/config review and private-origin acceptance
remain deployment responsibilities; this configuration performs no migration,
Tailscale change, cloud write or infrastructure-journal acknowledgement.

---

## Backups, Recovery and Rollback

**Database.** A release's backup is `live_migrate.py backup` (Release order, step 6): only its receipt feeds the rehearsal and the migration. Any other dump, such as one before a data change outside a release, uses pg_dump 16, the major version `preview-local.py` restores with: `docker run --rm -e PGURL postgres:16 sh -c 'pg_dump --format=custom "$PGURL"' > ~/personal/durtal-backups/live-before-<what>-<timestamp>.dump`. A dump from a newer pg_dump does not restore there. An empty file is no backup. A backup counts as verified once it restores strictly: `python3 scripts/qa/preview-local.py --from-dump FILE` restores it with `pg_restore --exit-on-error` into a disposable PostgreSQL, applies the pending migrations and prints the tables whose rows changed.

**Files (S3).** Checked 2026-10-04 (task 0267): every key the newest backup names (3,274) exists in the bucket (3,374 objects, 468 MB). The app's IAM user cannot read the bucket's versioning, replication or lifecycle settings, so the bucket itself may not keep deleted or overwritten files. A read-only copy of the whole bucket is in `~/personal/durtal-backups/s3-20261004/`, with `MANIFEST.json` (every key, size and ETag); every file matched its size and MD5 when copied. Refresh it the same way before a destructive change.

**Checking a build against a backup.** `pnpm build`, then `python3 scripts/qa/preview-local.py --start --from-dump FILE` serves the standalone build as the Docker image does (`server.js` with its static files) against a disposable restore of the backup.

**Rolling back a build.** The previous release stays in its folder, and its plist is the way back: `mac_release.py switch` with the two plists the other way round, or by hand (stop the `com.durtal.production` agent, load the previous release's plist, and wait for `GET http://127.0.0.1:3110/api/health`) when the switch refuses. Going back is safe for the schema only while every migration since that release is additive; otherwise restore the backup first.

**When the service stops.** The launcher restarts a server that exits after 30 s, but a start that never becomes ready, or three exits within five minutes, stops the service for good (`runtime_launcher.py`). The plist has `KeepAlive: false`, so launchd does not start it again: someone recovers it by hand, by loading a plist as above.

**Rolling back a collection.** Perfumes, films and paintings can be closed again without losing what was entered:

1. In `src/lib/catalogue/domains.ts`, set `enabled: false` for the collection.
2. Keep the database as it is: never roll back `0053_open_perfumes`, `0054_film_kind_enabled` or `0055_open_paintings`, and never drop the collection's tables. The database keeps accepting the kind, so its rows stay valid.
3. Build and serve that code. Every page of the collection answers 404, no menu, switch or dashboard section names it, and the book pages, lists and searches leave its records out.

To roll forward, set `enabled: true` again. The records come back as they were. An older build from before a collection existed is not a safe rollback once that collection has rows: use the current code with the switch off instead.

The drill of 2026-10-04 (task 0267) ran this on disposable restores of `live-before-0053-0056-20261004-113735.dump`: main's build added a perfume, a film and a painting; the recovery build (all three switches off) restored a dump of that database strictly, kept every table's row count, answered 404 on every collection page and 200 on the book pages; main's build on the same dump showed the three records again.

---

## External Services

| Service | Connection | Purpose |
|---|---|---|
| Neon Postgres | Over internet, SSL | Primary database |
| AWS S3 | Over internet, IAM auth | Image and file storage |
| Google Books API | Over internet, API key | Book metadata |
| Open Library | Over internet, no auth | Fallback metadata |


### Repository acknowledgement of the causally proven budget create

`ebooks-cdn.py acknowledge-budget` is a separately reviewed local-journal action,
not another budget apply. Ordinary `budget` apply continues to refuse an
unconfirmed step or existing unowned budget. `verify` never acknowledges it.

The action requires an exact versioned payload, independent source/contract
review and a fresh root execute-once grant pinning those hashes, exclusive ledger
custody and zero cloud writes. Its contract explicitly supersedes the earlier
private native-admission contract for this local acknowledgement only; failed
proofs and original causal evidence stay pinned and preserved. No ancestor/private
helper is invoked and no native proof is claimed. Source review is not an
execution grant.

```sh
python3 scripts/aws/ebooks-cdn.py acknowledge-budget \
  --expected-account 608240934043 --admin-arn "$EBOOKS_ADMIN_ARN" \
  --state-dir "$REVIEWED_STATE_DIRECTORY" \
  --acknowledgement-payload "$REVIEWED_ACK_PAYLOAD" \
  --approved-acknowledgement-sha256 "$REVIEWED_ACK_SHA256" \
  --root-grant "$FRESH_ROOT_GRANT" --root-grant-sha256 "$ROOT_GRANT_SHA256" \
  --acknowledge-reviewed-budget-create
```

Use the exact resolved Python/Git/AWS executable bytes pinned in the reviewed
payload; root supplies a hard 180-second owned-process deadline. The internal
170-second timer leaves cleanup reserve. Standard nonreaping POSIX wait and
bounded pipe/process-group cleanup are required; this does not attest kernel
exec identity, all SDK/OS dependencies or hostile process escape. All source,
reference and tool pins are checked again before local commit. Only STS identity
and the three complete budget read operations are allowed. Two rounds must agree
with the original create outcome, HEALTHY status and the privately verified
intended subscriber for each exact percentage alert. Only budget-email Keychain
get/close is used; no signing/runtime lookup or secret write occurs.

The one eligible transition confirms the exact historic create step, sets
budget_owned and removes its budget pending marker, preserving unrelated state.
Exact reviewed live bytes/device/inode, advisory lock and root's exclusive writer
lane are all required. No lock can exclude an uncontrolled writer; if root cannot
reserve custody, do not execute. Private before/proposed-after/grant and PREPARED
receipts precede a same-directory file fsync/replace, directory fsync/readback and
committed receipt fsync/readback. Freshness/expiry/commit-reserve failures stop.

Any ambiguous crash/receipt failure, drift, existing output folder or reused
preimage stops. Root inspects exact bytes and receipts read-only and requests a
fresh reviewed proposal; never retry, roll back, adopt, repair or replay the
consumed cloud-create plan automatically. This action accepts neither CDN runtime
nor release delivery. The existing full177 acceptance harness keeps its completed
ledger gate and needs a fresh source/state binding plus separate execution grant.
