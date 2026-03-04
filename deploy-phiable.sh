#!/bin/bash
# deploy-phiable.sh
# Run this FROM inside your phiable repo folder, after copying files in manually.
# Usage: cd ~/path/to/phiable && bash deploy-phiable.sh

set -e

# Confirm we're in the right place
if [ ! -d "netlify/functions" ]; then
  echo "ERROR: Run this from inside your phiable repo (netlify/functions not found here)"
  echo "  cd ~/path/to/phiable && bash deploy-phiable.sh"
  exit 1
fi

echo "=== Phiable Deploy ==="
echo "Repo: $(pwd)"

# Find current phicron file
CURRENT=$(ls netlify/functions/phicron*.mjs 2>/dev/null | sort -V | tail -1)
if [ -z "$CURRENT" ]; then
  echo "ERROR: No phicron*.mjs found in netlify/functions/"
  exit 1
fi

echo "Current cron: $CURRENT"

# Compute next number
BASENAME=$(basename "$CURRENT" .mjs)
NUM=$(echo "$BASENAME" | grep -o '[0-9]*$')
NEXT=$((${NUM:-1} + 1))
NEWFILE="netlify/functions/phicron${NEXT}.mjs"

# Rename to force Netlify to re-register the function
cp "$CURRENT" "$NEWFILE"
rm "$CURRENT"
echo "✓ Renamed to phicron${NEXT}.mjs"

# Show what's changed
echo ""
echo "Files staged for deploy:"
git status --short

# Commit and push
git add -A
git commit -m "deploy: phicron${NEXT}"
git push

echo ""
echo "✓ Pushed. Watch Netlify dashboard."
echo "  After build completes, run:"
echo "  curl 'https://phiable.netlify.app/api/reset?secret=phiable-reset-2026'"
