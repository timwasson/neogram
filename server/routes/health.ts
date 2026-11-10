import { Router, Request, Response } from 'express';
import { checkDbHealth } from '../db';
import { buildQueue } from '../services/staticBuilder';
import os from 'os';

export const healthRouter = Router();

healthRouter.get('/health', async (_req: Request, res: Response) => {
  const dbHealth = await checkDbHealth();
  const uptimeSeconds = Math.floor(process.uptime());
  const mem = process.memoryUsage();
  const q = buildQueue.getTelemetry();
  const completedDurations = q.history
    .filter((j) => j.status === 'SUCCESS' && typeof j.durationMs === 'number')
    .map((j) => j.durationMs!)
    .sort((a, b) => a - b);

  const avgDurationMs = completedDurations.length
    ? Math.round(completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length)
    : 0;
  const p95DurationMs = completedDurations.length
    ? completedDurations[Math.min(completedDurations.length - 1, Math.max(0, Math.ceil(0.95 * completedDurations.length) - 1))]
    : 0;
  const maxDurationMs = completedDurations.length ? completedDurations[completedDurations.length - 1] : 0;

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
        memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
      },
      queue: {
        isBusy: q.isBusy,
        activeCount: q.activeCount,
        highPendingCount: q.highPendingCount,
        lowPendingCount: q.lowPendingCount,
        peakQueueDepth: q.peakQueueDepth,
        totalProcessed: q.totalProcessed,
        avgDurationMs,
        p95DurationMs,
        maxDurationMs,
      },
    },
  });
});
