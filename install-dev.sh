#!/bin/bash
set -e

echo "🗑️  Clearing npm cache..."
npm cache clean --force

echo "🗑️  Uninstalling old version..."
npm uninstall -g @goshenkata/dryscan-cli 2>/dev/null || true

echo "🔨 Building..."
npm run build

echo "📦 Packing CLI..."
cd cli
tgz=$(npm pack 2>/dev/null | tail -n1)
cd ..

echo "🌍 Installing globally from local tarball..."
CXXFLAGS="-include cstdint" npm install -g --force --no-save "./cli/$tgz"

echo "✅ Verifying installation..."
if dryscan --help &>/dev/null; then
  echo "✓ Installation successful"
  echo ""
  dryscan --help | head -5
  echo ""
else
  echo "✗ Installation failed"
  rm -f "cli/$tgz"
  exit 1
fi

echo ""
echo "📝 To test:"
echo "  dryscan init"
echo "  dryscan update"
echo "  dryscan dupes"
echo ""
echo "📤 To uninstall dev version:"
echo "  npm uninstall -g @goshenkata/dryscan-cli"
echo ""
echo "Tarball: cli/$tgz"
