# Belpire Carnival — belpire.com

Static site for the Belpire Carnival community. The code lives in GitHub (`Belpire-Carnival/belpire-site`, public), and Cloudflare Pages builds and hosts it through its GitHub integration.

```
 you ──PR──▶ GitHub ──CI (test)──▶ squash-merge to main ──▶ Cloudflare Pages build ──▶ belpire.com
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

### 4. Connect Cloudflare Pages to the repo

1. **Cloudflare → Workers & Pages → Create → Pages → Connect to Git → GitHub.**
2. On GitHub's install screen, pick the **Belpire-Carnival** org and choose **Only select repositories → belpire-site**. Don't grant it every repo.
3. Choose `belpire-site` and set up the build:

   | Setting | Value |
   |---|---|
   | Project name | `belpire` |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `node scripts/cf-build.mjs` |
   | Build output directory | `site` |
   | Root directory | *(leave empty)* |

4. Under **Environment variables**, add these for **Production**:
   - `NODE_VERSION` = `22`
   - `SITE_URL` = `https://belpire.com`
   - `DISCORD_WEBHOOK_URL` = your webhook, with **Encrypt** checked. This one is optional.

   For **Preview**, add only `NODE_VERSION` and `SITE_URL`. Preview builds never post to Discord.
5. Click **Save and Deploy.** The first build publishes to `belpire.pages.dev`.
6. **Create the deploy hook for the 6-hour refresh.**
   - Go to **Settings → Builds → Deploy hooks → Add deploy hook**, name it `steam-feed`, and set the branch to `main`.
   - Copy the URL. Anyone holding it can trigger builds, so treat it as a secret.
   - Store it in GitHub:

     ```bash
     gh secret set CF_DEPLOY_HOOK --repo Belpire-Carnival/belpire-site --env production
     ```

   - Test it with `gh workflow run refresh-feed.yml --repo Belpire-Carnival/belpire-site`. A new build should appear in Cloudflare.

### 5. Point belpire.com at the site

1. **Workers & Pages → belpire → Custom domains:** add `belpire.com`, then `www.belpire.com`. If the domain's DNS is on Cloudflare, the records are created for you; otherwise move the nameservers to Cloudflare first.
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
- **Refresh workflow error: `CF_DEPLOY_HOOK secret is not set`.** Do step 4.6.
- **A Cloudflare build fails with a Node error.** Check that `NODE_VERSION=22` is set for both Production and Preview.
- **The feed is empty after the first build.** Steam may have rate-limited the build. Run the refresh workflow again. The store endpoints are public but undocumented; when a search fails, the last good data stays up.
- **The deploy hook leaked.** Delete it in Cloudflare, create a new one, and update the `CF_DEPLOY_HOOK` secret.
- **A pinned action version is rejected.** SHA pinning is enforced, so a bare `@v7` reference fails. Use a full commit SHA with a `# vX.Y.Z` comment, as in the existing workflows.
