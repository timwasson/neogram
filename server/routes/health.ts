import { Router, Request, Response } from 'express';
import { checkDbHealth } from '../db';
import os from 'os';

export const healthRouter = Router();

healthRouter.get('/health', async (_req: Request, res: Response) => {
  const dbHealth = await checkDbHealth();
  const uptimeSeconds = Math.floor(process.uptime());

  const isHealthy = dbHealth.status === 'up';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    version: '2.0.0-retro',
    uptime: `${uptimeSeconds}s`,
    timestamp: new Date().toISOString(),
    services: {
      database: {
        status: dbHealth.status,
        engine: 'postgresql',
        mode: dbHealth.isMemory ? 'in-memory-emulator' : 'live-cluster',
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        node: process.version,
        memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
    },
  });
});
