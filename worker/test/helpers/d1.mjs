// A tiny Cloudflare D1 stand-in backed by Node's built-in SQLite, so poll-db.js runs its real SQL in tests.
import { DatabaseSync } from 'node:sqlite';

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.args) ?? null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args) };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(r.changes) } };
  }
}

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  return {
    prepare: (sql) => new Statement(db, sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    _raw: db
  };
}
