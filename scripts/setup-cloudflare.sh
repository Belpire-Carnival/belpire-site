#!/usr/bin/env bash
# One-time: create the Cloudflare Pages project that GitHub Actions deploys to.
# Usage: scripts/setup-cloudflare.sh [project-name]
# Needs: Node 22+, a browser for the Wrangler login.
set -euo pipefail

PROJECT="${1:-belpire}"
cd "$(dirname "$0")/.."

[[ -f package-lock.json ]] || npm install --no-audit --no-fund
WRANGLER="npx --no-install wrangler"

echo "==> Logging in to Cloudflare (opens your browser)"
$WRANGLER login

echo "==> Your account"
$WRANGLER whoami

if $WRANGLER pages project list 2>/dev/null | grep -qw "$PROJECT"; then
  echo "==> Pages project '$PROJECT' already exists"
else
  echo "==> Creating Pages project '$PROJECT' (production branch: main)"
  $WRANGLER pages project create "$PROJECT" --production-branch=main
fi

cat <<EOF

Done. Note the Account ID shown above — setup-github.sh asks for it.
The site will live at https://$PROJECT.pages.dev until belpire.com is attached.

Logging this machine out of Wrangler (GitHub Actions uses its own scoped API token):
EOF
$WRANGLER logout
