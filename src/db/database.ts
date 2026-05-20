/**
 * MyBrain — SQLite 数据库初始化与生命周期管理
 *
 * 使用 expo-sqlite (v15+ async API) 管理本地数据库。
 * 强制开启 WAL (Write-Ahead Logging) 模式：
 *   - 读写并发：读操作不阻塞写操作
 *   - 写入性能：批量写入吞吐量提升 2-5x
 *   - 崩溃恢复：WAL checkpoint 保证数据一致性
 *
 * 调用方式：
 *   const db = await getDatabase();
 *   await db.runAsync('SELECT ...');
 */

import * as SQLite from 'expo-sqlite';
import {
  ALL_CREATE_TABLES,
  ALL_CREATE_INDEXES,
} from './schema';

// ============================================================
// 常量
// ============================================================

/** 数据库文件名，存储在 app 的 SQLite 目录 */
const DB_NAME = 'mybrain.db';

/** WAL 自动 checkpoint 阈值（页数），默认 1000 页 ≈ 4MB */
const WAL_CHECKPOINT_PAGES = 1000;

// ============================================================
// 单例数据库实例
// ============================================================

let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * 获取数据库单例（线程安全）
 *
 * 首次调用时执行：
 *   1. 打开数据库连接
 *   2. 开启 WAL 模式
 *   3. 启用外键约束
 *   4. 创建所有表和索引
 *
 * 后续调用直接返回缓存实例。
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;

  // 防止并发初始化导致多实例
  if (_initPromise) return _initPromise;

  _initPromise = initDatabase();
  try {
    _db = await _initPromise;
    return _db;
  } catch (error) {
    // 初始化失败，清除 promise 以便重试
    _initPromise = null;
    throw error;
  }
}

// ============================================================
// 内部初始化逻辑
// ============================================================

async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  // 1. 强制开启 WAL 模式（必须在任何事务之前）
  await db.execAsync('PRAGMA journal_mode = WAL;');

  // 2. WAL 性能调优
  await db.execAsync(`PRAGMA wal_autocheckpoint = ${WAL_CHECKPOINT_PAGES};`);
  // 同步模式 NORMAL：WAL 下足够安全，性能最优
  await db.execAsync('PRAGMA synchronous = NORMAL;');
  // 增大缓存页数（负值 = KB），默认 -2000 = 2MB 缓存
  await db.execAsync('PRAGMA cache_size = -4000;');

  // 3. 启用外键约束（SQLite 默认关闭）
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // 4. 启用递归触发器（task_nodes 级联删除需要）
  await db.execAsync('PRAGMA recursive_triggers = ON;');

  // 5. 创建表结构（按依赖顺序）
  for (const ddl of ALL_CREATE_TABLES) {
    await db.execAsync(ddl);
  }

  // 6. 创建索引
  for (const ddl of ALL_CREATE_INDEXES) {
    await db.execAsync(ddl);
  }

  return db;
}

// ============================================================
// 数据库维护工具
// ============================================================

/**
 * 手动触发 WAL checkpoint（将 WAL 日志合并回主数据库文件）
 * 适用于大量写入后的空间回收
 */
export async function checkpoint(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
}

/**
 * 获取数据库文件大小信息（字节）
 * 用于调试和存储空间监控
 */
export async function getDatabaseInfo(): Promise<{
  pageSize: number;
  pageCount: number;
  walPages: number;
  sizeBytes: number;
  walSizeBytes: number;
}> {
  const db = await getDatabase();

  const [pageSizeRow, pageCountRow, walPagesRow] = await Promise.all([
    db.getFirstAsync<{ page_size: number }>('PRAGMA page_size;'),
    db.getFirstAsync<{ page_count: number }>('PRAGMA page_count;'),
    db.getFirstAsync<{ wal_checkpoint: number }>('PRAGMA wal_checkpoint;'),
  ]);

  const pageSize = pageSizeRow?.page_size ?? 4096;
  const pageCount = pageCountRow?.page_count ?? 0;
  const walPages = walPagesRow?.wal_checkpoint ?? 0;

  return {
    pageSize,
    pageCount,
    walPages,
    sizeBytes: pageCount * pageSize,
    walSizeBytes: walPages * pageSize,
  };
}

/**
 * 关闭数据库连接（应用退出时调用）
 * 注意：expo-sqlite 在 app 生命周期内通常不需要手动关闭
 */
export async function closeDatabase(): Promise<void> {
  if (_db) {
    await _db.closeAsync();
    _db = null;
    _initPromise = null;
  }
}

/**
 * 重置数据库（危险操作！仅用于开发/测试）
 * 会清空所有数据，然后重新创建表结构
 */
export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();

  // 删除所有表（按外键依赖反序）
  await db.execAsync(`
    DROP TABLE IF EXISTS task_nodes;
    DROP TABLE IF EXISTS course_schedules;
    DROP TABLE IF EXISTS courses;
    DROP TABLE IF EXISTS preferences;
  `);

  // 重建
  for (const ddl of ALL_CREATE_TABLES) {
    await db.execAsync(ddl);
  }
  for (const ddl of ALL_CREATE_INDEXES) {
    await db.execAsync(ddl);
  }
}

// ============================================================
// UUID 生成（离线环境不依赖 crypto.randomUUID）
// ============================================================

/**
 * 生成 UUID v4（简化版，符合 RFC 4122）
 * 碰撞概率 ≈ 2^-122，足够本地数据库主键使用
 */
export function generateId(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      id += '-';
    } else if (i === 14) {
      id += '4'; // UUID v4 版本号
    } else if (i === 19) {
      id += hex[(Math.random() * 4) | 8]; // 变体位
    } else {
      id += hex[(Math.random() * 16) | 0];
    }
  }
  return id;
}
