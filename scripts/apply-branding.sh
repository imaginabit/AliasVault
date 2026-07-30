#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
UPSTREAM_DIR="$PROJECT_DIR/upstream"
BRAND_DIR="$PROJECT_DIR/branding"
BRAND_CONFIG="$PROJECT_DIR/branding.json"
BUILD_DIR="$PROJECT_DIR/build"

echo "=== AliasVault Custom Fork - Apply Branding ==="

if [ ! -f "$BRAND_CONFIG" ]; then
    echo "ERROR: $BRAND_CONFIG not found. Copy .env.example and edit branding.json first."
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
echo "Hostname: $HOSTNAME"

rm -rf "$BUILD_DIR"
cp -r "$UPSTREAM_DIR" "$BUILD_DIR"

# --- 1. Replace Docker image references ---
echo "  -> Replacing Docker image references..."
find "$BUILD_DIR" -type f \( -name "*.yml" -o -name "*.yaml" -o -name "*.sh" -o -name "Dockerfile*" -o -name "*.md" \) -exec sed -i \
    -e "s|ghcr.io/aliasvault/|$DOCKER_REGISTRY/$DOCKER_PREFIX-|g" \
    -e "s|aliasvault/|$DOCKER_PREFIX-/|g" \
    -e "s|image: .*aliasvault.*|& # BRANDED|g" \
    {} +

# --- 2. Replace project name references in source files ---
echo "  -> Replacing project name references..."
# Replace lowercase namespace/directory references
find "$BUILD_DIR" -type f \( -name "*.cs" -o -name "*.csproj" -o -name "*.yml" -o -name "*.yaml" -o -name "*.sh" \) -exec sed -i \
    -e "s/AliasVault\.Client/${APP_NAME_SAFE^}.Client/g" \
    -e "s/AliasVault\.Api/${APP_NAME_SAFE^}.Api/g" \
    -e "s/AliasVault\.Admin/${APP_NAME_SAFE^}.Admin/g" \
    -e "s/AliasVault\.Shared/${APP_NAME_SAFE^}.Shared/g" \
    -e "s/AliasVault\.TaskRunner/${APP_NAME_SAFE^}.TaskRunner/g" \
    -e "s/AliasVault\.SmtpService/${APP_NAME_SAFE^}.SmtpService/g" \
    {} +

# --- 3. Replace display name in UI text ---
echo "  -> Replacing display name in UI..."
find "$BUILD_DIR" -type f \( -name "*.html" -o -name "*.cshtml" -o -name "*.razor" -o -name "*.tsx" -o -name "*.ts" -o -name "*.js" -o -name "*.css" \) -exec sed -i \
    -e "s/AliasVault/$APP_DISPLAY_NAME/g" \
    -e "s/ALIASVAULT/${APP_DISPLAY_NAME^^}/g" \
    -e "s/aliasvault/$APP_NAME_SAFE/g" \
    {} +

# --- 4. Replace Docker Compose service names and container names ---
echo "  -> Replacing Docker service/container names..."
find "$BUILD_DIR" -type f \( -name "docker-compose*.yml" -o -name "docker-compose*.yaml" \) -exec sed -i \
    -e "s/container_name: aliasvault/container_name: $APP_NAME_SAFE/g" \
    -e "s/aliasvault\./$APP_NAME_SAFE./g" \
    {} +

# --- 5. Replace in .env.example and .env ---
echo "  -> Replacing .env references..."
find "$BUILD_DIR" -name ".env*" -exec sed -i \
    -e "s/ALIASVAULT_HOSTNAME/$APP_NAME_SAFE/g" \
    -e "s/aliasvault\.com/$HOSTNAME/g" \
    {} +

# --- 6. Copy custom logo files ---
if [ -f "$BRAND_DIR/logo.svg" ]; then
    echo "  -> Copying custom logo.svg..."
    cp "$BRAND_DIR/logo.svg" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img/logo.svg"
fi
if [ -f "$BRAND_DIR/favicon.ico" ]; then
    echo "  -> Copying custom favicon.ico..."
    cp "$BRAND_DIR/favicon.ico" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/favicon.ico"
fi
if [ -f "$BRAND_DIR/logo-192.png" ]; then
    echo "  -> Copying custom logo-192.png..."
    cp "$BRAND_DIR/logo-192.png" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img/logo-192.png"
fi
if [ -f "$BRAND_DIR/logo-512.png" ]; then
    echo "  -> Copying custom logo-512.png..."
    cp "$BRAND_DIR/logo-512.png" "$BUILD_DIR/apps/server/AliasVault.Client/wwwroot/img/logo-512.png"
fi

# --- 7. Copy mobile icons (iOS/Android) ---
if [ -f "$BRAND_DIR/ios-icon.png" ]; then
    echo "  -> Copying custom iOS icon..."
    cp "$BRAND_DIR/ios-icon.png" "$BUILD_DIR/apps/mobile-app/ios/AliasVault/Asset catalog/AppIcon.appiconset/Icon-App-20x20@2x.png" 2>/dev/null || true
fi

# --- 8. Generate custom .env ---
echo "  -> Generating .env from .env.example..."
sed -i \
    -e "s|ALIASVAULT_HOSTNAME=.*|$APP_NAME_SAFE\_HOSTNAME=$HOSTNAME|g" \
    -e "s|example\.com|$HOSTNAME|g" \
    "$BUILD_DIR/.env.example"

echo "Branding applied. Build output is in $BUILD_DIR"
echo ""
echo "Next steps:"
echo "  cd $BUILD_DIR"
echo "  docker compose -f docker-compose.custom.yml up -d --build"