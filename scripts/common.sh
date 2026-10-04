#!/usr/bin/env bash
# Shared configuration and helpers. Other scripts source this file.
# Do not run it directly.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
export REPO_ROOT

# Identifiers, not secrets. The names carry a SAFENET_ prefix on purpose:
# `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` are read by the Vercel CLI itself,
# and an exported half-set makes it fail. These stay unexported too.
SAFENET_VERCEL_SCOPE="cobuilders"
SAFENET_VERCEL_PROJECT="safenet-staking"
SAFENET_VERCEL_PROJECT_ID="prj_ZLbUcYUyeXy2pYAdIg5I0Hs4kSfY"
SAFENET_VERCEL_ORG_ID="team_TPIgHN6kXsahQxg5O69ubU0F"

log() {
  echo "[$SCRIPT_TAG] $*"
}

warn() {
  echo "[$SCRIPT_TAG] $*" >&2
}

# Returns 1 when the CLI is missing, so the caller can report a failed step.
require_cli() {
  if ! command -v "$1" >/dev/null 2>&1; then
    warn "The $1 CLI is not on the PATH."
    return 1
  fi
}

# Runs a command, then undoes any edit that it makes to .gitignore.
# `vercel link` and `vercel env pull` append `.vercel` and `.env*.local` there.
# The repo ignores both already. A snapshot keeps unstaged and staged work.
without_gitignore_edits() {
  local file="$REPO_ROOT/.gitignore"
  local snapshot="" rc=0

  if [ -f "$file" ]; then
    snapshot="$(mktemp)"
    cp "$file" "$snapshot"
  fi

  "$@" || rc=$?

  if [ -n "$snapshot" ] && ! cmp -s "$snapshot" "$file"; then
    cp "$snapshot" "$file"
    log "Reverted the .gitignore lines that the CLI added."
  fi
  if [ -n "$snapshot" ]; then
    rm -f "$snapshot"
  fi

  return "$rc"
}

# Prints the variable names of an env file, sorted.
env_keys() {
  [ -f "$1" ] || return 0
  sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$1" | sort -u
}

# Keeps a backup when the new content drops keys that the target holds.
guard_env_overwrite() {
  local target="$1" replacement="$2" lost
  [ -f "$target" ] || return 0

  lost="$(comm -23 <(env_keys "$target") <(env_keys "$replacement"))"
  [ -n "$lost" ] || return 0
  lost="$(echo "$lost" | tr '\n' ' ')"

  # `.env.local` -> `.env.backup.local`, so the repo's `.env.*.local` rule
  # already ignores the backup. A `.bak` suffix would not match it.
  local backup="${target%.local}.backup.local"
  cp "$target" "$backup"
  chmod 600 "$backup"
  warn "These keys exist only in $target: $lost"
  warn "Saved the old file as $backup"
}
