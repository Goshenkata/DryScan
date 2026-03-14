#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

echo "📦 Installing workspace dependencies..."
npm install

echo "🔨 Building workspaces..."
npm run build

echo "🔗 Linking local core globally..."
(
  cd core
  npm link
)

echo "🔗 Linking local CLI globally (using linked core)..."
(
  cd cli
  npm link @goshenkata/dryscan-core
  npm link
)

echo "✅ Verifying global dryscan uses this checkout..."
dryscan --help | head -8
