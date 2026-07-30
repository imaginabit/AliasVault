#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/build"
DOCKER_REGISTRY=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/branding.json'))['docker_registry'])")
DOCKER_PREFIX=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/branding.json'))['docker_image_prefix'])")
APP_NAME_SAFE=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/branding.json'))['app_name_safe'])")

echo "=== AliasVault Custom Fork - Build ==="
echo "Building images: $DOCKER_REGISTRY/$DOCKER_PREFIX-*"
echo ""

if [ ! -d "$BUILD_DIR" ]; then
    echo "Build directory not found. Running update + apply-branding first..."
    "$SCRIPT_DIR/update.sh"
    "$SCRIPT_DIR/apply-branding.sh"
fi

echo "Building Docker images from $BUILD_DIR..."
cd "$BUILD_DIR"

IMAGES=(
    "${DOCKER_REGISTRY}/${DOCKER_PREFIX}-client:latest"
    "${DOCKER_REGISTRY}/${DOCKER_PREFIX}-api:latest"
    "${DOCKER_REGISTRY}/${DOCKER_PREFIX}-admin:latest"
    "${DOCKER_REGISTRY}/${DOCKER_PREFIX}-reverse-proxy:latest"
    "${DOCKER_REGISTRY}/${DOCKER_PREFIX}-smtp:latest"
    "${DOCKER_REGISTRY}/${DOCKER_PREFIX}-task-runner:latest"
)

echo ""
echo "This will build the following images:"
for img in "${IMAGES[@]}"; do
    echo "  $img"
done
echo ""

read -rp "Proceed? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    exit 1
fi

# Build the combined all-in-one image if Dockerfile exists
if [ -f "$BUILD_DIR/dockerfiles/all-in-one/Dockerfile" ]; then
    echo ""
    echo "Building all-in-one image..."
    docker build \
        -f "$BUILD_DIR/dockerfiles/all-in-one/Dockerfile" \
        -t "${DOCKER_REGISTRY}/${DOCKER_PREFIX}:latest" \
        "$BUILD_DIR"
fi

echo ""
echo "Build complete."
echo ""
echo "To deploy, copy docker-compose.custom.yml from the project root and run:"
echo "  docker compose -f docker-compose.custom.yml up -d"
echo ""
echo "Then set your DNS to point to this server and configure SSL."