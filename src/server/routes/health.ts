import { Router } from 'express';
import { pool } from '../../db/index.ts';
import {
  toPublicWorkerHealth,
  type WorkerHealthSnapshot,
} from '../events/event-worker.ts';

export function createHealthRouter(
  getWorkerHealth: () => WorkerHealthSnapshot,
  checkDatabase: () => Promise<void> = async () => {
    await pool.query('SELECT 1');
  }
): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'dialpulse-workspace',
    });
  });

  router.get('/live', (_req, res) => {
    res.json({
      status: 'live',
      service: 'dialpulse-workspace',
    });
  });

  router.get('/ready', async (_req, res) => {
    try {
      await checkDatabase();
      res.json({
        status: 'ready',
        database: 'reachable',
      });
    } catch {
      res.status(503).json({
        status: 'not_ready',
        database: 'unreachable',
      });
    }
  });

  router.get('/worker', (_req, res) => {
    const snapshot = getWorkerHealth();
    const publicSnapshot = toPublicWorkerHealth(snapshot);
    const statusCode = snapshot.healthy ? 200 : 503;
    res.status(statusCode).json({
      status: snapshot.status,
      worker: publicSnapshot,
    });
  });

  return router;
}
