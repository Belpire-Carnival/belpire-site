// Tickets storage (D1). Every change is a row in ticket_ledger; ticket_wallets keeps the running balance.
// A ledger row may carry a `ref` (unique), so retries and repeated cron runs can never pay twice.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ticket_wallets (
    user_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    lifetime INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    punch_day TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    badge_until TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ticket_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    kind TEXT NOT NULL,
    note TEXT,
    ref TEXT UNIQUE,
    by_name TEXT,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS ticket_ledger_user ON ticket_ledger (user_id, created_at)',
  `CREATE TABLE IF NOT EXISTS ticket_checkins (
    user_id TEXT NOT NULL,
    show TEXT NOT NULL,
    name TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, show)
  )`,
  `CREATE TABLE IF NOT EXISTS prize_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prize TEXT NOT NULL,
    cost INTEGER NOT NULL,
    detail TEXT,
    game_key TEXT,
    game_name TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    reason TEXT
  )`
];
const ready = new WeakMap();
async function ensure(db) {
  if (!ready.has(db)) ready.set(db, (async () => { for (const sql of SCHEMA) await db.prepare(sql).run(); })());
  await ready.get(db);
}
export const newId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
const nowIso = () => new Date().toISOString();

export function ticketStore(db) {
  return {
    async wallet(uid) {
      await ensure(db);
      return db.prepare('SELECT * FROM ticket_wallets WHERE user_id = ?').bind(uid).first();
    },
    // Adds (or with a negative amount, takes away, never below zero) and records it. Returns the new balance,
    // or null when `ref` was already paid.
    async change(uid, name, amount, kind, { note = null, ref = null, by = null } = {}) {
      await ensure(db);
      amount = Math.trunc(amount);
      if (amount < 0) {
        const w = await this.wallet(uid);
        amount = -Math.min(-amount, Number(w?.balance || 0));
      }
      const id = newId();
      const at = nowIso();
      const ins = await db.prepare('INSERT OR IGNORE INTO ticket_ledger (id, user_id, amount, kind, note, ref, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, uid, amount, kind, note, ref, by, at).run();
      if (!ins.meta.changes) return null;
      await db.prepare(`INSERT INTO ticket_wallets (user_id, name, balance, lifetime, updated_at) VALUES (?, ?, MAX(?, 0), MAX(?, 0), ?)
        ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, balance = MAX(ticket_wallets.balance + ?, 0), lifetime = ticket_wallets.lifetime + MAX(?, 0), updated_at = excluded.updated_at`)
        .bind(uid, name, amount, amount, at, amount, amount).run();
      return Number((await this.wallet(uid)).balance);
    },
    // Takes `cost` only if the balance covers it. Returns the new balance, or null if it doesn't.
    async spend(uid, cost, kind, note) {
      await ensure(db);
      const r = await db.prepare('UPDATE ticket_wallets SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?').bind(cost, nowIso(), uid, cost).run();
      if (!r.meta.changes) return null;
      await db.prepare('INSERT INTO ticket_ledger (id, user_id, amount, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), uid, -cost, kind, note, nowIso()).run();
      return Number((await this.wallet(uid)).balance);
    },
    async setPunch(uid, day, streak) {
      await ensure(db);
      await db.prepare('UPDATE ticket_wallets SET punch_day = ?, streak = ? WHERE user_id = ?').bind(day, streak, uid).run();
    },
    async setHidden(uid, name, hidden) {
      await ensure(db);
      await db.prepare(`INSERT INTO ticket_wallets (user_id, name, hidden, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET hidden = excluded.hidden`).bind(uid, name, hidden ? 1 : 0, nowIso()).run();
    },
    async setBadge(uid, until) {
      await ensure(db);
      await db.prepare('UPDATE ticket_wallets SET badge_until = ? WHERE user_id = ?').bind(until, uid).run();
    },
    async history(uid, limit = 25) {
      await ensure(db);
      return (await db.prepare('SELECT amount, kind, note, created_at FROM ticket_ledger WHERE user_id = ? AND amount != 0 ORDER BY created_at DESC LIMIT ?').bind(uid, limit).all()).results;
    },
    async countRefs(prefix) {
      await ensure(db);
      const r = await db.prepare('SELECT COUNT(*) AS n FROM ticket_ledger WHERE ref LIKE ?').bind(`${prefix}%`).first();
      return Number(r?.n || 0);
    },
    async leaderboard(limit = 10) {
      await ensure(db);
      return (await db.prepare('SELECT user_id, name, lifetime, badge_until FROM ticket_wallets WHERE hidden = 0 AND lifetime > 0 ORDER BY lifetime DESC, updated_at ASC LIMIT ?').bind(limit).all()).results;
    },
    async rank(uid) {
      await ensure(db);
      const w = await this.wallet(uid);
      if (!w || w.hidden || !w.lifetime) return null;
      const r = await db.prepare('SELECT COUNT(*) AS n FROM ticket_wallets WHERE hidden = 0 AND lifetime > ?').bind(w.lifetime).first();
      return Number(r?.n || 0) + 1;
    },

    // ---- game-night check-ins
    async checkin(uid, name, show) {
      await ensure(db);
      await db.prepare('INSERT OR IGNORE INTO ticket_checkins (user_id, show, name, created_at) VALUES (?, ?, ?, ?)').bind(uid, show, name, nowIso()).run();
      return db.prepare('SELECT * FROM ticket_checkins WHERE user_id = ? AND show = ?').bind(uid, show).first();
    },
    async getCheckin(uid, show) {
      await ensure(db);
      return db.prepare('SELECT * FROM ticket_checkins WHERE user_id = ? AND show = ?').bind(uid, show).first();
    },
    async checkins(show, limit = 40) {
      await ensure(db);
      return (await db.prepare('SELECT * FROM ticket_checkins WHERE show = ? ORDER BY created_at ASC LIMIT ?').bind(show, limit).all()).results;
    },
    async addPaid(uid, show, amount) {
      await ensure(db);
      await db.prepare('UPDATE ticket_checkins SET paid = paid + ? WHERE user_id = ? AND show = ?').bind(amount, uid, show).run();
    },
    async purgeCheckinsBefore(iso) {
      await ensure(db);
      return (await db.prepare('DELETE FROM ticket_checkins WHERE created_at < ?').bind(iso).run()).meta.changes;
    },

    // ---- Prize Booth orders
    async order(o) {
      await ensure(db);
      await db.prepare("INSERT INTO prize_orders (id, user_id, name, prize, cost, detail, game_key, game_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
        .bind(o.id, o.user_id, o.name, o.prize, o.cost, o.detail, o.game_key, o.game_name, nowIso()).run();
    },
    async getOrder(id) {
      await ensure(db);
      return db.prepare('SELECT * FROM prize_orders WHERE id = ?').bind(id).first();
    },
    async pendingOrders(limit = 100) {
      await ensure(db);
      return (await db.prepare("SELECT * FROM prize_orders WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?").bind(limit).all()).results;
    },
    async myOrders(uid, limit = 10) {
      await ensure(db);
      return (await db.prepare('SELECT * FROM prize_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').bind(uid, limit).all()).results;
    },
    async waiting(uid, prize) {
      await ensure(db);
      const r = await db.prepare("SELECT COUNT(*) AS n FROM prize_orders WHERE user_id = ? AND prize = ? AND status = 'pending'").bind(uid, prize).first();
      return Number(r?.n || 0);
    },
    async decide(id, status, by, reason = null) {
      await ensure(db);
      const r = await db.prepare("UPDATE prize_orders SET status = ?, decided_by = ?, decided_at = ?, reason = ? WHERE id = ? AND status = 'pending'").bind(status, by, nowIso(), reason, id).run();
      return r.meta.changes > 0;
    }
  };
}
