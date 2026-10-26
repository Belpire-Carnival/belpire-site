# Belpire Carnival — belpire.com

The website for the **Belpire Carnival**, a Discord community for multiplayer horror and party games.

**Visit:** [belpire.com](https://belpire.com) — get your Discord invite at [belpire.com/join](https://belpire.com/join/)

## What's here

- `site/` — the website: plain HTML, CSS and JavaScript, no framework.
- `site/join/` — the box office: verify your Discord account to get the invite.
- `site/star-citizen/` — the Star Citizen page: server status, Comm-Link news and community tools.
- `worker/` — a small Cloudflare Worker behind the Star Citizen page and the Discord invite check.
- `config/games.json` — the community's favorite games, grouped into tents (horror, party and The Sideshow).
- `scripts/` — the build step that refreshes game news from Steam.

## Run it locally

Needs Node.js 22.

```bash
npm run feed   # fetch game news from Steam
npm run dev    # serve the site at http://localhost:8080
npm run check  # syntax checks and tests
```

## Contributing

Suggestions are welcome in the Discord. Changes to `main` go through pull requests with passing checks.

## Security

Please report security issues privately. See [SECURITY.md](SECURITY.md).

---

This is an unofficial fan site. Star Citizen is a trademark of Cloud Imperium; game names and images belong to their respective owners.
