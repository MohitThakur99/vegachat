import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { pool } from './db/pool.js';
import { seedIfEmpty } from './db/seed.js';
import { ensureUploadDir } from './lib/storage.js';
import { createSocketServer } from './realtime/socketServer.js';

async function main() {
  await runMigrations();
  if (config.seedOnStart) await seedIfEmpty();
  await ensureUploadDir();

  const server = http.createServer(createApp());
  const io = createSocketServer(server);

  server.listen(config.port, () => {
    console.log(`VegaChat server listening on port ${config.port} (${config.env})`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    // Closes every socket and the HTTP server.
    await io.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
