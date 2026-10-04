#!/usr/bin/env bash
# Links this worktree to the Vercel project, at the repository root.
# The Root Directory setting on Vercel is independent of where .vercel/ lives.
set -euo pipefail
SCRIPT_TAG="link"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$REPO_ROOT"

# `vercel link` also pulls the development variables into .env.local, without
# the backup that `pnpm env:pull` keeps. Put the file back as it was, so that
# env:pull stays the only writer.
without_env_edits() {
  local file="$REPO_ROOT/.env.local"
  local snapshot="" rc=0

  if [ -f "$file" ]; then
    snapshot="$(mktemp)"
    cp "$file" "$snapshot"
  fi

  "$@" || rc=$?

  if [ -n "$snapshot" ]; then
    cmp -s "$snapshot" "$file" || cp "$snapshot" "$file"
    rm -f "$snapshot"
  else
    rm -f "$file"
  fi

  return "$rc"
}

link_vercel() {
  if linked_to_safenet; then
    log "Vercel is already linked to ${SAFENET_VERCEL_SCOPE}/${SAFENET_VERCEL_PROJECT}. Skip."
    return 0
  fi
  if [ -f .vercel/project.json ]; then
    warn ".vercel points at a different project. Link it again."
  fi
  require_cli vercel || return 1

  log "Link Vercel to ${SAFENET_VERCEL_SCOPE}/${SAFENET_VERCEL_PROJECT}..."
  without_gitignore_edits without_env_edits \
    vercel link --yes --scope "$SAFENET_VERCEL_SCOPE" --project "$SAFENET_VERCEL_PROJECT" </dev/null

  if ! linked_to_safenet; then
    warn "The link did not produce ${SAFENET_VERCEL_SCOPE}/${SAFENET_VERCEL_PROJECT}. Check .vercel/project.json."
    return 1
  fi
}

link_vercel

if [ -d apps/web/.vercel ]; then
  warn "apps/web/.vercel exists. A link there makes the CLI write apps/web/.env.local. Delete it."
fi
