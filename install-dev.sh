#!/bin/bash
set -e

echo "🔨 Building..."
npm run build

echo "📦 Packing CLI..."
cd cli
tgz=$(npm pack 2>/dev/null | tail -n1)
cd ..

echo "🌍 Installing globally..."
CXXFLAGS="-include cstdint" npm install -g "./cli/$tgz"

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
