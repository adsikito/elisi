/**
 * MyBrain — 全局设置 Store
 *
 * 管理应用级配置：开学日期、BYOK API Key / Model。
 * 持久化层依赖 MMKV（同步读写，零延迟）。
 *
 * 与 mmkv.ts 的分工：
 *   - mmkv.ts：底层读写原语（getPreference / setPreference / getApiKey / setApiKey）
 *   - settingsStore：上层状态管理（Zustand + MMKV 双写），供 React 组件消费
 */

import { create } from 'zustand';
import { getDatabase, withImmediateTransaction } from '@/db/database';
import { DEFAULT_ACTIVE_MODULES } from '@/config/modules';
import {
  storage,
  getPreference,
  setPreference,
  clearAllStorage,
} from './mmkv';

// ============================================================
// 辅助
// ============================================================

/** 获取今日日期字符串 YYYY-MM-DD */
function formatDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function getCurrentWeekMondayStr(): string {
  const monday = new Date();
  const day = monday.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + offset);
  return formatDate(monday);
}

function getInitialSemesterStartDate(): string {
  const stored = getPreference('semester_start_date', '').trim();
  if (stored) return stored;

  const fallback = getCurrentWeekMondayStr();
  setPreference('semester_start_date', fallback);
  return fallback;
}

export type ByokProvider = 'openai' | 'claude' | 'deepseek' | 'custom';

export const DEFAULT_BYOK_PROVIDER: ByokProvider = 'openai';
export const DEFAULT_BYOK_BASE_URL = 'https://api.openai.com';
export const DEEPSEEK_BYOK_BASE_URL = 'https://api.deepseek.com/v1';
export const DEEPSEEK_BYOK_MODEL = 'deepseek-chat';
const ACTIVE_MODULES_STORAGE_KEY = 'active_modules';

function normalizeByokProvider(value: string | undefined): ByokProvider {
  return value === 'openai' ||
    value === 'claude' ||
    value === 'deepseek' ||
    value === 'custom'
    ? value
    : DEFAULT_BYOK_PROVIDER;
}

function normalizeByokBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_BYOK_BASE_URL;
}

function getInitialByokBaseUrl(): string {
  const stored = storage.getString('byok_base_url');
  const normalized = normalizeByokBaseUrl(stored);

  if (stored !== normalized) {
    storage.set('byok_base_url', normalized);
  }

  return normalized;
}

function normalizeActiveModules(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ACTIVE_MODULES];

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean),
    ),
  );
}

function getInitialActiveModules(): string[] {
  const stored = storage.getString(ACTIVE_MODULES_STORAGE_KEY);
  if (!stored) return [...DEFAULT_ACTIVE_MODULES];

  try {
    return normalizeActiveModules(JSON.parse(stored));
  } catch {
    return [...DEFAULT_ACTIVE_MODULES];
  }
}

function persistActiveModules(activeModules: string[]): void {
  storage.set(ACTIVE_MODULES_STORAGE_KEY, JSON.stringify(activeModules));
}

// ============================================================
// 类型
// ============================================================

interface SettingsState {
  // ── 状态 ──
  /** 开学日期 (YYYY-MM-DD)，用于自动计算当前教学周 */
  semesterStartDate: string;
  /** BYOK API Key */
  byokApiKey: string;
  /** BYOK 模型标识 (e.g. "claude-sonnet-4-20250514") */
  byokModel: string;
  /** BYOK API Base URL */
  byokBaseUrl: string;
  /** BYOK provider */
  byokProvider: ByokProvider;
  /** Enabled feature modules rendered without restarting the app */
  activeModules: string[];

  // ── Actions ──
  /** 批量更新设置（自动同步写入 MMKV） */
  updateSettings: (partial: Partial<Pick<SettingsState, 'semesterStartDate' | 'byokApiKey' | 'byokModel' | 'byokBaseUrl' | 'byokProvider' | 'activeModules'>>) => void;
  toggleModule: (moduleId: string, enabled?: boolean) => void;
  /** 清空所有数据（SQLite 全表 + MMKV 全量 + Store 状态重置） */
  clearAllData: () => Promise<void>;
}

// ============================================================
// 从 MMKV 加载初始值（同步，模块顶层执行）
// ============================================================

const _initialSemesterStartDate = getInitialSemesterStartDate();
const _initialByokApiKey = (storage.getString('byok_api_key') as string) ?? '';
const _initialByokModel = (storage.getString('byok_model') as string) ?? '';
const _initialByokBaseUrl = getInitialByokBaseUrl();
const _initialByokProvider = normalizeByokProvider(storage.getString('byok_provider'));
const _initialActiveModules = getInitialActiveModules();

// ============================================================
// Store
// ============================================================

export const useSettingsStore = create<SettingsState>((set) => ({
  // ── 初始状态 ──
  semesterStartDate: _initialSemesterStartDate,
  byokApiKey: _initialByokApiKey,
  byokModel: _initialByokModel,
  byokBaseUrl: _initialByokBaseUrl,
  byokProvider: _initialByokProvider,
  activeModules: _initialActiveModules,

  // ── 更新设置 ──
  updateSettings: (partial) => {
    set((state) => {
      const next = { ...state };

      if (partial.semesterStartDate !== undefined) {
        next.semesterStartDate = partial.semesterStartDate;
        setPreference('semester_start_date', partial.semesterStartDate);
      }

      if (partial.byokApiKey !== undefined) {
        const trimmedApiKey = partial.byokApiKey.trim();
        next.byokApiKey = trimmedApiKey;
        if (trimmedApiKey) {
          storage.set('byok_api_key', trimmedApiKey);
        } else {
          storage.delete('byok_api_key');
        }
      }

      if (partial.byokModel !== undefined) {
        next.byokModel = partial.byokModel;
        storage.set('byok_model', partial.byokModel);
      }

      if (partial.byokBaseUrl !== undefined) {
        const trimmedBaseUrl = normalizeByokBaseUrl(partial.byokBaseUrl);
        next.byokBaseUrl = trimmedBaseUrl;
        storage.set('byok_base_url', trimmedBaseUrl);
      }

      if (partial.byokProvider !== undefined) {
        const provider = normalizeByokProvider(partial.byokProvider);
        next.byokProvider = provider;
        storage.set('byok_provider', provider);
      }

      if (partial.activeModules !== undefined) {
        const activeModules = normalizeActiveModules(partial.activeModules);
        next.activeModules = activeModules;
        persistActiveModules(activeModules);
      }

      return next;
    });
  },

  toggleModule: (moduleId, enabled) => {
    set((state) => {
      const trimmedModuleId = moduleId.trim();
      if (!trimmedModuleId) return state;

      const current = new Set(state.activeModules);
      const shouldEnable = enabled ?? !current.has(trimmedModuleId);

      if (shouldEnable) {
        current.add(trimmedModuleId);
      } else {
        current.delete(trimmedModuleId);
      }

      const activeModules = Array.from(current);
      persistActiveModules(activeModules);
      return { activeModules };
    });
  },

  // ── 清空所有数据 ──
  clearAllData: async () => {
    try {
      // 1. 清空 SQLite 所有表（按外键依赖正序删除，配合 ON DELETE CASCADE 双重保险）
      const db = await getDatabase();
      await withImmediateTransaction(db, async () => {
        await db.runAsync('DELETE FROM task_nodes');
        await db.runAsync('DELETE FROM course_schedules');
        await db.runAsync('DELETE FROM courses');
        await db.runAsync('DELETE FROM preferences');
      });

      // 2. 清空 MMKV（明文 + 加密）
      clearAllStorage();

      // 3. 重置 Zustand state 为初始值
      const resetDate = getCurrentWeekMondayStr();
      set({
        semesterStartDate: resetDate,
        byokApiKey: '',
        byokModel: '',
        byokBaseUrl: DEFAULT_BYOK_BASE_URL,
        byokProvider: DEFAULT_BYOK_PROVIDER,
        activeModules: [...DEFAULT_ACTIVE_MODULES],
      });

      // 4. 将重置后的默认值写回 MMKV（避免下次加载读到空值）
      setPreference('semester_start_date', resetDate);
      storage.set('byok_base_url', DEFAULT_BYOK_BASE_URL);
      storage.set('byok_provider', DEFAULT_BYOK_PROVIDER);
      persistActiveModules([...DEFAULT_ACTIVE_MODULES]);
    } catch (error) {
      console.error('[settingsStore] clearAllData 失败:', error);
      throw error;
    }
  },
}));
