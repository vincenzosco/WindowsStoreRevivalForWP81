#!/usr/bin/env sh
# Start the WP Store Lab interception server.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required but was not found in PATH." >&2
  exit 1
fi

exec node src/main.mjs "$@"
