# Deployment

Durtal deploys as a single Docker container on a self-hosted homelab (osmium.rh), behind Traefik and Authelia, accessible via Tailscale.

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
      - GOOGLE_BOOKS_API_KEY=${GOOGLE_BOOKS_API_KEY}
      - GOOGLE_PLACES_API_KEY=${GOOGLE_PLACES_API_KEY}
      - ISBNDB_API_KEY=${ISBNDB_API_KEY}
      - ISBNDN_API_KEY=${ISBNDN_API_KEY} # old name, accepted for one release
      - ADMIN_TOKEN=${ADMIN_TOKEN}
      - DURTAL_API_TOKEN=${DURTAL_API_TOKEN}
      - NODE_ENV=production
    restart: unless-stopped
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
      - CALIBRE_WEB_URL=http://calibre-web:8083
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
                                                                         |
                                                               Docker internal network
                                                                         |
                                                                  Calibre-Web (:8083)
```

- **Traefik**: Reverse proxy with automatic HTTPS via Let's Encrypt. Routes `library.{DOMAIN}` to the Durtal container.
- **Authelia**: SSO middleware. All requests must have a valid session before reaching Durtal. No auth logic in the application itself.
- **Tailscale**: Mesh VPN. All traffic between Cloudflare and the host stays on the Tailscale network. The registry is only accessible within the mesh.
- **Homepage**: Dashboard integration via Docker labels. Durtal appears under "Libraries" group.

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
| 2 | S3 bucket | AWS | Create bucket `durtal` in `eu-central-1`, configure CORS for app domain |
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
DURTAL_AWS_REGION=eu-central-1
DURTAL_S3_BUCKET=durtal
DURTAL_GOOGLE_BOOKS_API_KEY=xxx
```

---

## External Services

| Service | Connection | Purpose |
|---|---|---|
| Neon Postgres | Over internet, SSL | Primary database |
| AWS S3 | Over internet, IAM auth | Image and file storage |
| Google Books API | Over internet, API key | Book metadata |
| Open Library | Over internet, no auth | Fallback metadata |
| Calibre-Web | Docker internal network | Digital library links |
