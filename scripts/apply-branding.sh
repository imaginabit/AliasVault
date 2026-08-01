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

echo "Applying branding: $APP_DISPLAY_NAME ($APP_NAME_SAFE)"
echo "Docker images: $DOCKER_REGISTRY/$DOCKER_PREFIX-*"
echo "Default language: $(python3 -c "import json; print(json.load(open('$BRAND_CONFIG')).get('default_language','en'))")"

rm -rf "$BUILD_DIR"
cp -r "$UPSTREAM_DIR" "$BUILD_DIR"

# --- 0. Apply custom patches (feature changes against pristine upstream) ---
if [ -d "$BRAND_DIR/patches" ]; then
    for patch in "$BRAND_DIR"/patches/*.patch; do
        [ -e "$patch" ] || continue
        echo "  -> Applying patch: $(basename "$patch")"
        git -C "$BUILD_DIR" apply --whitespace=nowarn "$patch"
    done
fi

# Add runtime env vars introduced by patches to .env.example and .env generation
if ! grep -q "ALLOWED_REGISTRATION_DOMAINS" "$BUILD_DIR/.env.example" 2>/dev/null; then
    cat >> "$BUILD_DIR/.env.example" <<'EOF'

# Comma-separated list of email domains allowed to register new accounts.
# Leave empty to allow any username. Example: ALLOWED_REGISTRATION_DOMAINS=mycompany.com,subsidiary.com
ALLOWED_REGISTRATION_DOMAINS=
EOF
fi

# --- 1. Replace Docker image references (ghcr.io/aliasvault/ -> your registry) ---
echo "  -> Updating Docker image references..."
find "$BUILD_DIR" -type f \( -name "*.yml" -o -name "*.yaml" \) -exec sed -i \
    -e "s|ghcr\.io/aliasvault/|$DOCKER_REGISTRY/$DOCKER_PREFIX-|g" \
    {} +

# --- 2. Replace container/service names in docker-compose files ---
echo "  -> Updating container/service names..."
find "$BUILD_DIR" -type f \( -name "docker-compose*.yml" -o -name "docker-compose*.yaml" \) -exec sed -i \
    -e "s/container_name: aliasvault/container_name: $APP_NAME_SAFE/g" \
    -e "s/aliasvault\./$APP_NAME_SAFE./g" \
    {} +

# --- 3. Brand index.template.html (title, loading screen, language) ---
echo "  -> Branding index.template.html..."
if [ -x "$(command -v python3)" ]; then
    python3 "$PROJECT_DIR/scripts/brand_template.py" "$BUILD_DIR"
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

# --- 5. Replace AliasVault in Razor components (visible text) ---
echo "  -> Branding Razor components..."
find "$BUILD_DIR/apps/server/AliasVault.Client" -name "*.razor" -exec sed -i \
    -e 's|alt="AliasVault"|alt="'"$APP_DISPLAY_NAME"'"|g' \
    -e 's|alt="AliasVault Assistant"|alt="'"$APP_DISPLAY_NAME Assistant"'"|g' \
    -e 's|>AliasVault<|>'"$APP_DISPLAY_NAME"'<|g' \
    {} +

# --- Handle Logo.razor specifically via overlay ---
if [ -f "$BRAND_DIR/Logo.razor" ]; then
    cp "$BRAND_DIR/Logo.razor" "$BUILD_DIR/apps/server/AliasVault.Client/Auth/Components/Logo.razor"
fi

# --- 6. Update .env.example with custom hostname ---
echo "  -> Updating .env.example..."
ENV_EXAMPLE="$BUILD_DIR/.env.example"
if [ -f "$ENV_EXAMPLE" ]; then
    sed -i \
        -e "s|ALIASVAULT_HOSTNAME=.*|ALIASVAULT_HOSTNAME=$HOSTNAME|" \
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

# --- 7. Update install.sh references ---
echo "  -> Updating install script references..."
INSTALL_SH="$BUILD_DIR/install.sh"
if [ -f "$INSTALL_SH" ]; then
    sed -i \
        -e "s|aliasvault\.com|$HOSTNAME|g" \
        -e "s|aliasvault\.net|$HOSTNAME|g" \
        "$INSTALL_SH"
fi

# --- 8. Generate .env ---
echo "  -> Generating .env..."
cp "$BUILD_DIR/.env.example" "$BUILD_DIR/.env"
sed -i \
    -e "s|ALIASVAULT_HOSTNAME=.*|ALIASVAULT_HOSTNAME=$HOSTNAME|" \
    "$BUILD_DIR/.env"

echo ""
echo "Branding applied successfully."
echo "Build output: $BUILD_DIR"