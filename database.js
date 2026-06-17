import pg from 'pg';
import { SQLiteSessionStorage } from '@shopify/shopify-app-session-storage-sqlite';
import { Session } from '@shopify/shopify-api';
import Database from 'better-sqlite3';

let pgPool = null;
let sqliteDb = null;

export let sessionStorage = null;

export async function initDatabase() {
  const dbUrl = process.env.DATABASE_URL || '';

  if (dbUrl.startsWith('postgres')) {
    pgPool = new pg.Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes('railway') ? { rejectUnauthorized: false } : false,
    });
    await setupPostgresTables();
    sessionStorage = createPostgresSessionStorage();
    console.log('✅ PostgreSQL database ready');
    return;
  }

  sqliteDb = new Database('sessions.db');
  setupSQLiteTables();
  sessionStorage = new SQLiteSessionStorage('sessions.db');
  console.log('✅ SQLite database ready (local dev)');
}

async function setupPostgresTables() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS shopify_sessions (
      id TEXT PRIMARY KEY,
      shop TEXT NOT NULL,
      state TEXT,
      is_online BOOLEAN DEFAULT FALSE,
      scope TEXT,
      expires INTEGER,
      access_token TEXT,
      online_access_info TEXT
    )
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS bundle_history (
      id SERIAL PRIMARY KEY,
      shop TEXT NOT NULL,
      customer_name TEXT,
      customer_email TEXT,
      order_count INTEGER NOT NULL,
      total_items INTEGER NOT NULL,
      total_amount TEXT NOT NULL,
      orders_json TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

function setupSQLiteTables() {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS bundle_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop TEXT NOT NULL,
      customer_name TEXT,
      customer_email TEXT,
      order_count INTEGER NOT NULL,
      total_items INTEGER NOT NULL,
      total_amount TEXT NOT NULL,
      orders_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function createPostgresSessionStorage() {
  return {
    async storeSession(session) {
      await pgPool.query(
        `INSERT INTO shopify_sessions (id, shop, state, is_online, scope, expires, access_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           shop = EXCLUDED.shop,
           state = EXCLUDED.state,
           is_online = EXCLUDED.is_online,
           scope = EXCLUDED.scope,
           expires = EXCLUDED.expires,
           access_token = EXCLUDED.access_token`,
        [session.id, session.shop, session.state, session.isOnline, session.scope, session.expires, session.accessToken]
      );
      return true;
    },

    async loadSession(id) {
      const result = await pgPool.query('SELECT * FROM shopify_sessions WHERE id = $1', [id]);
      if (!result.rows.length) return undefined;

      const row = result.rows[0];
      return new Session({
        id: row.id,
        shop: row.shop,
        state: row.state,
        isOnline: row.is_online,
        scope: row.scope,
        expires: row.expires ? new Date(row.expires) : undefined,
        accessToken: row.access_token,
      });
    },

    async deleteSession(id) {
      await pgPool.query('DELETE FROM shopify_sessions WHERE id = $1', [id]);
      return true;
    },

    async deleteSessions(ids) {
      await pgPool.query('DELETE FROM shopify_sessions WHERE id = ANY($1)', [ids]);
      return true;
    },

    async findSessionsByShop(shop) {
      const result = await pgPool.query('SELECT * FROM shopify_sessions WHERE shop = $1', [shop]);
      return result.rows.map(row => new Session({
        id: row.id,
        shop: row.shop,
        state: row.state,
        isOnline: row.is_online,
        scope: row.scope,
        expires: row.expires ? new Date(row.expires) : undefined,
        accessToken: row.access_token,
      }));
    },
  };
}

function parseBundleRow(row) {
  if (!row) return null;

  return {
    ...row,
    id: Number(row.id),
    order_count: Number(row.order_count),
    total_items: Number(row.total_items),
    orders: JSON.parse(row.orders_json),
  };
}

export async function saveBundleHistory(shop, data) {
  const payload = {
    customer_name: data.customer_name || '',
    customer_email: data.customer_email || '',
    order_count: Number(data.order_count || 0),
    total_items: Number(data.total_items || 0),
    total_amount: String(data.total_amount || '0.00'),
    orders_json: JSON.stringify(data.orders || []),
  };

  if (pgPool) {
    const result = await pgPool.query(
      `INSERT INTO bundle_history (shop, customer_name, customer_email, order_count, total_items, total_amount, orders_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        shop,
        payload.customer_name,
        payload.customer_email,
        payload.order_count,
        payload.total_items,
        payload.total_amount,
        payload.orders_json,
      ]
    );

    return Number(result.rows[0].id);
  }

  const statement = sqliteDb.prepare(
    `INSERT INTO bundle_history (shop, customer_name, customer_email, order_count, total_items, total_amount, orders_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const info = statement.run(
    shop,
    payload.customer_name,
    payload.customer_email,
    payload.order_count,
    payload.total_items,
    payload.total_amount,
    payload.orders_json
  );

  return Number(info.lastInsertRowid);
}

export async function getBundleHistory(shop, limit = 25) {
  if (pgPool) {
    const result = await pgPool.query(
      'SELECT * FROM bundle_history WHERE shop = $1 ORDER BY created_at DESC LIMIT $2',
      [shop, limit]
    );
    return result.rows.map(parseBundleRow);
  }

  const rows = sqliteDb.prepare(
    'SELECT * FROM bundle_history WHERE shop = ? ORDER BY created_at DESC LIMIT ?'
  ).all(shop, limit);
  return rows.map(parseBundleRow);
}

export async function getBundleById(shop, id) {
  if (pgPool) {
    const result = await pgPool.query(
      'SELECT * FROM bundle_history WHERE shop = $1 AND id = $2 LIMIT 1',
      [shop, id]
    );
    return parseBundleRow(result.rows[0]);
  }

  const row = sqliteDb.prepare(
    'SELECT * FROM bundle_history WHERE shop = ? AND id = ? LIMIT 1'
  ).get(shop, id);
  return parseBundleRow(row);
}