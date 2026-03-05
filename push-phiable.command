#!/bin/bash
# push-phiable.command
# Double-click to deploy. Scans for dangerous patterns before pushing.
# If scan fails, nothing is deployed. Fix the issue first.

cd ~/Downloads/phiable

echo ""
echo "=== Phiable Safety Scan ==="
echo ""

FAIL=0

# Files that are intentional tools — they write to the store on purpose, skip them
INTENTIONAL_TOOLS="reset.mjs restore.mjs articles.mjs config.mjs"

# ── Scan all .mjs function files ─────────────────────────────
for f in netlify/functions/*.mjs; do
  [ -f "$f" ] || continue
  fname=$(basename "$f")

  # Skip intentional tools — they write to the store deliberately
  if echo "$INTENTIONAL_TOOLS" | grep -qw "$fname"; then
    echo "⚙  $fname — intentional tool, skipping scan"
    continue
  fi

  # RULE 1: Any file that reads from the articles blob store must have SAFETY GUARD comments
  if grep -q "getStore('articles')" "$f" || grep -q 'getStore("articles")' "$f"; then
    if ! grep -q "SAFETY GUARD" "$f"; then
      echo "❌ FAIL: $fname reads from articles store but has no SAFETY GUARD comment"
      echo "   This file could wipe your article database."
      echo "   Add safety guards before deploying."
      FAIL=1
    else
      echo "✓  $fname — safety guards present"
    fi
  fi

  # RULE 2: Dangerous initialization pattern — index = [] or index = { articles: [] 
  # without a preceding store list check
  if grep -q "getStore('articles')" "$f" || grep -q 'getStore("articles")' "$f"; then
    # Check for the dangerous pattern: assigning empty articles without abort guard
    if grep -qE "index\s*=\s*\{\s*articles\s*:\s*\[\]" "$f"; then
      # Make sure there's also a safety abort nearby
      if ! grep -q "SAFETY ABORT" "$f"; then
        echo "❌ FAIL: $fname contains index={articles:[]} without SAFETY ABORT guard"
        echo "   This will wipe your database on any load failure."
        FAIL=1
      fi
    fi
  fi

  # RULE 3: reset.mjs should never be accidentally deployed with a blank secret
  if [ "$fname" = "reset.mjs" ]; then
    if grep -q "phiable-reset-2026" "$f"; then
      echo "✓  reset.mjs — secret key present"
    else
      echo "❌ FAIL: reset.mjs has no secret key — anyone could wipe the database"
      FAIL=1
    fi
  fi

done

echo ""

if [ $FAIL -ne 0 ]; then
  echo "=== DEPLOY BLOCKED ==="
  echo "Fix the issues above before deploying."
  echo "Press any key to close."
  read -n 1
  exit 1
fi

echo "=== Scan passed. Deploying... ==="
echo ""

git add -A
git commit -m "update $(date '+%b %d %I:%M%p')"
git push

echo ""
echo "✓ Phiable deployed."
echo "  Monitor: https://phiable.netlify.app/monitor"
echo "  Restore: https://phiable.netlify.app/api/restore?secret=phiable-reset-2026"
echo ""
echo "Press any key to close."
read -n 1
