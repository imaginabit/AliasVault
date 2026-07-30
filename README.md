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
cp docker-compose.custom.yml docker-compose.yml
# Edit docker-compose.yml: replace image name with yours
# Edit .env: set POSTGRES_PASSWORD, ALLOWED_HOSTS, EMAIL_DOMAIN
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

## What the Branding Script Changes

The `apply-branding.sh` script makes **surgical** changes only — it does NOT touch .NET source code or rename namespaces. It modifies:

- **Docker image references** (`ghcr.io/aliasvault/` → your custom registry in docker-compose files)
- **Container/service names** in docker-compose
- **HTML `<title>`** tag in the Blazor app (`index.template.html`)
- **PWA manifest** name and short_name
- **Logo files** (logo.svg, favicon, PWA icons)
- **.env.example** with your hostname

This means you can safely update from upstream — branding changes don't conflict with .NET project renames.

All branding is controlled in `branding.json`:

| `app_name_safe` | `acmevault` | Lowercase identifier used in Docker image names |
| `app_display_name` | `Acme Vault` | Human-readable name shown in the UI title bar |
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

1. **Build the all-in-one image** (from the repo root):
   ```bash
   ./scripts/build.sh
   ```

2. **Push to your registry**:
   ```bash
   docker tag ghcr.io/your-org/myvault:latest ghcr.io/your-org/myvault:latest
   docker push ghcr.io/your-org/myvault:latest
   ```

3. **Deploy**:
   ```bash
   cp docker-compose.custom.yml docker-compose.yml
   # Edit docker-compose.yml → replace image name with yours from your registry
   # Edit .env: set POSTGRES_PASSWORD, ALLOWED_HOSTS, EMAIL_DOMAIN
   docker compose up -d
   ```

4. **Configure SSL** (if not using the built-in reverse proxy):
   ```bash
   certbot certonly --standalone -d vault.yourcompany.com
   ```

## Architecture Notes

This fork uses AliasVault's all-in-one Docker image approach — a single container that runs the client UI, API, admin panel, SMTP server, task runner, and nginx reverse proxy together. This simplifies deployment significantly.

## Why This Fork?

- **Easy updates** — `./scripts/update.sh` pulls upstream changes; branding is preserved
- **Easy branding** — Change `branding.json` and swap logo files; rebuild
- **Self-contained** — Build Docker images from source, no dependency on upstream images at runtime
- **Commercial** — MIT license allows commercial use; your customizations are yours

## License

Based on AliasVault, which is MIT licensed. Your custom modifications are your own.