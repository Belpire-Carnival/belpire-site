// Discord webhook posts for the Star Citizen attraction. Never pings anyone.

const COLORS = { operational: 0x4caf6a, degraded: 0xd9b26a, down: 0x7a1625, maintenance: 0x3f6fb5, notice: 0x34404c, unknown: 0x34404c, news: 0xd9b26a };
const LABELS = { operational: 'Operational', degraded: 'Degraded', down: 'Down', maintenance: 'Maintenance', notice: 'Notice', unknown: 'Unknown' };

export const label = (s) => LABELS[s] || LABELS.unknown;

export function newsEmbed(item) {
  return {
    title: item.title,
    url: item.url,
    description: item.summary || undefined,
    color: COLORS.news,
    footer: { text: `RSI Comm-Link · ${item.type}` }
  };
}

export function incidentEmbed(issue) {
  return {
    title: `Incident: ${issue.title}`,
    url: issue.url,
    description: `**${label(issue.severity)}**${issue.affected.length ? ` — ${issue.affected.join(', ')}` : ''}`,
    color: COLORS[issue.severity] ?? COLORS.unknown,
    timestamp: issue.createdAt || undefined,
    footer: { text: 'RSI status' }
  };
}

export function systemEmbed(name, from, to) {
  return {
    title: `${name}: ${label(to)}`,
    url: 'https://status.robertsspaceindustries.com/',
    description: `Was ${label(from)}.`,
    color: COLORS[to] ?? COLORS.unknown,
    footer: { text: 'RSI status' }
  };
}

export async function postEmbeds(webhook, embeds, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let posted = 0;
  for (const embed of embeds) {
    const res = await fetchImpl(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Belpire Barker · Star Citizen', embeds: [embed], allowed_mentions: { parse: [] } })
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      await sleep(Math.min(10000, Math.ceil((body.retry_after || 2) * 1000)));
    } else if (res.ok) {
      posted++;
    } else {
      console.warn(`Discord post failed: HTTP ${res.status}`);
    }
    await sleep(800);
  }
  return posted;
}
