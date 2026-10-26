# Belpire Carnival — belpire.com

Static site for the Belpire Carnival community. The code lives in GitHub (`Belpire-Carnival/belpire-site`, public). Cloudflare hosts it as a static-assets Worker and builds it through Workers Builds, its GitHub integration.

```
 you ──PR──▶ GitHub ──CI (test)──▶ squash-merge to main ──▶ Cloudflare Workers Build ──▶ belpire.com
               │                                                ▲
               └── every PR branch gets a Cloudflare preview URL │
 every 6h: GitHub Action ──POST deploy hook──────────────────────┘  (build refreshes the Steam feed)
```

Each Cloudflare build downloads the live `feed.json`, refreshes it from Steam, and publishes `site/`. Nothing is ever committed by a bot, so `main` stays fully locked: changes land only through pull requests with passing tests and signed commits.

## What's in the repo

| Path | Purpose |
|---|---|
| `site/` | The website (no build tooling). Edit game nights, oddities and ringleaders in `index.html`; set `DISCORD_INVITE` at the top of `app.js`. |
| `site/_headers` | CSP, HSTS and other security headers, plus cache rules. |
| `site/404.html` | Not-found page. |
| `wrangler.jsonc` | Cloudflare Worker config: name `belpire-site`, serves `site/`, runs `worker/` for `/api/*` and the 10-minute cron. |
| `site/star-citizen/` | The Star Citizen page (belpire.com/star-citizen/). |
| `worker/` | Server code: `/api/star-citizen`, the RSI status and Comm-Link readers, and Discord alerts. Tests in `worker/test/`. |
| `config/games.json` | Your favorite games (Steam app IDs + tent) and the upcoming-game searches. |
| `scripts/cf-build.mjs` | Cloudflare's build command: loads the live feed, then runs the Steam refresh. |
| `scripts/update-feed.mjs` | Steam → `site/data/feed.json`, plus Discord posts on production builds. |
| `.github/workflows/ci.yml` | Syntax checks and unit tests on every PR. Required to merge. |
| `.github/workflows/refresh-feed.yml` | Calls the Cloudflare deploy hook every 6 hours. |
| `.github/dependabot.yml` | Weekly PRs to keep the pinned action SHAs current. |
| `.github/rulesets/main.json` | Branch protection for `main`, applied by the setup script. |
| `scripts/setup-github.sh` | Creates the repo and applies every GitHub setting. Safe to re-run. |
| `brand/` | Org and RingMaster avatars (PNG and SVG). |

---


Press Enter at the deploy hook prompt for now; you'll add it in step 4. The script does the following:

| Area | Setting |
|---|---|
| **Org defaults** | Members get read-only access and can't create repos or fork. Actions are limited to GitHub-owned ones, the default token is read-only, and Actions can't approve PRs. |
| **Repo** | Public, squash merges only, branches deleted after merge, wiki and projects off. |
| **Security (free on public repos)** | Secret scanning (including non-provider patterns and validity checks), push protection, Dependabot alerts and security updates, CodeQL for JavaScript and workflow files, private vulnerability reporting. |
| **Actions** | GitHub-owned actions only, SHA pinning required, read-only `GITHUB_TOKEN`, approval required for fork PR workflows. |
| **`production` environment** | Usable from `main` only. Holds the deploy hook secret. |
| **Ruleset on `main`** | PR required, `test` must pass on an up-to-date branch, signed commits, linear history, review threads resolved, no force-push or deletion. |

Settings that depend on your GitHub plan print a red `!` and are skipped instead of stopping the script.

## Day-to-day

```bash
git switch -c new-game-night
# edit files…
git commit -am "Add Friday game night"        # signed automatically
git push -u origin new-game-night
gh pr create --fill
```

The PR runs `test`, and Cloudflare posts a preview link on it. Squash-merge, and Cloudflare deploys production within a minute or two.

- **Feed refresh:** runs every 6 hours. Each run reads the live `feed.json`, asks Steam for updates, and posts new items to Discord if the webhook is set. Nothing is posted on the very first build.
- **Dependabot:** opens weekly PRs to bump the pinned action SHAs. Merge them when `test` passes.
- **Refresh the feed now:** `gh workflow run refresh-feed.yml --repo Belpire-Carnival/belpire-site`
- **Local preview:** `npm run feed && npm run dev`, then open <http://localhost:8080>.

## Troubleshooting

- **The push is rejected by a rule.** Your commit isn't signed. Check `git log --show-signature -1` and go back over step 1.
- **Refresh workflow error: `CF_DEPLOY_HOOK secret is not set`.** Do step 4.7.
- **A Cloudflare build fails with a Node error.** Check that `NODE_VERSION=22` is set under the build's *Variables and secrets*.
- **The build says the Worker name doesn't match.** The Worker's name in Cloudflare must equal `name` in `wrangler.jsonc` (`belpire-site`).
- **The feed is empty after the first build.** Steam may have rate-limited the build. Run the refresh workflow again. The store endpoints are public but undocumented; when a search fails, the last good data stays up.
- **The deploy hook leaked.** Delete it in Cloudflare, create a new one, and update the `CF_DEPLOY_HOOK` secret.
- **A pinned action version is rejected.** SHA pinning is enforced, so a bare `@v7` reference fails. Use a full commit SHA with a `# vX.Y.Z` comment, as in the existing workflows.

---

## Star Citizen page (belpire.com/star-citizen/)

The **Star Citizen** link in the top navigation opens a page showing live RSI server status and the latest Comm-Link news. It also posts new Comm-Links, new incidents and status changes to Discord. Everything runs inside the same `belpire-site` Worker; there's no second Worker or subdomain.

- **Status** comes from RSI's status page, which runs cState and has a JSON API.
- **Comm-Link** has no feed, so `worker/rsi.js` reads the public `/comm-link` list, which RSI's robots.txt allows.
- A Cron Trigger (every 10 minutes) stores a snapshot in Workers KV. The page reads `/api/star-citizen`.

### One-time setup

1. **Create the KV namespace.** Go to Cloudflare → **Storage & Databases → Workers KV → Create**, name it `belpire-site`, and copy its **ID**. Put it in place of `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.jsonc` *before* merging, or the deploy fails. IDs aren't secrets.
2. **Add Discord alerts (optional).** On **belpire-site → Settings → Variables and Secrets** (the runtime section, not Build), add `SC_DISCORD_WEBHOOK_URL` as a **Secret**. A `#star-citizen` channel webhook works well. The first cron run only records what exists, so the channel isn't flooded.
3. **Set the invite link.** Set `DISCORD_INVITE` at the top of `site/star-citizen/sc.js`, the same invite as `site/app.js`.

Nothing else changes: same build command, same deploy command, same domain.

### The Toolbox (community tools)

The Star Citizen page lists community tools from `site/star-citizen/tools.json`. Edit that file to add, remove or reword tools: each needs a `name`, an `https` `url`, a `kind` (`web`, `app`, `overlay`, `extension` or `game-file`) and a short `description`. The tests check every entry.

- **Live versions:** a tool with a `releases` block shows its latest GitHub release. The Worker reads the repo's public release feed (`github.com/<owner>/<repo>/releases.atom`) at most once an hour. To track a new repo, also add it to `TRACKED_REPOS` in `worker/star-citizen.js`.
- **StarStrings** shows its LIVE and PTU builds, plus a warning when RSI's status page shows a game patch newer than the last LIVE update.

### If RSI changes something

- **Status shows "unavailable" or the news stops updating.** Open **belpire-site → Observability → Logs** and look for `Star Citizen refresh warnings`. The page keeps the last good data meanwhile.
- **Comm-Link markup changed.** Update the regexes in `worker/rsi.js` and the fixture in `worker/test/fixtures/commlink.html`. The tests show exactly what's parsed.
