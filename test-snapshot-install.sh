#!/bin/bash
set -e

echo "Building snapshot packages..."
npm run build

echo "Packing CLI..."
tgz=$(npm pack ./cli | tail -n1)

echo "Testing snapshot install..."
tmpdir=$(mktemp -d)
trap "rm -rf $tmpdir" EXIT

npm install -g "./$tgz" --prefix "$tmpdir" --loglevel=error

echo "Verifying installation..."
if "$tmpdir/bin/dryscan" --help > /dev/null 2>&1; then
  echo "✓ Snapshot install successful"
  "$tmpdir/bin/dryscan" --help | head -3
  rm "$tgz"
  exit 0
else
  echo "✗ Snapshot install failed"
  rm "$tgz"
  exit 1
fi
