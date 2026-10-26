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
| `site/members/` | The Members' Lounge (members only, behind Discord login). |
| `site/common.js` | Shared by every page: **`DISCORD_INVITE`** (set it here) and the login button state. |
| `worker/` | Server code: Discord login (`auth.js`), members-only pages, `/api/*`, the RSI status and Comm-Link readers, and Discord alerts. Tests in `worker/test/`. |
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

## Runbook

### 1. Harden your GitHub account (once)

On your personal settings (profile picture → **Settings**):

- **Password and authentication:** add two security keys or passkeys, remove SMS, and save the recovery codes offline.
- **Emails:** turn on *Keep my email addresses private* and *Block command line pushes that expose my email*.
- **Code security** (under Security in the sidebar): turn on *Push protection for yourself*.
- **SSH and GPG keys:** turn on *Vigilant mode* at the bottom of the page.
- **Sign your commits with SSH.** The ruleset requires it:

  ```bash
  ssh-keygen -t ed25519-sk -C "github"      # hardware key; or -t ed25519 with a passphrase
  git config --global user.email "<id>+<username>@users.noreply.github.com"
  git config --global gpg.format ssh
  git config --global user.signingkey ~/.ssh/id_ed25519_sk.pub
  git config --global commit.gpgsign true
  ```

  On **SSH and GPG keys → New SSH key**, add the `.pub` key twice: once with *Key type: Signing Key* and once as an *Authentication Key*.

### 2. Organization settings (`Belpire-Carnival`)

- **Settings → Authentication security:** check *Require two-factor authentication*.
- **Settings → Profile:** upload `brand/belpire-org-avatar.png`.
- Leave **Advanced Security → Configurations** alone. Applying it org-wide would try to switch on paid features for any future private repo. The setup script turns on the free features for this public repo only.

### 3. Create the repo and apply all GitHub settings

Before running the script, fill in `config/games.json` and `DISCORD_INVITE` in `site/app.js`. Both can also be changed later through a PR.

```bash
gh auth login -s admin:org,repo,workflow
scripts/setup-github.sh Belpire-Carnival belpire-site
```

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

### 4. Connect Cloudflare to the repo (Workers Builds)

1. **Cloudflare → Workers & Pages → Create → Import a repository → GitHub.**
2. On GitHub's install screen, pick the **Belpire-Carnival** org and choose **Only select repositories → belpire-site**. Don't grant it every repo.
3. Choose `belpire-site` and set up the build:

   | Setting | Value |
   |---|---|
   | Worker name | `belpire-site` (must match `name` in `wrangler.jsonc`) |
   | Build command | `node scripts/cf-build.mjs` |
   | Deploy command | `npx wrangler deploy` |
   | Non-production branch deploy command | `npx wrangler versions upload` |
   | Root directory | *(leave empty)* |

4. Under the Worker's **Settings → Build → Variables and secrets**, add the build-time values. These are not the runtime "Variables and Secrets"; the site has no server code, so it needs no runtime variables.
   - `NODE_VERSION` = `22`
   - `SITE_URL` = `https://belpire.com`
   - `DISCORD_WEBHOOK_URL` as a **Secret**. This one is optional. The build script drops it on every branch except `main`, so preview builds never post to Discord.
5. Under **Settings → Build → Branch control**, set the production branch to `main` and turn on builds for non-production branches. Each PR then gets a preview URL.
6. Deploy. The first build publishes to `belpire-site.<your-subdomain>.workers.dev`.
7. **Create the deploy hook for the 6-hour refresh.**
   - Go to **Settings → Builds → Deploy Hooks**, name it `steam-feed`, choose the `main` branch, and click **Create**.
   - Copy the URL. It starts with `https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/`. The ID in it is the only credential, so treat the whole URL as a secret.
   - Store it in GitHub:

     ```bash
     gh secret set CF_DEPLOY_HOOK --repo Belpire-Carnival/belpire-site --env production
     ```

   - Test it with `gh workflow run refresh-feed.yml --repo Belpire-Carnival/belpire-site`. A new build should appear in Cloudflare.

### 5. Point belpire.com at the site

1. **Workers & Pages → belpire-site → Settings → Domains & Routes → Add → Custom domain:** add `belpire.com`, then `www.belpire.com`. The domain's DNS must be on Cloudflare; the records and certificate are created for you.
2. Add a Redirect Rule that sends `www` to the apex domain.
3. Harden the zone:
   - **SSL/TLS → Edge Certificates:** turn on *Always Use HTTPS*, set *Minimum TLS* to 1.2, and leave HSTS off because `_headers` already sends it.
   - **DNS → Settings:** enable DNSSEC. If the domain is registered elsewhere, add the DS record at your registrar.
   - If the domain is registered through Cloudflare, confirm *Registrar Lock* is on.

### 6. Tidy up

```bash
gh auth refresh --remove-scopes admin:org     # drop org-admin rights from your CLI token
```

---

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

### If RSI changes something

- **Status shows "unavailable" or the news stops updating.** Open **belpire-site → Observability → Logs** and look for `Star Citizen refresh warnings`. The page keeps the last good data meanwhile.
- **Comm-Link markup changed.** Update the regexes in `worker/rsi.js` and the fixture in `worker/test/fixtures/commlink.html`. The tests show exactly what's parsed.


---

## Members' Lounge (Log in with Discord)

Members log in with Discord to reach **belpire.com/members/**. That's where game nights, the Hall of Oddities and the Ringleaders live. The homepage feeds and the Star Citizen page stay public.

- **What Discord shares:** only the user's identity and their membership in *your* server (scopes `identify guilds.members.read`). No email and no list of their other servers.
- **Who gets in:** anyone in the server by default. To require a role (for example the role granted after accepting the rules in the Welcome Zone), set `DISCORD_REQUIRED_ROLE_IDS`.
- **Sessions:** an encrypted, HttpOnly cookie that lasts 30 days, with membership re-checked against Discord every 24 hours. People who leave or lose the role are logged out within a day. Nothing is stored server-side.
- **The repo is public,** so anything in `site/members/` is visible on GitHub. Login hides it on the website, but don't put true secrets there.

### One-time setup

1. **Create the Discord app.** Go to <https://discord.com/developers/applications> → **New Application**, and name it "Belpire Carnival".
   - **OAuth2 → Redirects:** add `https://belpire.com/auth/callback` and save.
   - **OAuth2 → Client ID:** copy it.
   - **OAuth2 → Client Secret → Reset Secret:** copy it straight into Cloudflare (step 4). Never paste it in chat or commit it.
   - You don't need a bot.
2. **Copy the server ID.** In Discord, go to **User Settings → Advanced** and turn on **Developer Mode**. Then right-click the Belpire Carnival server icon → **Copy Server ID**.
   - Optional: to require a role, go to **Server Settings → Roles**, right-click the role → **Copy Role ID**.
3. **Put the IDs in `wrangler.jsonc`, through a PR.** Set `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID`, and optionally `DISCORD_REQUIRED_ROLE_IDS`. These aren't secrets.
4. **Add the two secrets.** Go to Cloudflare → **belpire-site → Settings → Variables and Secrets** (the runtime section, not Build) and add both as type **Secret**:
   - `DISCORD_CLIENT_SECRET`: the client secret from step 1.
   - `SESSION_SECRET`: generate it in Git Bash with `openssl rand -base64 48` and paste it straight in.
5. **Test it.** Open belpire.com → **Log in with Discord** → approve. You should land in the Members' Lounge with your name and avatar.

Until all of this is set, login buttons are hidden and `/members/` explains the Lounge isn't open yet. The rest of the site works normally.

### Good to know

- **Log everyone out:** change `SESSION_SECRET`.
- **The client secret leaked:** reset it in the Developer Portal and update `DISCORD_CLIENT_SECRET`.
- **Someone is stuck on "Almost there":** they're missing the required role, or haven't completed Discord's membership screening.
