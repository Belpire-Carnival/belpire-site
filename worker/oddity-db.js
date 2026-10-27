// Hall of Oddities storage. Metadata lives in D1 (`DB`), the files themselves in R2 (`ODDITIES`).
//
// status: 'uploading' (clip parts still arriving) → 'pending' (waiting for a Ringleader) → 'live'
//         'removed' (taken down; the file is deleted, the row is kept so repeat reports are ignored)

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS oddities (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    caption TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    status TEXT NOT NULL,
    scan TEXT,
    upload_id TEXT,
    created_at TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_at TEXT,
    reports INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS oddities_status ON oddities (status, created_at)',
  'CREATE INDEX IF NOT EXISTS oddities_user ON oddities (user_id, created_at)',
  `CREATE TABLE IF NOT EXISTS oddity_reports (
    oddity_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (oddity_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS oddity_reactions (
    oddity_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reaction TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (oddity_id, user_id, reaction)
  )`
];

let ready = null;
async function ensure(db) {
  if (!ready) ready = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { ready = null; throw e; });
  return ready;
}
export function _resetSchemaFlag() {
  ready = null;
}

const COLS = 'id, kind, mime, size, width, height, caption, user_id, user_name, status, scan, upload_id, created_at, reviewed_by, reviewed_at, reports';

export function oddityStore(db) {
  const q = async (sql, ...args) => {
    await ensure(db);
    return db.prepare(sql).bind(...args);
  };
  return {
    async create(o) {
      await (await q(`INSERT INTO oddities (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0)`,
        o.id, o.kind, o.mime, o.size || 0, o.width ?? null, o.height ?? null, o.caption || '', o.user_id, o.user_name, o.status, o.scan ?? null, o.upload_id ?? null, o.created_at)).run();
    },
    async get(id) {
      return (await q(`SELECT ${COLS} FROM oddities WHERE id = ?`, id)).first();
    },
    async list(status, limit = 30, kind = null) {
      const sql = kind
        ? `SELECT ${COLS} FROM oddities WHERE status = ? AND kind = ? ORDER BY created_at DESC LIMIT ?`
        : `SELECT ${COLS} FROM oddities WHERE status = ? ORDER BY created_at DESC LIMIT ?`;
      return (await (await q(sql, ...(kind ? [status, kind, limit] : [status, limit]))).all()).results;
    },
    async countRecent(userId, kind, sinceIso) {
      const r = await (await q('SELECT COUNT(*) AS n FROM oddities WHERE user_id = ? AND kind = ? AND created_at >= ?', userId, kind, sinceIso)).first();
      return Number(r?.n || 0);
    },
    async setSize(id, size) {
      await (await q('UPDATE oddities SET size = ? WHERE id = ?', size, id)).run();
    },
    async setStatus(id, status, { by = null, at = null, from = null } = {}) {
      const sql = from
        ? 'UPDATE oddities SET status = ?, reviewed_by = COALESCE(?, reviewed_by), reviewed_at = COALESCE(?, reviewed_at) WHERE id = ? AND status = ?'
        : 'UPDATE oddities SET status = ?, reviewed_by = COALESCE(?, reviewed_by), reviewed_at = COALESCE(?, reviewed_at) WHERE id = ?';
      const args = from ? [status, by, at, id, from] : [status, by, at, id];
      const r = await (await q(sql, ...args)).run();
      return r.meta.changes > 0;
    },
    // One report per member per oddity. Returns the new total, or null if this member already reported it.
    async report(id, userId, at) {
      const r = await (await q('INSERT OR IGNORE INTO oddity_reports (oddity_id, user_id, created_at) VALUES (?, ?, ?)', id, userId, at)).run();
      if (!r.meta.changes) return null;
      await (await q('UPDATE oddities SET reports = reports + 1 WHERE id = ?', id)).run();
      return Number((await this.get(id))?.reports || 0);
    },
    // Toggle one reaction for one member. → true if it's now on.
    async toggleReaction(id, userId, reaction, at) {
      const del = await (await q('DELETE FROM oddity_reactions WHERE oddity_id = ? AND user_id = ? AND reaction = ?', id, userId, reaction)).run();
      if (del.meta.changes) return false;
      await (await q('INSERT INTO oddity_reactions (oddity_id, user_id, reaction, created_at) VALUES (?, ?, ?, ?)', id, userId, reaction, at)).run();
      return true;
    },
    // → { [oddityId]: { counts: { like: 2, … }, mine: ['like'] } }
    async reactions(ids, userId = null) {
      const out = Object.fromEntries(ids.map((id) => [id, { counts: {}, mine: [] }]));
      if (!ids.length) return out;
      const marks = ids.map(() => '?').join(', ');
      const rows = (await (await q(`SELECT oddity_id, reaction, COUNT(*) AS n, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS me FROM oddity_reactions WHERE oddity_id IN (${marks}) GROUP BY oddity_id, reaction`, userId || '', ...ids)).all()).results;
      for (const r of rows) {
        out[r.oddity_id].counts[r.reaction] = Number(r.n);
        if (Number(r.me)) out[r.oddity_id].mine.push(r.reaction);
      }
      return out;
    },
    async clearReactions(id) {
      await (await q('DELETE FROM oddity_reactions WHERE oddity_id = ?', id)).run();
      await (await q('DELETE FROM oddity_reports WHERE oddity_id = ?', id)).run();
    },
    async staleUploads(beforeIso) {
      return (await (await q(`SELECT ${COLS} FROM oddities WHERE status = 'uploading' AND created_at < ?`, beforeIso)).all()).results;
    },
    async delete(id) {
      await (await q('DELETE FROM oddities WHERE id = ?', id)).run();
    }
  };
}
