#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GOLOGIN_TOKEN:-}" ]]; then
  echo "GOLOGIN_TOKEN is required" >&2
  exit 1
fi

node dist/cli.js open https://example.com --idle-timeout-ms 300000
node dist/cli.js snapshot -i
node dist/cli.js current
node dist/cli.js get title
node dist/cli.js find text "Learn more" click
node dist/cli.js scroll down 400
node dist/cli.js wait 1000
node dist/cli.js sessions
node dist/cli.js pdf examples/example-page.pdf
node dist/cli.js screenshot examples/example-page.png --annotate
node dist/cli.js close
