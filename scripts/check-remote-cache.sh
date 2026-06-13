#!/usr/bin/env bash
set -e

OUTPUT="$(npx turbo run build --dry 2>&1 || true)"

if echo "$OUTPUT" | grep -q "Cached (Remote)"; then
  exit 0
fi

echo ""
echo "❌ Turbo remote cache is required for development."
echo "Please run:"
echo "  npx turbo login"
echo "  npx turbo link"
echo ""
exit 1