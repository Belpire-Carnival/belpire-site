// Sliver coin roles in Discord: one role per coin tier (15, in worker/coins.js order), so each member's
// coin shows beside their name, the way the Game Night role marks who's in. The cron keeps them in step:
// it looks only at wallets whose tier changed since the last sync, gives the right role and takes the
// old one away. Members hidden from the High Scores get no coin role. Nothing runs until the runtime
// secret COIN_ROLE_IDS holds the 15 role IDs (comma-separated, tier 1 first; `npm run coin-roles` makes
// the roles and prints the value).

import { COINS, coinIndex } from './coins.js';
import { getMember, addRole, removeRole } from './discord-bot.js';

const SNOWFLAKE = /^\d{17,20}$/;
const NONE = -1; // no coin role (hidden from the High Scores)

export function coinRoleIds(env) {
  const ids = String(env.COIN_ROLE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length === COINS.length && ids.every((id) => SNOWFLAKE.test(id)) ? ids : null;
}

export const targetTier = (wallet) => (wallet.hidden ? NONE : coinIndex(wallet.lifetime));

// Which coin roles to add and remove for a member who should hold tier `tier` (or none).
export function rolePlan(memberRoles, ids, tier) {
  const want = tier === NONE ? null : ids[tier];
  return {
    add: want && !memberRoles.includes(want) ? [want] : [],
    remove: ids.filter((id) => id !== want && memberRoles.includes(id))
  };
}

// One pass. At most `max` members are touched per run so a big catch-up never trips Discord's limits.
export async function syncCoinRoles(env, { max = 25 } = {}) {
  const ids = coinRoleIds(env);
  if (!ids || !env.DB || !env.DISCORD_BOT_TOKEN) return { skipped: true, changed: 0 };
  const { results } = await env.DB.prepare('SELECT user_id, lifetime, hidden, coin_role FROM ticket_wallets').all();
  const due = results.filter((w) => w.coin_role === null || w.coin_role === undefined || Number(w.coin_role) !== targetTier(w)).slice(0, max);
  let changed = 0;
  for (const w of due) {
    const tier = targetTier(w);
    const member = await getMember(env, w.user_id);
    if (member) {
      const plan = rolePlan(member.roles || [], ids, tier);
      for (const id of plan.remove) await removeRole(env, w.user_id, id);
      for (const id of plan.add) await addRole(env, w.user_id, id, `Sliver coin: ${COINS[tier].name}`);
      if (plan.add.length || plan.remove.length) changed++;
    }
    // Remembered even when they've left, so they aren't looked up every ten minutes; it reruns if they earn again.
    await env.DB.prepare('UPDATE ticket_wallets SET coin_role = ? WHERE user_id = ?').bind(tier, w.user_id).run();
  }
  return { skipped: false, changed, checked: due.length };
}
