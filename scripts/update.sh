#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="main"
UPSTREAM_DIR="$PROJECT_DIR/upstream"

echo "=== AliasVault Custom Fork - Update Script ==="

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
    echo "Cloning upstream AliasVault into $UPSTREAM_DIR ..."
    git clone --branch "$UPSTREAM_BRANCH" --depth 1 "https://github.com/aliasvault/aliasvault.git" "$UPSTREAM_DIR"
else
    echo "Fetching upstream changes..."
    cd "$UPSTREAM_DIR"
    git fetch upstream
    if git diff --quiet upstream/"$UPSTREAM_BRANCH"; then
        echo "Already up to date with upstream/$UPSTREAM_BRANCH."
    else
        echo "Pulling upstream/$UPSTREAM_BRANCH ..."
        git checkout "$UPSTREAM_BRANCH" 2>/dev/null || git checkout -b "$UPSTREAM_BRANCH" upstream/"$UPSTREAM_BRANCH"
        git reset --hard upstream/"$UPSTREAM_BRANCH"
    fi
fi

echo "Done. Upstream code is in $UPSTREAM_DIR"