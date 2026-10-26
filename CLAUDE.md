# CLAUDE.md — belpire-site

Coding notes for Claude. Operational setup (GitHub, Cloudflare, secrets) is documented privately, not in this repo.

## What this is
belpire.com, the public website for the **Belpire Carnival** Discord community (multiplayer horror and party games). Gothic-carnival theme: owners are the **RingMaster** and **RingMistress**.

- `site/` is plain HTML, CSS and vanilla JS. No framework, no bundler, no npm dependencies. Keep it that way unless asked.
- Games are grouped into three **tents**: `horror` (crimson), `party` (gold), `other` = "The Sideshow" (slate).
- `worker/` is the only server code (`/api/*` and a scheduled refresh). It powers the Star Citizen page in `site/star-citizen/`. Parsers are pure functions in `worker/rsi.js`, tested in `worker/test/`. Fetch each external source politely (at most once per refresh), never hotlink RSI media or use RSI/CIG logos, and keep the unofficial-fan-site disclaimer in the footer.
- The Star Citizen **Toolbox** is data in `site/star-citizen/tools.json`, validated by `worker/test/tools.test.mjs`. Only link official sources; never mirror downloads.

## Rules
- **This repo is public.** Never commit secrets, URLs that act as credentials, account names, internal IDs, dashboard click-paths or infrastructure runbooks. Comments explain code, not how the hosting is set up.
- `site/data/feed.json` is generated at build time and git-ignored. Never commit it.
- Render all external text with `textContent`; links must be `https:`. Never use `innerHTML` with data.
- Keep `site/_headers` (CSP) in sync if you add any new external origin. Allowed today: Google Fonts and Steam image CDNs.
- GitHub Actions: GitHub-owned actions only, pinned to a full commit SHA with a `# vX.Y.Z` comment. Workflows default to no permissions; grant per job.
- Changes go through a PR from a branch, squash merge, signed commits, and the `test` check must pass.
- Accessibility: real `<button>`/`<a>` elements, visible focus, 4.5:1 text contrast, touch targets at least 44px, works at phone width.
- Use LF line endings (see `.gitattributes`).
- **Keep `site/privacy/` truthful.** Today the site sets no cookies, has no analytics and stores nothing in the browser. Any change to that (cookies, login, analytics, a new external origin) must update the Privacy Policy and its effective date in the same PR.
- **Visual effects are decoration only.** `site/fx.css` + `site/fx.js` load on every page; `site/star-citizen/sc-fx.css` + `sc-fx.js` add the space-carnival layer. Every animation must switch off under `prefers-reduced-motion: reduce`; content must be readable if JS never runs; no inline styles or scripts (set CSS variables from JS); all art is original, never characters or designs from films or games.

## Common tasks
- Add a favorite game: `config/games.json` → `favorites` (`appid` from the Steam store URL, `tent`).
- Edit game nights, oddities or ringleaders: `site/index.html`.
- Discord invite link: `DISCORD_INVITE` at the top of `site/app.js`.
- Before a PR: `npm run check`. Local preview: `npm run feed && npm run dev`.
