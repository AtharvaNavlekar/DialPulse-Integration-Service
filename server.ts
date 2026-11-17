import 'dotenv/config';
import express, { type Express } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool } from './src/db/index.ts';
import {
  DurableEventWorker,
  type WorkerHealthSnapshot,
} from './src/server/events/event-worker.ts';
import { loadEventWorkerConfig } from './src/server/events/worker-config.ts';
import { buildViteMiddlewareOptions } from './src/server/vite-dev-config.ts';
import workspaceRoutes from './src/server/routes/workspace.ts';
import costsRoutes from './src/server/routes/costs.ts';
import formsRoutes from './src/server/routes/forms.ts';
import publicFormsRoutes from './src/server/routes/public-forms.ts';
import automationsRoutes from './src/server/routes/automations.ts';
import { createIntegrationsRouter } from './src/server/routes/integrations.ts';
import {
  createWebhookRouter,
  type CreateWebhookRouterOptions,
} from './src/server/routes/webhooks.ts';
import { createHealthRouter } from './src/server/routes/health.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateAppOptions {
  getWorkerHealth?: () => WorkerHealthSnapshot;
  checkDatabase?: () => Promise<void>;
  webhookOptions?: CreateWebhookRouterOptions;
}

const DEFAULT_DISABLED_WORKER_HEALTH: WorkerHealthSnapshot = {
  status: 'disabled',
  workerId: 'unstarted',
  enabled: false,
  running: false,
  stopping: false,
  healthy: true,
  pollIntervalMs: 2000,
  maxConcurrency: 3,
  leaseDurationMs: 60000,
  lastPollAt: null,
  lastSuccessAt: null,
  lastError: null,
};

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');

  // Inbound webhooks require exact raw request bytes BEFORE express.json() parses bodies.
  app.use(
    '/api/integrations/webhooks',
    createWebhookRouter(options.webhookOptions)
  );

  app.use(express.json({ limit: '1mb' }));

  app.use(
    '/api/health',
    createHealthRouter(
      options.getWorkerHealth ?? (() => DEFAULT_DISABLED_WORKER_HEALTH),
      options.checkDatabase
    )
  );

  app.use('/api/public/forms', publicFormsRoutes);
  app.use('/api/workspace/costs', costsRoutes);
  app.use('/api/workspace', workspaceRoutes);
  app.use('/api/forms', formsRoutes);
  app.use('/api/automations', automationsRoutes);
  app.use(
    '/api/integrations',
    createIntegrationsRouter({
      getWorkerHealth: options.getWorkerHealth,
    })
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}

async function startServer() {
  const port = Number(process.env.PORT || 3000);
  const workerConfig = loadEventWorkerConfig();
  const eventWorker = new DurableEventWorker(workerConfig);
  const app = createApp({
    getWorkerHealth: () => eventWorker.getHealthSnapshot(),
  });

  const server = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer(
      buildViteMiddlewareOptions({
        disableHmr: process.env.DISABLE_HMR === 'true',
        httpServer: server,
      })
    );
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`DialPulse Workspace listening on http://0.0.0.0:${port}`);
    if (workerConfig.enabled) {
      eventWorker.start();
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Received ${signal}; shutting down DialPulse Workspace gracefully...`);

    try {
      await eventWorker.stop(10_000);
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await closePool();
      process.exit(0);
    } catch (err) {
      console.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  startServer().catch((error) => {
    console.error('Failed to start DialPulse Workspace server:', error);
    process.exit(1);
  });
}
