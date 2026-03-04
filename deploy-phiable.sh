#!/bin/bash
# deploy-phiable.sh - Auto-renames phicron to force fresh Netlify deploy
cd ~/Downloads/phiable

# Find current phicron file
CURRENT=$(ls netlify/functions/phicron*.mjs 2>/dev/null | head -1)
if [ -z "$CURRENT" ]; then
  echo "No phicron file found in netlify/functions/"
  exit 1
fi

# Extract current number (phicron.mjs=0, phicron2.mjs=2, etc.)
BASENAME=$(basename "$CURRENT" .mjs)
NUM=$(echo "$BASENAME" | grep -o '[0-9]*$')
NEXT=$((${NUM:-1} + 1))
NEWNAME="netlify/functions/phicron${NEXT}.mjs"

echo "Renaming $CURRENT → $NEWNAME"
cp "$CURRENT" "$NEWNAME"
rm "$CURRENT"

git add -A && git commit -m "deploy phicron${NEXT}" && git push
echo "Done. Watch for phicron${NEXT} in Netlify Functions."
