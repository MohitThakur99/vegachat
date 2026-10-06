import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, withTransaction } from './pool.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Arbitrary constant: stops two server instances migrating at the same time.
const ADVISORY_LOCK_ID = 727274;

/**
 * Applies every .sql file in migrations/ that has not run yet, in name order.
 *
 * Everything happens in one transaction under a transaction-scoped advisory
 * lock. A session-scoped lock would not survive Supabase's transaction pooler,
 * where consecutive statements can land on different connections.
 */
export async function runMigrations() {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY');

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query(sql);
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      console.log(`Applied migration ${file}`);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then(() => console.log('Migrations are up to date'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
