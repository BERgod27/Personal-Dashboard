// Storage for the hosted dashboard. Two interchangeable backends:
//   DATABASE_URL=postgres://...   -> PostgreSQL (e.g. Neon free tier)
//   otherwise                      -> SQLite file at SQLITE_PATH (default ./data/dashboard.db)
// Queries are written once with $1, $2 placeholders; SQLite gets them rewritten to ?.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = (pg) => [
  `CREATE TABLE IF NOT EXISTS users (
     id ${pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
     username TEXT NOT NULL UNIQUE,
     pass_hash TEXT NOT NULL,
     created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     expires_at BIGINT NOT NULL)`,
  // Documents the browser syncs (the dashboard store, meals, ...): one JSON blob per key.
  `CREATE TABLE IF NOT EXISTS docs (
     user_id INTEGER NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     version INTEGER NOT NULL,
     updated_at BIGINT NOT NULL,
     PRIMARY KEY (user_id, key))`,
  // Server-only data: uni settings, synced uni data, encrypted secrets. Never sent raw to the browser.
  `CREATE TABLE IF NOT EXISTS server_data (
     user_id INTEGER NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     updated_at BIGINT NOT NULL,
     PRIMARY KEY (user_id, key))`,
];

const num = (v) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
const fixRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]));

async function openPostgres(url) {
  const { default: pg } = await import('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // Certificates are checked; PGSSL_NO_VERIFY=1 is for hosts with self-signed ones.
  const ssl = local ? false : process.env.PGSSL_NO_VERIFY === '1' ? { rejectUnauthorized: false } : true;
  // Close idle connections before a serverless database (Neon) suspends and drops them.
  const pool = new pg.Pool({ connectionString: url, ssl, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 20000 });
  // A dropped idle connection must not crash the server; the pool reconnects on the next query.
  pool.on('error', (e) => console.error('[db] idle connection closed:', e.message));
  return {
    kind: 'postgres',
    async q(sql, params = []) {
      const res = await pool.query(sql, params);
      return res.rows.map(fixRow);
    },
    close: () => pool.end(),
  };
}

async function openSqlite(path) {
  const { DatabaseSync } = await import('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return {
    kind: 'sqlite',
    async q(sql, params = []) {
      const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
      if (/^\s*(SELECT|INSERT[\s\S]*RETURNING|UPDATE[\s\S]*RETURNING|DELETE[\s\S]*RETURNING)/i.test(sql)) {
        return stmt.all(...params).map((r) => ({ ...r }));
      }
      stmt.run(...params);
      return [];
    },
    close: () => db.close(),
  };
}

export async function openDb({ url = process.env.DATABASE_URL, sqlitePath = process.env.SQLITE_PATH || fileURLToPath(new URL('./data/dashboard.db', import.meta.url)) } = {}) {
  const db = url ? await openPostgres(url) : await openSqlite(sqlitePath);
  for (const stmt of SCHEMA(db.kind === 'postgres')) await db.q(stmt);
  return db;
}

// Small helpers used by the routes.
export function store(db) {
  return {
    db,
    async countUsers() {
      const [r] = await db.q('SELECT COUNT(*) AS n FROM users');
      return Number(r.n);
    },
    async createUser(username, passHash) {
      const [r] = await db.q('INSERT INTO users (username, pass_hash, created_at) VALUES ($1, $2, $3) RETURNING id', [username, passHash, Date.now()]);
      return r.id;
    },
    async userByName(username) {
      const [r] = await db.q('SELECT id, username, pass_hash FROM users WHERE username = $1', [username]);
      return r || null;
    },
    async userIds() {
      return (await db.q('SELECT id FROM users')).map((r) => r.id);
    },
    async addSession(tokenHash, userId, expiresAt) {
      await db.q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);
    },
    async sessionUser(tokenHash) {
      const [r] = await db.q(
        'SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
        [tokenHash]);
      if (!r) return null;
      if (r.expires_at < Date.now()) { await this.dropSession(tokenHash); return null; }
      return { id: r.id, username: r.username };
    },
    async dropSession(tokenHash) {
      await db.q('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    },
    async dropUserSessions(userId) {
      await db.q('DELETE FROM sessions WHERE user_id = $1', [userId]);
    },
    async pruneSessions() {
      await db.q('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]);
    },

    async docs(userId) {
      return db.q('SELECT key, value, version, updated_at FROM docs WHERE user_id = $1', [userId]);
    },
    async doc(userId, key) {
      const [r] = await db.q('SELECT key, value, version, updated_at FROM docs WHERE user_id = $1 AND key = $2', [userId, key]);
      return r || null;
    },
    // Optimistic write: succeeds only if the caller saw the current version (0 = no doc yet).
    async putDoc(userId, key, value, baseVersion) {
      const now = Date.now();
      if (baseVersion === 0) {
        const rows = await db.q(
          'INSERT INTO docs (user_id, key, value, version, updated_at) VALUES ($1, $2, $3, 1, $4) ON CONFLICT (user_id, key) DO NOTHING RETURNING version',
          [userId, key, value, now]);
        return rows.length ? { ok: true, version: 1, updated_at: now } : { ok: false };
      }
      const rows = await db.q(
        'UPDATE docs SET value = $1, version = version + 1, updated_at = $2 WHERE user_id = $3 AND key = $4 AND version = $5 RETURNING version',
        [value, now, userId, key, baseVersion]);
      return rows.length ? { ok: true, version: rows[0].version, updated_at: now } : { ok: false };
    },

    async getServer(userId, key, fallback = null) {
      const [r] = await db.q('SELECT value FROM server_data WHERE user_id = $1 AND key = $2', [userId, key]);
      return r ? JSON.parse(r.value) : fallback;
    },
    async setServer(userId, key, value) {
      await db.q(
        'INSERT INTO server_data (user_id, key, value, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [userId, key, JSON.stringify(value), Date.now()]);
    },
  };
}
