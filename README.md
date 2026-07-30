# MyVault — Custom AliasVault Fork

Self-hostable, end-to-end encrypted password and email alias manager. Custom-branded fork of [AliasVault](https://github.com/aliasvault/aliasvault) designed for commercial deployment.

## Overview

This repo provides a mechanism to:

1. Track upstream AliasVault releases
2. Apply your own brand name and logo
3. Build and deploy as a proprietary product

## Quick Start

```bash
# 1. Clone this repo
git clone <your-repo-url> && cd aliasvault-custom

# 2. Add upstream remote (one-time only)
#    (already configured as 'upstream' if just cloned)
git remote add upstream https://github.com/aliasvault/aliasvault.git

# 3. Edit branding.json with your company details
#    - app_name_safe (lowercase, e.g. "acmecorp-vault")
#    - app_display_name (e.g. "Acme Vault")
#    - docker_registry (your registry, e.g. "ghcr.io/acmecorp")
#    - docker_image_prefix (e.g. "acmevault")
#    - hostname (your server domain)

# 4. Replace logo files in branding/
#    - logo.svg (main logo, SVG format)
#    - favicon.ico (browser tab icon)
#    - logo-192.png and logo-512.png (PWA icons)

# 5. Pull upstream and build
./scripts/update.sh            # fetch latest upstream source
./scripts/apply-branding.sh    # apply your branding to source
./scripts/build.sh             # build Docker images (interactive)

# 6. Deploy
cp docker-compose.deploy.yml docker-compose.yml
# Edit docker-compose.yml → replace ghcr.io/your-org/myvault-* with your pushed images
docker compose up -d
```

## Updating from Upstream

When AliasVault releases a new version:

```bash
./scripts/update.sh          # fetch latest from upstream
./scripts/apply-branding.sh  # re-apply your branding on new code
./scripts/build.sh           # rebuild images
```

Your branding files (logo, config) are preserved across updates — only the upstream code changes.

## Project Structure

```
aliasvault-custom/
├── .git/                     # Git repository (upstream configured as remote)
├── .env.example              # Template environment variables for deployment
├── branding.json             # Central brand configuration
├── branding/                 # Custom logo and branding assets (edit these)
│   ├── logo.svg              # Main application logo (SVG)
│   ├── favicon.ico           # Browser tab favicon
│   ├── logo-192.png          # PWA icon
│   └── logo-512.png          # PWA icon
├── scripts/
│   ├── update.sh             # Fetch latest upstream AliasVault code
│   ├── apply-branding.sh     # Apply name/logo changes to upstream source
│   └── build.sh              # Build Docker images from branded source
├── upstream/                 # Upstream AliasVault source (git pull only, don't edit)
├── build/                    # Branded build output (regenerated, don't edit)
├── docker-compose.deploy.yml # Deployment compose template (edit image names)
├── docker-compose.custom.yml # Build-time compose template
└── README.md                 # This file
```

## Branding Configuration

All branding is controlled in `branding.json`:

| Field | Example | Description |
|-------|---------|-------------|
| `app_name_safe` | `acmevault` | Lowercase identifier used in Docker image names and code |
| `app_display_name` | `Acme Vault` | Human-readable name shown in the UI |
| `docker_registry` | `ghcr.io/acmecorp` | Docker registry for custom images |
| `docker_image_prefix` | `acmevault` | Prefix prepended to all custom image names |
| `hostname` | `vault.acmecorp.com` | Server hostname |
| `company_name` | `Acme Corp` | Displayed in UI footer/about |
| `admin_email` | `admin@acmecorp.com` | Admin contact |

## Deploying to Your Own Servers

### Prerequisites

- Docker ≥ 20.10
- 1 vCPU, 1GB RAM, 16GB disk minimum
- A domain pointing to your server
- SSL certificate (self-signed for testing, Let's Encrypt for production)

### Deployment Steps

1. **Build images** (from the repo root):
   ```bash
   ./scripts/build.sh
   ```

2. **Push to your registry**:
   ```bash
   docker tag myvault-client ghcr.io/yourcompany/myvault-client:latest
   docker push ghcr.io/yourcompany/myvault-client:latest
   # Repeat for api, admin, reverse-proxy, smtp, task-runner
   ```

3. **Deploy**:
   ```bash
   cp docker-compose.deploy.yml docker-compose.yml
   # Edit docker-compose.yml: replace image names with yours
   # Edit .env: set POSTGRES_PASSWORD, ALLOWED_HOSTS, EMAIL_DOMAIN
   docker compose up -d
   ```

4. **Configure SSL** (if not using the built-in reverse proxy cert):
   ```bash
   certbot certonly --standalone -d vault.yourcompany.com
   ```

## Architecture Notes

Based on AliasVault's multi-container architecture:

- **client** — Blazor WebAssembly UI served by nginx (port 3000)
- **api** — .NET backend API (port 3001)
- **admin** — Admin dashboard (port 3002)
- **reverse-proxy** — Traefik/nginx reverse proxy handling SSL (ports 80, 443)
- **smtp** — Built-in email server for alias handling (ports 25, 587)
- **task-runner** — Background jobs (data retention, cleanup)
- **postgres** — Database (not published, internal only)

## Why This Fork?

- **Easy updates** — `./scripts/update.sh` pulls upstream changes; branding is preserved
- **Easy branding** — Change `branding.json` and swap logo files; rebuild
- **Self-contained** — Build Docker images from source, no dependency on upstream images at runtime
- **Commercial** — MIT license allows commercial use; your customizations are yours

## License

Based on AliasVault, which is MIT licensed. Your custom modifications are your own.