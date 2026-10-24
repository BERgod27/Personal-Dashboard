// Storage for the hosted dashboard. Two interchangeable backends:
//   DATABASE_URL=postgres://...   -> PostgreSQL (e.g. Neon free tier)
//   otherwise                      -> SQLite file at SQLITE_PATH (default ./data/dashboard.db)
// Queries are written once with $1, $2 placeholders; SQLite gets them rewritten to ?.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = (pg) => [
  // Accounts sign in with Google: google_sub is Google's ID for the account (it never changes;
  // the email can). username is the account's name for the local SIGARRA sync tool.
  `CREATE TABLE IF NOT EXISTS users (
     id ${pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
     username TEXT NOT NULL UNIQUE,
     email TEXT,
     google_sub TEXT,
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

// Databases made before Google sign-in have users(username, pass_hash) and no Google columns.
// This adds the columns, deletes the password hashes and ends the sessions those passwords
// started. Each account keeps its data and is linked to a Google account at its first Google
// sign-in (server.mjs, googleUser). Safe to run on every start.
async function migrate(db) {
  const pg = db.kind === 'postgres';
  const cols = new Set((await db.q(pg
    ? "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users'"
    : "SELECT name FROM pragma_table_info('users')")).map((r) => r.name));
  if (!cols.has('email')) await db.q('ALTER TABLE users ADD COLUMN email TEXT');
  if (!cols.has('google_sub')) await db.q('ALTER TABLE users ADD COLUMN google_sub TEXT');
  await db.q('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users (google_sub)');
  if (cols.has('pass_hash')) {
    await db.q('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE google_sub IS NULL)');
    await db.q('ALTER TABLE users DROP COLUMN pass_hash');
    console.log('[db] password sign-in removed: accounts are linked to Google at their first Google sign-in');
  }
}

export async function openDb({ url = process.env.DATABASE_URL, sqlitePath = process.env.SQLITE_PATH || fileURLToPath(new URL('./data/dashboard.db', import.meta.url)) } = {}) {
  const db = url ? await openPostgres(url) : await openSqlite(sqlitePath);
  for (const stmt of SCHEMA(db.kind === 'postgres')) await db.q(stmt);
  await migrate(db);
  return db;
}

// Small helpers used by the routes.
export function store(db) {
  return {
    async createUser(username, googleSub, email) {
      const [r] = await db.q(
        'INSERT INTO users (username, google_sub, email, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
        [username, googleSub, email, Date.now()]);
      return r.id;
    },
    async userByName(username) {
      const [r] = await db.q('SELECT id, username, email FROM users WHERE username = $1', [username]);
      return r || null;
    },
    async userBySub(googleSub) {
      const [r] = await db.q('SELECT id, username, email FROM users WHERE google_sub = $1', [googleSub]);
      return r || null;
    },
    // Accounts from before Google sign-in, oldest first.
    async unlinkedUsers() {
      return db.q('SELECT id, username, email FROM users WHERE google_sub IS NULL ORDER BY id');
    },
    // Links an account to a Google account, only if nothing linked it in the meantime.
    async linkGoogle(id, googleSub, email) {
      const rows = await db.q('UPDATE users SET google_sub = $1, email = $2 WHERE id = $3 AND google_sub IS NULL RETURNING id', [googleSub, email, id]);
      return rows.length > 0;
    },
    async setEmail(id, email) {
      await db.q('UPDATE users SET email = $1 WHERE id = $2', [email, id]);
    },
    async users() {
      return db.q('SELECT id, username, email FROM users');
    },
    async addSession(tokenHash, userId, expiresAt) {
      await db.q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);
    },
    async sessionUser(tokenHash) {
      const [r] = await db.q(
        'SELECT u.id, u.username, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
        [tokenHash]);
      if (!r) return null;
      if (r.expires_at < Date.now()) { await this.dropSession(tokenHash); return null; }
      return { id: r.id, username: r.username, email: r.email };
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
