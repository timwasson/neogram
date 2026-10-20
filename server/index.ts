import fs from 'fs';
import { createApp } from './app';
import { config } from './config';
import { initDatabase } from './db';

async function bootstrap() {
  console.log('====================================================');
  console.log('  NEOGRAM UNIX WORKSTATION BACKEND ENGINE // v2.0  ');
  console.log('====================================================');

  // Ensure storage directories exist
  if (!fs.existsSync(config.storageDir)) {
    fs.mkdirSync(config.storageDir, { recursive: true });
    console.log(`[:> STORAGE] Created uploads folder at ${config.storageDir}`);
  }

  // Initialize DB & execute migrations
  try {
    const dbStatus = await initDatabase();
    console.log(
      `[:> DB STATUS] Database online (${dbStatus.isMemory ? 'In-Memory pg-mem' : 'Live PostgreSQL'})`
    );

    const { seedInitialPostsIfEmpty } = await import('./db/seed');
    await seedInitialPostsIfEmpty();
  } catch (err: any) {
    console.error('[:> FATAL] Failed to initialize database:', err);
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`[:> SERVER] Running at http://localhost:${config.port}`);
    console.log(`[:> HEALTH] Probe ready at http://localhost:${config.port}/api/health`);
    console.log(`[:> STATS]  Database check at http://localhost:${config.port}/api/stats`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[:> SHUTDOWN] Terminating server cleanly...');
    server.close(() => {
      console.log('[:> SHUTDOWN] HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[:> BOOTSTRAP FAILED]', err);
  process.exit(1);
});
