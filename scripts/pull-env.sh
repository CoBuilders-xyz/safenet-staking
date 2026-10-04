#!/usr/bin/env bash
# Pulls the Vercel development environment variables into .env.local at the
# repository root, where the Node scripts read them. Nothing goes to apps/web:
# Vite needs no secret, and the build must never see one.
set -euo pipefail
SCRIPT_TAG="env"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$REPO_ROOT"

TARGET=".env.local"

if [ ! -f .vercel/project.json ]; then
  warn "Vercel is not linked. Run 'pnpm link:services' first."
  exit 1
fi
if ! linked_to_safenet; then
  warn ".vercel points at a different project. Run 'pnpm link:services' first."
  exit 1
fi
require_cli vercel || exit 1

fresh="$(mktemp)"
trap 'rm -f "$fresh"' EXIT

log "Pull the development environment variables from Vercel..."
without_gitignore_edits \
  vercel env pull "$fresh" --environment development --yes </dev/null

if [ ! -s "$fresh" ]; then
  warn "Vercel returned an empty file. Keep the current $TARGET."
  exit 1
fi

guard_env_overwrite "$TARGET" "$fresh"
cp "$fresh" "$TARGET"
chmod 600 "$TARGET"
log "Wrote $TARGET."
