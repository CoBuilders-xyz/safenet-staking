#!/usr/bin/env bash
# Starts the status page image on config.yaml with synthetic secrets, and fails unless Gatus
# loads the configuration and both alert providers. Needs Docker and no secret: the values below
# are made up, and the checks they feed fail, which is not what this tests.
#
#   bash ops/status/check-config.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
image="safenet-status-check:local"
name="safenet-status-check-$$"
port="${STATUS_CHECK_PORT:-18080}"
data="$(mktemp -d)"
chmod 777 "$data"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$data"
}
trap cleanup EXIT

docker build --quiet --tag "$image" "$here" >/dev/null
docker run --detach --name "$name" --publish "127.0.0.1:${port}:8080" --volume "$data:/data" \
  --env SLACK_WEBHOOK_URL=https://hooks.slack.invalid/services/T0/B0/synthetic \
  --env FRIDAY_WEBHOOK_URL=https://friday.invalid/hooks/status \
  --env FRIDAY_WEBHOOK_KEY=synthetic-key \
  --env GRAPH_API_KEY=synthetic-key \
  "$image" >/dev/null

healthy=""
for _ in $(seq 1 60); do
  if [ "$(docker inspect --format '{{.State.Running}}' "$name")" != "true" ]; then break; fi
  if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
logs="$(docker logs "$name" 2>&1)"

if [ -z "$healthy" ]; then
  echo "$logs" | tail -n 40
  echo "::error title=Status page configuration::Gatus did not start on ops/status/config.yaml."
  exit 1
fi
# "ignoredProviders" also lists every provider this file does not configure.
configured="$(echo "$logs" | grep -o 'configuredProviders=\[[^]]*\]' | head -n 1)"
echo "Gatus started. ${configured}"
for provider in slack custom; do
  if ! echo "$configured" | grep -Eq "[[ ]${provider}[] ]"; then
    echo "::error title=Status page configuration::Gatus did not load the ${provider} alert provider."
    exit 1
  fi
done
if echo "$logs" | grep -q "has invalid overrides"; then
  echo "$logs" | grep "has invalid overrides"
  echo "::error title=Status page configuration::An alert override is invalid."
  exit 1
fi
echo "ops/status/config.yaml: valid."
