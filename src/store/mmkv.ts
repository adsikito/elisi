/**
 * MyBrain — MMKV 实例初始化与偏好存储
 *
 * MMKV 是腾讯开源的高性能键值存储：
 *   - 同步读写（零延迟，无需 await）
 *   - 内存映射（mmap），写入后立即持久化
 *   - 支持加密（AES-128），保护敏感数据
 *   - 比 AsyncStorage 快 30-100x
 *
 * 本模块职责：
 *   1. 存储用户 BYOK API Key（加密）
 *   2. 存储应用偏好设置（主题、语言、当前周等）
 *   3. 缓存轻量热数据（上次打开的课程表周次等）
 *
 * 与 SQLite 的分工：
 *   - MMKV：键值对、配置、敏感信息、热缓存
 *   - SQLite：结构化数据、关系查询、复杂事务
 */

import { MMKV } from 'react-native-mmkv';

// ============================================================
// MMKV 实例
// ============================================================

/**
 * 应用主存储实例（明文）
 * 用于非敏感的偏好设置和缓存
 */
export const storage = new MMKV({
  id: 'mybrain-main',
});

/**
 * 加密存储实例
 * 专用于 BYOK API Key 等敏感数据
 * 使用 AES-128 加密，密钥由设备 Keychain/Keystore 保护
 */
export const secureStorage = new MMKV({
  id: 'mybrain-secure',
  // 加密密钥：生产环境应从 SecureStore 获取或生成
  // 此处使用固定 key 仅作为开发阶段占位符
  // TODO: 接入 expo-secure-store 管理加密密钥
  encryptionKey: 'mybrain-dev-key-replace-in-production',
});

// ============================================================
// 类型定义
// ============================================================

/** 应用偏好设置的键值映射（类型安全的 get/set） */
export interface AppPreferences {
  /** 当前查看的教学周 */
  current_week: number;
  /** 开学日期（ISO 8601），用于自动计算当前教学周 */
  semester_start_date: string;
  /** 主题模式 */
  theme: 'system' | 'light' | 'dark';
  /** 是否显示周末（周六/周日） */
  byok_model: string;
  show_weekend: boolean;
  /** 课程表起始节次（有些学校第1节是早自习） */
  grid_start_period: number;
  /** 课程表结束节次 */
  grid_end_period: number;
  /** 是否已通过新手引导 */
  onboarding_done: boolean;
  /** 上次打开时间（用于恢复状态） */
  last_opened_at: string;
}

/** BYOK API Key 存储键值映射 */
export interface SecureKeys {
  /** OpenAI API Key */
  openai_api_key: string;
  /** Claude API Key */
  claude_api_key: string;
  /** 自定义 API Base URL */
  custom_api_base: string;
}

// ============================================================
// 偏好设置 API
// ============================================================

/**
 * 获取偏好设置值（同步）
 *
 * @param key 偏好键名
 * @param defaultValue 默认值（key 不存在时返回）
 * @returns 存储的值或默认值
 */
export function getPreference<K extends keyof AppPreferences>(
  key: K,
  defaultValue: AppPreferences[K],
): AppPreferences[K] {
  try {
    if (typeof defaultValue === 'number') {
      return (storage.getNumber(key) ?? defaultValue) as AppPreferences[K];
    }
    if (typeof defaultValue === 'boolean') {
      return (storage.getBoolean(key) ?? defaultValue) as AppPreferences[K];
    }
    return (storage.getString(key) ?? defaultValue) as AppPreferences[K];
  } catch {
    return defaultValue;
  }
}

/**
 * 设置偏好值（同步）
 */
export function setPreference<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K],
): void {
  try {
    if (typeof value === 'number') {
      storage.set(key, value);
    } else if (typeof value === 'boolean') {
      storage.set(key, value);
    } else {
      storage.set(key, value);
    }
  } catch (error) {
    console.error(`[MMKV] 设置偏好 ${key} 失败:`, error);
  }
}

/**
 * 删除偏好值
 */
export function deletePreference(key: keyof AppPreferences): void {
  try {
    storage.delete(key);
  } catch (error) {
    console.error(`[MMKV] 删除偏好 ${key} 失败:`, error);
  }
}

/**
 * 获取所有偏好设置（用于调试/导出）
 */
export function getAllPreferences(): Partial<AppPreferences> {
  const keys = storage.getAllKeys();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = storage.getString(key) ?? storage.getNumber(key) ?? storage.getBoolean(key);
  }
  return result as Partial<AppPreferences>;
}

// ============================================================
// BYOK API Key 管理（加密存储）
// ============================================================

/**
 * 获取 API Key（同步，从加密存储读取）
 *
 * @param key 键名
 * @returns API Key 字符串，不存在返回 null
 */
export function getApiKey<K extends keyof SecureKeys>(
  key: K,
): SecureKeys[K] | null {
  try {
    return (secureStorage.getString(key) as SecureKeys[K]) ?? null;
  } catch {
    return null;
  }
}

/**
 * 存储 API Key（同步，写入加密存储）
 */
export function setApiKey<K extends keyof SecureKeys>(
  key: K,
  value: SecureKeys[K],
): void {
  try {
    secureStorage.set(key, value);
  } catch (error) {
    console.error(`[MMKV] 存储 API Key ${key} 失败:`, error);
  }
}

/**
 * 删除 API Key
 */
export function deleteApiKey(key: keyof SecureKeys): void {
  try {
    secureStorage.delete(key);
  } catch (error) {
    console.error(`[MMKV] 删除 API Key ${key} 失败:`, error);
  }
}

/**
 * 检查是否有可用的 API Key（用于 BYOK 功能判断）
 */
export function hasAnyApiKey(): boolean {
  return (
    getApiKey('openai_api_key') !== null ||
    getApiKey('claude_api_key') !== null
  );
}

// ============================================================
// 热缓存 API
// ============================================================

/**
 * 缓存上次查看的课程表数据（避免冷启动白屏）
 */
export function cacheLastViewedWeek(week: number): void {
  try {
    storage.set('cache_last_week', week);
    storage.set('cache_last_week_at', Date.now());
  } catch {
    // 缓存失败不影响主流程
  }
}

/**
 * 获取上次查看的周次（带过期检查）
 * @param maxAgeMs 最大缓存有效期（毫秒），默认 7 天
 * @returns 上次查看的周次，过期返回 null
 */
export function getCachedLastWeek(
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): number | null {
  try {
    const cachedAt = storage.getNumber('cache_last_week_at');
    if (!cachedAt || Date.now() - cachedAt > maxAgeMs) {
      return null;
    }
    return storage.getNumber('cache_last_week') ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// 调试工具
// ============================================================

/**
 * 清除所有数据（危险！仅开发环境使用）
 */
export function clearAllStorage(): void {
  storage.clearAll();
  secureStorage.clearAll();
}

/**
 * 获取存储大小估算（字节）
 */
export function getStorageSize(): { main: number; secure: number } {
  // MMKV 没有直接暴露 size API，通过遍历 key 估算
  const estimate = (mmkv: MMKV): number => {
    let size = 0;
    for (const key of mmkv.getAllKeys()) {
      size += key.length * 2; // key 本身
      const str = mmkv.getString(key);
      if (str !== undefined) {
        size += str.length * 2;
        continue;
      }
      size += 8; // number / boolean
    }
    return size;
  };

  return {
    main: estimate(storage),
    secure: estimate(secureStorage),
  };
}
