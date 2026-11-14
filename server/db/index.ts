import { Pool, QueryResult, QueryResultRow } from 'pg';
import fs from 'fs';
import path from 'path';
import { newDb, DataType } from 'pg-mem';
import { config } from '../config';

interface DbClient {
  query<R extends QueryResultRow = any, I extends any[] = any[]>(
    queryText: string,
    values?: I
  ): Promise<QueryResult<R>>;
}

let activePool: DbClient | null = null;
let isMemoryFallback = false;
let isConnected = false;

export async function initDatabase(): Promise<{ isMemory: boolean; connected: boolean }> {
  if (activePool) {
    return { isMemory: isMemoryFallback, connected: isConnected };
  }

  // If memory DB fallback explicitly enabled and no external DB configured
  const tryExternal = !!process.env.DATABASE_URL;

  if (tryExternal) {
    try {
      const pool = new Pool({
        connectionString: config.databaseUrl,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 5000,
        query_timeout: 5000,
      });

      // Test probe
      await pool.query('SELECT 1');
      activePool = pool;
      isConnected = true;
      isMemoryFallback = false;
      console.log('[:> DB] Connected to PostgreSQL at', config.databaseUrl.replace(/:[^:@]+@/, ':***@'));
      await runMigrations(pool);
      return { isMemory: false, connected: true };
    } catch (err: any) {
      console.warn('[:> DB WARNING] Could not connect to external PostgreSQL:', err.message);
      if (!config.enableMemoryDbFallback) {
        throw err;
      }
      console.log('[:> DB] Falling back to in-memory PostgreSQL emulator (pg-mem) for development...');
    }
  }

  // Fallback to pg-mem
  try {
    const memDb = newDb();
    memDb.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.text,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });
    memDb.public.registerFunction({
      name: 'split_part',
      args: [DataType.text, DataType.text, DataType.integer],
      returns: DataType.text,
      implementation: (str: string, delimiter: string, field: number) => {
        if (!str) return '';
        const parts = str.split(delimiter);
        return parts[field - 1] ?? '';
      },
    });

    const memAdapter = memDb.adapters.createPg();
    const memPool = new memAdapter.Pool();

    activePool = memPool as unknown as DbClient;
    isMemoryFallback = true;
    isConnected = true;
    console.log('[:> DB] In-memory PostgreSQL instance initialized successfully.');
    await runMigrations(activePool);
    try {
      const { seedSnapshotIfEmpty } = await import('./seed');
      await seedSnapshotIfEmpty(activePool);
    } catch (_seedErr) {}
    return { isMemory: true, connected: true };
  } catch (memErr: any) {
    console.error('[:> DB ERROR] Failed to initialize in-memory database:', memErr.message);
    isConnected = false;
    return { isMemory: false, connected: false };
  }
}

export async function runMigrations(client: DbClient): Promise<void> {
  const migrationsDir = path.resolve(
    import.meta.dirname ?? path.resolve(process.cwd(), 'server/db'),
    'migrations'
  );
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    let sql = fs.readFileSync(filePath, 'utf-8');

    // pg-mem doesn't need pgcrypto extension statement
    if (isMemoryFallback) {
      sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/gi, '-- skipped for pg-mem');
    }

    try {
      await client.query(sql);
      console.log(`[:> DB MIGRATION] Executed: ${file}`);
    } catch (err: any) {
      console.error(`[:> DB MIGRATION FAILED] ${file}:`, err.message);
      throw err;
    }
  }
}

export async function query<R extends QueryResultRow = any, I extends any[] = any[]>(
  text: string,
  params?: I
): Promise<QueryResult<R>> {
  if (!activePool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  if (isMemoryFallback) return memoryQuery<R, I>(text, params);
  return activePool.query<R, I>(text, params);
}

// pg-mem (dev/test only) corrupts binary BYTEA parameters by round-tripping them through a UTF-8
// string, so encrypted credentials could never be read back. Store Buffers as tagged base64 text and
// decode them on the way out. Real PostgreSQL never takes this path.
const MEM_BYTEA_TAG = 'ngmem-b64:';

async function memoryQuery<R extends QueryResultRow, I extends any[]>(text: string, params?: I): Promise<QueryResult<R>> {
  const encoded = params?.map((p) => (Buffer.isBuffer(p) ? MEM_BYTEA_TAG + p.toString('base64') : p)) as I | undefined;
  const result = await activePool!.query<R, I>(text, encoded);
  for (const row of result.rows as any[]) {
    for (const key of Object.keys(row)) {
      const v = row[key];
      if (Buffer.isBuffer(v) && v.subarray(0, MEM_BYTEA_TAG.length).toString('latin1') === MEM_BYTEA_TAG) {
        row[key] = Buffer.from(v.subarray(MEM_BYTEA_TAG.length).toString('latin1'), 'base64');
      } else if (typeof v === 'string' && v.startsWith(MEM_BYTEA_TAG)) {
        row[key] = Buffer.from(v.slice(MEM_BYTEA_TAG.length), 'base64');
      }
    }
  }
  return result;
}

export async function checkDbHealth(): Promise<{ status: 'up' | 'down'; isMemory: boolean; timestamp: string }> {
  if (!activePool || !isConnected) {
    return { status: 'down', isMemory: false, timestamp: new Date().toISOString() };
  }
  try {
    await activePool.query('SELECT 1');
    return { status: 'up', isMemory: isMemoryFallback, timestamp: new Date().toISOString() };
  } catch {
    return { status: 'down', isMemory: isMemoryFallback, timestamp: new Date().toISOString() };
  }
}
