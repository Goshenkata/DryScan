#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

echo "Installing workspace dependencies..."
npm install

echo "Building workspaces..."
npm run build

echo "Linking all workspaces globally..."
npm link --workspaces

echo "Verifying global dryscan uses this checkout..."
dryscan --help | head -8
