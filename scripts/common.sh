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

# An inherited project selection would override the checked .vercel link.
unset VERCEL_PROJECT_ID VERCEL_ORG_ID

# Prints one field of .vercel/project.json, or nothing when it is absent.
# Parsed as JSON, because the CLI's formatting is not a contract.
linked_value() {
  node -e '
    try {
      const value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]
      if (typeof value === "string") process.stdout.write(value)
    } catch {}
  ' "$REPO_ROOT/.vercel/project.json" "$1"
}

# Succeeds when .vercel/ points at this project, in this team.
linked_to_safenet() {
  [ "$(linked_value projectId)" = "$SAFENET_VERCEL_PROJECT_ID" ] &&
    [ "$(linked_value orgId)" = "$SAFENET_VERCEL_ORG_ID" ]
}

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

# Prints the variable names of an env file, sorted. Accepts the dotenv forms
# `KEY=value`, `KEY = value` and `export KEY=value`.
env_keys() {
  [ -f "$1" ] || return 0
  sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*/\2/p' "$1" | sort -u
}

# Keeps a backup when the new content drops keys that the target holds.
guard_env_overwrite() {
  local target="$1" replacement="$2" lost
  [ -f "$target" ] || return 0

  lost="$(comm -23 <(env_keys "$target") <(env_keys "$replacement"))"
  [ -n "$lost" ] || return 0
  lost="$(echo "$lost" | tr '\n' ' ')"

  # `.env.local` -> `.env.backup.<time>.local`, so the repo's `.env.*.local`
  # rule already ignores the backup. A `.bak` suffix would not match it. The
  # time stamp, and a counter within one second, keep each backup, so a later
  # pull never replaces an earlier one.
  local stamp backup n=1
  stamp="${target%.local}.backup.$(date +%Y%m%d-%H%M%S)"
  backup="$stamp.local"
  while [ -e "$backup" ]; do
    backup="$stamp-$n.local"
    n=$((n + 1))
  done
  cp "$target" "$backup"
  chmod 600 "$backup"
  warn "These keys exist only in $target: $lost"
  warn "Saved the old file as $backup"
}
