#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
UPSTREAM_DIR="$PROJECT_DIR/upstream"
BRAND_DIR="$PROJECT_DIR/branding"
BRAND_CONFIG="$PROJECT_DIR/branding.json"
BUILD_DIR="$PROJECT_DIR/build"

echo "=== MyVault - Apply Branding ==="

if [ ! -f "$BRAND_CONFIG" ]; then
    echo "ERROR: $BRAND_CONFIG not found."
    exit 1
fi

if [ ! -d "$UPSTREAM_DIR" ]; then
    echo "ERROR: Upstream code not found. Run $SCRIPT_DIR/update.sh first."
    exit 1
fi

APP_NAME_SAFE=$(python3 -c "import json; print(json.load(open('$BRAND_CONFIG'))['app_name_safe'])")
APP_DISPLAY_NAME=$(python3 -c "import json; print(json.load(open('$BRAND_CONFIG'))['app_display_name'])")
DOCKER_REGISTRY=$(python3 -c "import json; print(json.load(open('$BRAND_CONFIG'))['docker_registry'])")
DOCKER_PREFIX=$(python3 -c "import json; print(json.load(open('$BRAND_CONFIG'))['docker_image_prefix'])")
HOSTNAME=$(python3 -c "import json; print(json.load(open('$BRAND_CONFIG'))['hostname'])")
COMPANY_NAME=$(python3 -c "import json; print(json.load(open('$BRAND_CONFIG'))['company_name'])")
ADMIN_EMAIL=$(python3 -c "import json; print(json.load(open('$BRAND_CONFIG'))['admin_email'])")

echo "Applying branding:"
echo "  App name:     $APP_DISPLAY_NAME"
echo "  Docker prefix: $DOCKER_REGISTRY/$DOCKER_PREFIX-*"
echo "  Hostname:     $HOSTNAME"

rm -rf "$BUILD_DIR"
cp -r "$UPSTREAM_DIR" "$BUILD_DIR"

# --- 1. Replace Docker image references (ghcr.io/aliasvault/ -> your registry) ---
echo "  -> Updating Docker image references..."
find "$BUILD_DIR" -type f \( -name "*.yml" -o -name "*.yaml" \) -exec sed -i \
    -e "s|ghcr\.io/aliasvault/|$DOCKER_REGISTRY/$DOCKER_PREFIX-|g" \
    {} +

# --- 2. Replace container/service names in docker-compose files ---
echo "  -> Updating container/service names..."
find "$BUILD_DIR" -type f \( -name "docker-compose*.yml" -o -name "docker-compose*.yaml" \) -exec sed -i \
    -e "s/container_name: aliasvault/container_name: $APP_NAME_SAFE/g" \
    -e "s/aliasvault\\./$APP_NAME_SAFE./g" \
    {} +

# --- 3. Replace HTML <title> in the Blazor template ---
echo "  -> Updating HTML title..."
INDEX_TEMPLATE="$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/index.template.html"
if [ -f "$INDEX_TEMPLATE" ]; then
    sed -i "s|<title>AliasVault</title>|<title>$APP_DISPLAY_NAME</title>|" "$INDEX_TEMPLATE"
fi

# --- 4. Update manifest.json (PWA name) ---
echo "  -> Updating PWA manifest..."
MANIFEST="$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/manifest.json"
if [ -f "$MANIFEST" ]; then
    sed -i \
        -e "s|\"name\": \"AliasVault\"|\"name\": \"$APP_DISPLAY_NAME\"|" \
        -e "s|\"short_name\": \"AliasVault\"|\"short_name\": \"$APP_DISPLAY_NAME\"|" \
        "$MANIFEST"
fi

# --- 5. Update .env.example with custom hostname ---
echo "  -> Updating .env.example..."
ENV_EXAMPLE="$BUILD_DIR/.env.example"
if [ -f "$ENV_EXAMPLE" ]; then
    # Replace the example hostname line
    sed -i \
        -e "s|aliasvault\.mydomain\.net|$HOSTNAME|g" \
        -e "s|example\.com|$HOSTNAME|g" \
        "$ENV_EXAMPLE"
fi

# --- 6. Copy custom logo files (overriding upstream assets) ---
echo "  -> Copying branding assets..."
if [ -f "$BRAND_DIR/logo.svg" ]; then
    cp "$BRAND_DIR/logo.svg" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img/logo.svg"
fi
if [ -f "$BRAND_DIR/favicon.ico" ]; then
    cp "$BRAND_DIR/favicon.ico" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/favicon.ico"
fi
if [ -f "$BRAND_DIR/favicon.png" ]; then
    cp "$BRAND_DIR/favicon.png" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/favicon.png"
fi
if [ -f "$BRAND_DIR/logo-192.png" ]; then
    mkdir -p "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img"
    cp "$BRAND_DIR/logo-192.png" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img/logo-192.png"
fi
if [ -f "$BRAND_DIR/logo-512.png" ]; then
    mkdir -p "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img"
    cp "$BRAND_DIR/logo-512.png" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img/logo-512.png"
fi
if [ -f "$BRAND_DIR/favicon.png" ]; then
    mkdir -p "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img"
    cp "$BRAND_DIR/favicon.png" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img/favicon.png"
fi

# --- 7. Update install.sh references (if present) ---
echo "  -> Updating install script references..."
INSTALL_SH="$BUILD_DIR/install.sh"
if [ -f "$INSTALL_SH" ]; then
    sed -i \
        -e "s|aliasvault\\.com|$HOSTNAME|g" \
        -e "s|aliasvault\\.net|$HOSTNAME|g" \
        "$INSTALL_SH"
fi

# --- 8. Update docs/README.md references ---
echo "  -> Updating documentation references..."
find "$BUILD_DIR/docs" -type f -name "*.md" -exec sed -i \
    -e "s|aliasvault\\.com|$HOSTNAME|g" \
    -e "s|docs\\.aliasvault\\.com|docs.$HOSTNAME|g" \
    {} + 2>/dev/null || true

# --- 9. Generate a custom .env from .env.example ---
echo "  -> Generating .env..."
cp "$BUILD_DIR/.env.example" "$BUILD_DIR/.env"
sed -i \
    -e "s|ALIASVAULT_HOSTNAME=.*|ALIASVAULT_HOSTNAME=$HOSTNAME|" \
    -e "s|EMAIL_DOMAIN=.*|EMAIL_DOMAIN=$(echo "$HOSTNAME" | sed 's/^[^.]*\.//')|" \
    "$BUILD_DIR/.env"

echo ""
echo "Branding applied successfully."
echo "Build output: $BUILD_DIR"
echo ""
echo "To build Docker images, run from the project root:"
echo "  docker build -f $BUILD_DIR/dockerfiles/all-in-one/Dockerfile -t $DOCKER_REGISTRY/$DOCKER_PREFIX:latest $BUILD_DIR"