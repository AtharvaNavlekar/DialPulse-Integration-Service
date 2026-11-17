import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';
import {
  DEFAULT_SQL_POOL_CONFIG,
  handleIdlePoolError,
} from './pool-config.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = (): Pool => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      ...DEFAULT_SQL_POOL_CONFIG,
    });

    global._postgresPool.on('error', (err) => {
      handleIdlePoolError(err);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();

export const db = drizzle(pool, { schema });

export async function closePool(): Promise<void> {
  if (global._postgresPool) {
    const activePool = global._postgresPool;
    global._postgresPool = undefined;
    await activePool.end();
  }
}
