#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/build"

echo "=== MyVault - Build ==="

if [ ! -d "$BUILD_DIR" ]; then
    echo "Build directory not found. Running update + apply-branding first..."
    bash "$SCRIPT_DIR/update.sh"
    bash "$SCRIPT_DIR/apply-branding.sh"
fi

DOCKER_REGISTRY=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/branding.json'))['docker_registry'])")
DOCKER_PREFIX=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/branding.json'))['docker_image_prefix'])")

echo "Building image: $DOCKER_REGISTRY/$DOCKER_PREFIX:latest"
echo "Using Dockerfile from $BUILD_DIR/dockerfiles/all-in-one/Dockerfile"
echo ""

if [ ! -f "$BUILD_DIR/dockerfiles/all-in-one/Dockerfile" ]; then
    echo "ERROR: Dockerfile not found at $BUILD_DIR/dockerfiles/all-in-one/Dockerfile"
    echo "Make sure upstream code was fetched (run update.sh first)."
    exit 1
fi

docker build \
    -f "$BUILD_DIR/dockerfiles/all-in-one/Dockerfile" \
    -t "${DOCKER_REGISTRY}/${DOCKER_PREFIX}:latest" \
    "$BUILD_DIR"