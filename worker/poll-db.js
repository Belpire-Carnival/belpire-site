// D1 storage for game-night polls. Tables are created on first use (no migration step to run).
// polls:   one row per poll; candidates and results are JSON text.
// ballots: one row per (poll, voter); ranking is a JSON array of candidate keys, best first;
//          locked = 1 once the Wheel of Doom has chosen (no further changes).

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    candidates TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    closed_by_name TEXT,
    results TEXT,
    results_posted INTEGER NOT NULL DEFAULT 0,
    event_id TEXT,
    event_start TEXT,
    scheduled_by_name TEXT,
    event_posted INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS ballots (
    poll_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    ranking TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    voter_name TEXT,
    PRIMARY KEY (poll_id, user_id)
  )`,
  'CREATE INDEX IF NOT EXISTS polls_created ON polls (created_at)',
  'CREATE INDEX IF NOT EXISTS polls_start ON polls (status, event_start)'
];

const ready = new WeakMap();
async function ensure(db) {
  if (!ready.has(db)) {
    ready.set(db, db.batch(SCHEMA.map((s) => db.prepare(s)))
      // Databases created before voter names were shown need the column added once; afterwards this fails harmlessly.
      .then(() => db.prepare('ALTER TABLE ballots ADD COLUMN voter_name TEXT').run().catch(() => {})));
  }
  await ready.get(db);
}

const parse = (row) =>
  row && {
    ...row,
    candidates: JSON.parse(row.candidates || '[]'),
    results: row.results ? JSON.parse(row.results) : null,
    results_posted: Boolean(row.results_posted),
    event_posted: Boolean(row.event_posted)
  };

export function pollStore(db) {
  return {
    // The poll being voted on or waiting for a date (at most one at a time).
    async current() {
      await ensure(db);
      return parse(await db.prepare("SELECT * FROM polls WHERE status IN ('open','closed') ORDER BY created_at DESC LIMIT 1").first());
    },
    // Scheduled nights that haven't started yet, soonest first.
    async upcoming(nowIso, limit = 6) {
      await ensure(db);
      const { results } = await db.prepare("SELECT * FROM polls WHERE status = 'scheduled' AND event_start > ? ORDER BY event_start ASC LIMIT ?").bind(nowIso, limit).all();
      return results.map(parse);
    },
    async get(id) {
      await ensure(db);
      return parse(await db.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first());
    },
    async create(poll) {
      await ensure(db);
      await db
        .prepare('INSERT INTO polls (id, title, status, candidates, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(poll.id, poll.title, 'open', JSON.stringify(poll.candidates), poll.created_by, poll.created_by_name, poll.created_at)
        .run();
    },
    // Returns false when the voter's ballot is locked by the Wheel of Doom.
    async saveBallot(pollId, userId, ranking, now, { locked = false, name = null } = {}) {
      await ensure(db);
      const r = await db
        .prepare('INSERT INTO ballots (poll_id, user_id, ranking, updated_at, locked, voter_name) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (poll_id, user_id) DO UPDATE SET ranking = excluded.ranking, updated_at = excluded.updated_at, locked = excluded.locked, voter_name = excluded.voter_name WHERE ballots.locked = 0')
        .bind(pollId, userId, JSON.stringify(ranking), now, locked ? 1 : 0, name)
        .run();
      return r.meta.changes === 1;
    },
    async ballot(pollId, userId) {
      await ensure(db);
      const row = await db.prepare('SELECT ranking, locked FROM ballots WHERE poll_id = ? AND user_id = ?').bind(pollId, userId).first();
      return row ? { ranking: JSON.parse(row.ranking), locked: Boolean(row.locked) } : null;
    },
    async ballots(pollId) {
      await ensure(db);
      const { results } = await db.prepare('SELECT ranking FROM ballots WHERE poll_id = ?').bind(pollId).all();
      return results.map((r) => JSON.parse(r.ranking));
    },
    // Who has voted (names only, never their picks), first voters first. doom = chose the Wheel of Doom.
    async voters(pollId) {
      await ensure(db);
      const { results } = await db.prepare('SELECT user_id, voter_name, locked FROM ballots WHERE poll_id = ? ORDER BY rowid ASC').bind(pollId).all();
      return results.map((r) => ({ userId: r.user_id, name: r.voter_name || null, doom: Boolean(r.locked) }));
    },
    // Fill in a name for a ballot saved before names were recorded.
    async setVoterName(pollId, userId, name) {
      await ensure(db);
      await db.prepare('UPDATE ballots SET voter_name = ? WHERE poll_id = ? AND user_id = ? AND voter_name IS NULL').bind(name, pollId, userId).run();
    },
    async voteCount(pollId) {
      await ensure(db);
      const row = await db.prepare('SELECT COUNT(*) AS n FROM ballots WHERE poll_id = ?').bind(pollId).first();
      return Number(row?.n || 0);
    },
    // Status changes only apply from the expected status, so two clicks can't close or schedule twice.
    async close(id, { results, closedAt, closedByName }) {
      await ensure(db);
      const r = await db
        .prepare("UPDATE polls SET status = 'closed', results = ?, closed_at = ?, closed_by_name = ? WHERE id = ? AND status = 'open'")
        .bind(JSON.stringify(results), closedAt, closedByName, id)
        .run();
      return r.meta.changes === 1;
    },
    async markResultsPosted(id) {
      await ensure(db);
      await db.prepare('UPDATE polls SET results_posted = 1 WHERE id = ?').bind(id).run();
    },
    async schedule(id, { eventId, start, scheduledByName }) {
      await ensure(db);
      const r = await db
        .prepare("UPDATE polls SET status = 'scheduled', event_id = ?, event_start = ?, scheduled_by_name = ? WHERE id = ? AND status = 'closed'")
        .bind(eventId, start, scheduledByName, id)
        .run();
      return r.meta.changes === 1;
    },
    async markEventPosted(id) {
      await ensure(db);
      await db.prepare('UPDATE polls SET event_posted = 1 WHERE id = ?').bind(id).run();
    },
    // Ballots tie a Discord ID to a vote, so they're deleted 90 days after their poll opened.
    async purgeBallots(beforeMs) {
      await ensure(db);
      const r = await db.prepare('DELETE FROM ballots WHERE poll_id IN (SELECT id FROM polls WHERE created_at < ?)').bind(beforeMs).run();
      return r.meta.changes;
    },
    async cancel(id) {
      await ensure(db);
      const r = await db.prepare("UPDATE polls SET status = 'cancelled' WHERE id = ? AND status IN ('open','closed')").bind(id).run();
      return r.meta.changes === 1;
    }
  };
}
