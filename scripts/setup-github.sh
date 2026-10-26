#!/usr/bin/env bash
# Create the public repo in your GitHub org and apply every security setting,
# Actions policy, environment and the main-branch ruleset. Safe to re-run.
#
# Usage:
#   scripts/setup-github.sh [org] [repo]          # defaults: Belpire-Carnival belpire-site
#
# Needs: git, gh (GitHub CLI) logged in with org-admin scope:
#   gh auth login -s admin:org,repo,workflow
set -euo pipefail

ORG="${1:-Belpire-Carnival}"
REPO="${2:-belpire-site}"
FULL="$ORG/$REPO"
SITE_URL="https://belpire.com"
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[31m!\033[0m %s\n' "$*"; }
# Run a call; on failure print a warning instead of stopping (some settings are plan-dependent).
try()  { local label="$1"; shift; local out; if out=$("$@" 2>&1); then ok "$label"; else warn "$label — skipped: $(echo "$out" | tail -1)"; fi; }
api()  { gh api -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }

# ---------------------------------------------------------------- prerequisites
say "Checking tools and login"
for bin in git gh; do command -v "$bin" >/dev/null || { echo "Missing: $bin"; exit 1; }; done
gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login -s admin:org,repo,workflow"; exit 1; }
api "orgs/$ORG" --jq .login >/dev/null || { echo "Org '$ORG' not found or you're not an owner."; exit 1; }
ok "gh is logged in and can see org $ORG"

if [[ "$(git config --get commit.gpgsign || true)" != "true" ]]; then
  warn "Commit signing isn't on. The ruleset requires signed commits — set it up first (README step 1)."
  read -r -p "    Continue anyway? [y/N] " a; [[ "$a" =~ ^[Yy]$ ]] || exit 1
fi

# ---------------------------------------------------------------- org defaults
say "Organization defaults ($ORG)"
try "Members get read access by default; only owners create repos" \
  api -X PATCH "orgs/$ORG" --input - <<'JSON'
{
  "default_repository_permission": "read",
  "members_can_create_repositories": false,
  "members_can_create_public_repositories": false,
  "members_can_create_private_repositories": false,
  "members_can_fork_private_repositories": false,
  "members_can_create_pages": false
}
JSON
try "Org Actions: GitHub-owned actions only" \
  api -X PUT "orgs/$ORG/actions/permissions" -f enabled_repositories=all -f allowed_actions=selected
try "Org Actions: no verified-creator or third-party actions" \
  api -X PUT "orgs/$ORG/actions/permissions/selected-actions" -F github_owned_allowed=true -F verified_allowed=false
try "Org Actions: read-only GITHUB_TOKEN, can't approve PRs" \
  api -X PUT "orgs/$ORG/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

# ---------------------------------------------------------------- first commit
say "Preparing the local repository"
[[ -d .git ]] || git init -q -b main
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Set up belpire.com: site, Steam feed, Cloudflare build"
  ok "Committed local files"
else
  ok "Nothing new to commit"
fi

# ---------------------------------------------------------------- repo
say "Repository $FULL"
if api "repos/$FULL" >/dev/null 2>&1; then
  ok "Repo already exists"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$FULL.git"
else
  gh repo create "$FULL" --public --source=. --remote=origin \
    --description "Belpire Carnival — belpire.com" --homepage "$SITE_URL"
  ok "Created public repo"
fi
# First push happens before the ruleset exists; afterwards every change goes through a PR.
if ! api "repos/$FULL/branches/main" >/dev/null 2>&1; then
  git push -u origin main
  ok "Pushed main"
fi

try "Repo features: squash-only merges, no wiki/projects, delete merged branches" \
  api -X PATCH "repos/$FULL" --input - <<JSON
{
  "homepage": "$SITE_URL",
  "has_wiki": false,
  "has_projects": false,
  "has_discussions": false,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "allow_squash_merge": true,
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "PR_BODY",
  "delete_branch_on_merge": true,
  "allow_update_branch": true
}
JSON

# ---------------------------------------------------------------- security features (free on public repos)
say "Security features"
try "Secret scanning + push protection" \
  api -X PATCH "repos/$FULL" --input - <<'JSON'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" },
    "secret_scanning_non_provider_patterns": { "status": "enabled" },
    "secret_scanning_validity_checks": { "status": "enabled" } } }
JSON
try "Dependabot alerts"               api -X PUT "repos/$FULL/vulnerability-alerts"
try "Dependabot security updates"     api -X PUT "repos/$FULL/automated-security-fixes"
try "Private vulnerability reporting" api -X PUT "repos/$FULL/private-vulnerability-reporting"
if api -X PATCH "repos/$FULL/code-scanning/default-setup" --input - >/dev/null 2>&1 <<'JSON'
{ "state": "configured", "query_suite": "default", "languages": ["javascript-typescript", "actions"] }
JSON
then
  ok "CodeQL default setup (JavaScript + workflow files)"
else
  try "CodeQL default setup (JavaScript)" api -X PATCH "repos/$FULL/code-scanning/default-setup" \
    -f state=configured -f query_suite=default -f 'languages[]=javascript-typescript'
fi

# ---------------------------------------------------------------- actions policy
say "GitHub Actions policy"
if api -X PUT "repos/$FULL/actions/permissions" -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true >/dev/null 2>&1; then
  ok "Actions enabled, selected actions only, SHA pinning required"
else
  try "Actions enabled, selected actions only" api -X PUT "repos/$FULL/actions/permissions" -F enabled=true -f allowed_actions=selected
fi
try "Only GitHub-owned actions" \
  api -X PUT "repos/$FULL/actions/permissions/selected-actions" -F github_owned_allowed=true -F verified_allowed=false
try "Default GITHUB_TOKEN is read-only; Actions can't approve PRs" \
  api -X PUT "repos/$FULL/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
try "Fork PRs need approval before workflows run" \
  api -X PUT "repos/$FULL/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors

# ---------------------------------------------------------------- environment + deploy hook secret
say "production environment"
try "production environment (main branch only)" \
  api -X PUT "repos/$FULL/environments/production" --input - <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
if api -X POST "repos/$FULL/environments/production/deployment-branch-policies" -f name=main -f type=branch >/dev/null 2>&1; then
  ok "production: only main can use it"
else
  ok "production: main branch policy already present"
fi

echo "    Cloudflare deploy hook URL (created in README step 4). Paste it now, or press Enter to add it later:"
read -r -s HOOK; echo
if [[ -n "$HOOK" ]]; then
  if [[ "$HOOK" =~ ^https://api\.cloudflare\.com/client/v4/(workers/builds|pages/webhooks)/deploy_hooks/ ]]; then
    printf '%s' "$HOOK" | gh secret set CF_DEPLOY_HOOK --repo "$FULL" --env production && ok "production: CF_DEPLOY_HOOK"
  else
    warn "That doesn't look like a Cloudflare deploy hook URL; skipped"
  fi
else
  ok "Skipped — add later with: gh secret set CF_DEPLOY_HOOK --repo $FULL --env production"
fi
unset HOOK

# ---------------------------------------------------------------- ruleset (last, after the first push)
say "Branch ruleset"
RULESET_ID=$(api "repos/$FULL/rulesets" --jq '.[] | select(.name=="Protect main") | .id' 2>/dev/null || true)
if [[ -n "$RULESET_ID" ]]; then
  try "Updated 'Protect main'" api -X PUT "repos/$FULL/rulesets/$RULESET_ID" --input .github/rulesets/main.json
else
  try "Created 'Protect main' (PR + passing tests + signed commits, no force-push or delete)" \
    api -X POST "repos/$FULL/rulesets" --input .github/rulesets/main.json
fi

cat <<EOF

GitHub side is done: https://github.com/$FULL

Next (README):
  4. Cloudflare › Workers & Pages › Create › Import a repository (Workers Builds)
       - GitHub app access: Only select repositories → $REPO
       - Build command: node scripts/cf-build.mjs   Deploy command: npx wrangler deploy
       - Build variables: NODE_VERSION=22, SITE_URL=$SITE_URL, DISCORD_WEBHOOK_URL (secret, optional)
     Then Settings › Builds › Deploy Hooks › add "steam-feed" on main, and run:
       gh secret set CF_DEPLOY_HOOK --repo $FULL --env production
  5. Settings › Domains & Routes: add belpire.com and www.belpire.com
  6. Drop the org-admin scope:  gh auth refresh --remove-scopes admin:org
EOF
