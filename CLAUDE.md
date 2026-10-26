# CLAUDE.md — belpire-site

Project brief for Claude. Read README.md for the full runbook.

## What this is
belpire.com, the public website for the **Belpire Carnival** Discord community (multiplayer horror and party games). Gothic-carnival theme: owners are the **RingMaster** and **RingMistress**.

- Static site in `site/`: plain HTML, CSS and vanilla JS. No framework, no bundler, no npm dependencies. Keep it that way unless asked.
- Games are grouped into three **tents**: `horror` (crimson), `party` (gold), `other` = "The Sideshow" (slate).
- Hosted on **Cloudflare Workers via Workers Builds**, connected to GitHub. Config is in `wrangler.jsonc` (Worker name `belpire-site`). Cloudflare runs `npm run build` (`scripts/cf-build.mjs`: downloads the live `feed.json` and refreshes it from Steam), then `npx wrangler deploy` publishes `site/` as static assets plus `worker/`.
- `worker/` is the only server code. It runs for `/api/*` and a 10-minute Cron Trigger. Today it powers the **Star Citizen page** (`site/star-citizen/`): RSI status from the cState JSON API (`status.robertsspaceindustries.com/index.json`, `/issues/index.json`) and Comm-Link news read from the public `/comm-link` hub (no feed exists), cached in KV (`SC_DATA`) and served at `/api/star-citizen`. It posts to Discord via the runtime secret `SC_DISCORD_WEBHOOK_URL`. Parsers are pure functions in `worker/rsi.js`, tested in `worker/test/`. Be polite to RSI (one fetch per source per 10 minutes), never hotlink RSI media or use RSI/CIG logos, and keep the unofficial-fan-site disclaimer in the page footer.
- **Discord login** (`worker/auth.js`): OAuth2 code grant with `state`, scopes `identify guilds.members.read`. Membership (and optional `DISCORD_REQUIRED_ROLE_IDS`) is checked at login and re-checked every 24h using the refresh token stored in an AES-GCM encrypted `__Host-` cookie (30 days). `/members/*` is served only through `requireMember`; `/api/me` tells pages who's logged in; `site/common.js` toggles login buttons and holds `DISCORD_INVITE`. Public: homepage + feeds, `/star-citizen/`. Members only: `site/members/`. The repo is public, so nothing secret goes in `site/members/`.
- `.github/workflows/refresh-feed.yml` calls a Cloudflare deploy hook every 6 hours. `ci.yml` runs `npm run check` (the required `test` check).

## Rules
- **Never commit secrets** (deploy hook URL, Discord webhooks, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, tokens). They live in GitHub environment secrets or encrypted Cloudflare variables. Don't print them in logs.
- `site/data/feed.json` is generated at build time and git-ignored. Never commit it.
- Render all feed or external text with `textContent`; links must be `https:`. Never use `innerHTML` with data.
- Keep `site/_headers` (CSP) in sync if you add any new external origin. Allowed today: Google Fonts, `*.steamstatic.com` images and Discord avatars (`cdn.discordapp.com`).
- GitHub Actions: GitHub-owned actions only, pinned to a full commit SHA with a `# vX.Y.Z` comment. Workflows default to no permissions; grant per job.
- `main` is protected by a ruleset: changes go through a PR, squash merge, signed commits, `test` must pass. Work on a branch.
- Accessibility: real `<button>`/`<a>` elements, visible focus, 4.5:1 text contrast, touch targets at least 44px, works at phone width.
- Don't run `scripts/setup-github.sh`; the owner runs it themselves.
- Use LF line endings (see `.gitattributes`).

## Common tasks
- Add a favorite game: edit `config/games.json` → `favorites` (`appid` from the Steam store URL, `tent`).
- Edit game nights, oddities or ringleaders: `site/index.html`.
- Discord invite link: `DISCORD_INVITE` at the top of `site/app.js`.
- Check before a PR: `npm run check`. Local preview: `npm run feed && npm run dev`.
