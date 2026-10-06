import pg from 'pg';
import { config } from '../config.js';

// bigint (message seq, count(*)) arrives as a string by default. Every bigint
// in this schema stays far below 2^53, so plain numbers are safe.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unexpected error on an idle database connection', err);
});

export const query = (text, params) => pool.query(text, params);

/**
 * Runs `fn` inside a transaction on a dedicated connection. Commits when it
 * resolves, rolls back when it throws.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
