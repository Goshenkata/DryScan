#!/bin/bash

set -e

echo "=== DryScan Integration Test ==="
echo ""

# Navigate to the test project directory
cd "$(dirname "$0")/test-java-project"

echo "Step 0: Cleaning up previous test data..."
rm -rf .dryscan

echo "Step 1: Installing DryScan CLI..."
npm install -g ..

echo ""
echo "Step 2: Initializing DryScan..."
dryscan init

echo ""
echo "Step 3: Finding duplicates..."
dryscan dupes

echo ""
echo "=== Test Complete ==="
