import * as SQLite from 'expo-sqlite';
import { ALL_CREATE_INDEXES, ALL_CREATE_TABLES } from './schema';

const DB_NAME = 'mybrain.db';
const WAL_CHECKPOINT_PAGES = 1000;

let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function withImmediateTransaction<T>(
  db: SQLite.SQLiteDatabase,
  work: () => Promise<T>,
): Promise<T> {
  await db.execAsync('BEGIN IMMEDIATE;');

  try {
    const result = await work();
    await db.execAsync('COMMIT;');
    return result;
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK;');
    } catch {
      // Ignore rollback failures. The original error is more useful.
    }
    throw error;
  }
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = initDatabase();
  try {
    _db = await _initPromise;
    return _db;
  } catch (error) {
    _initPromise = null;
    throw error;
  }
}

async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  try {
    await db.execAsync('PRAGMA busy_timeout = 5000;');
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync(`PRAGMA wal_autocheckpoint = ${WAL_CHECKPOINT_PAGES};`);
    await db.execAsync('PRAGMA synchronous = NORMAL;');
    await db.execAsync('PRAGMA cache_size = -4000;');
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await db.execAsync('PRAGMA recursive_triggers = ON;');

    await withImmediateTransaction(db, async () => {
      for (const ddl of ALL_CREATE_TABLES) {
        await db.execAsync(ddl);
      }

      for (const ddl of ALL_CREATE_INDEXES) {
        await db.execAsync(ddl);
      }
    });

    return db;
  } catch (error) {
    try {
      await db.closeAsync();
    } catch {
      // Best effort cleanup.
    }
    throw error;
  }
}

export async function checkpoint(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
}

export async function getDatabaseInfo(): Promise<{
  pageSize: number;
  pageCount: number;
  walPages: number;
  sizeBytes: number;
  walSizeBytes: number;
}> {
  const db = await getDatabase();

  const [pageSizeRow, pageCountRow, walInfoRow] = await Promise.all([
    db.getFirstAsync<{ page_size: number }>('PRAGMA page_size;'),
    db.getFirstAsync<{ page_count: number }>('PRAGMA page_count;'),
    db.getFirstAsync<{ busy: number; log: number; checkpointed: number }>(
      'PRAGMA wal_checkpoint(PASSIVE);',
    ),
  ]);

  const pageSize = pageSizeRow?.page_size ?? 4096;
  const pageCount = pageCountRow?.page_count ?? 0;
  const walPages = walInfoRow?.log ?? 0;

  return {
    pageSize,
    pageCount,
    walPages,
    sizeBytes: pageCount * pageSize,
    walSizeBytes: walPages * pageSize,
  };
}

export async function closeDatabase(): Promise<void> {
  if (_db) {
    await _db.closeAsync();
    _db = null;
    _initPromise = null;
  }
}

export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();

  await withImmediateTransaction(db, async () => {
    await db.execAsync('DROP TABLE IF EXISTS task_nodes;');
    await db.execAsync('DROP TABLE IF EXISTS course_schedules;');
    await db.execAsync('DROP TABLE IF EXISTS courses;');
    await db.execAsync('DROP TABLE IF EXISTS preferences;');

    for (const ddl of ALL_CREATE_TABLES) {
      await db.execAsync(ddl);
    }

    for (const ddl of ALL_CREATE_INDEXES) {
      await db.execAsync(ddl);
    }
  });
}

export function generateId(): string {
  const hex = '0123456789abcdef';
  let id = '';

  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      id += '-';
    } else if (i === 14) {
      id += '4';
    } else if (i === 19) {
      id += hex[(Math.random() * 4) | 8];
    } else {
      id += hex[(Math.random() * 16) | 0];
    }
  }

  return id;
}
