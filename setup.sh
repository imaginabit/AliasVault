#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== MyVault (AliasVault Fork) - Setup ==="

if [ ! -f "$PROJECT_DIR/branding.json" ]; then
    echo "ERROR: branding.json not found!"
    exit 1
fi

echo "Step 1: Ensuring upstream remote is configured..."
cd "$PROJECT_DIR"
if ! git remote | grep -q upstream; then
    git remote add upstream https://github.com/aliasvault/aliasvault.git
    echo "  Added 'upstream' remote."
else
    echo "  'upstream' remote already exists."
fi

echo ""
echo "Step 2: Pulling upstream code..."
bash "$SCRIPT_DIR/scripts/update.sh"

echo ""
echo "Step 3: Applying branding..."
bash "$SCRIPT_DIR/scripts/apply-branding.sh"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Review branding.json and customize if needed"
echo "  2. Replace files in branding/ with your own logos"
echo "  3. Run ./scripts/build.sh to build Docker images"
echo "  4. Deploy with docker compose -f docker-compose.deploy.yml up -d"
echo ""
echo "To update later: ./scripts/update.sh && ./scripts/apply-branding.sh"