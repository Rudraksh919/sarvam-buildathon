#!/bin/sh
# Clone (or update) the target repo onto the persistent disk, then start the server.
set -e
mkdir -p "$DATA_DIR/runs" "$DATA_DIR/skills"
if [ -n "$TARGET_REPO_URL" ]; then
  if [ -d "$DATA_DIR/repo/.git" ]; then git -C "$DATA_DIR/repo" pull --ff-only || echo "git pull failed, using existing checkout"
  else git clone --depth 1 "$TARGET_REPO_URL" "$DATA_DIR/repo"; fi
  export REPO_PATH="$DATA_DIR/repo"
fi
exec npx tsx src/server.ts
