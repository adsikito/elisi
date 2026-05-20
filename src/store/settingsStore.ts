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
import { getDatabase } from '@/db/database';
import {
  storage,
  getPreference,
  setPreference,
  getApiKey,
  setApiKey,
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

  // ── Actions ──
  /** 批量更新设置（自动同步写入 MMKV） */
  updateSettings: (partial: Partial<Pick<SettingsState, 'semesterStartDate' | 'byokApiKey' | 'byokModel'>>) => void;
  /** 清空所有数据（SQLite 全表 + MMKV 全量 + Store 状态重置） */
  clearAllData: () => Promise<void>;
}

// ============================================================
// 从 MMKV 加载初始值（同步，模块顶层执行）
// ============================================================

const _initialSemesterStartDate = getInitialSemesterStartDate();
const _initialByokApiKey = getApiKey('claude_api_key') ?? '';
const _initialByokModel = (storage.getString('byok_model') as string) ?? '';

// ============================================================
// Store
// ============================================================

export const useSettingsStore = create<SettingsState>((set) => ({
  // ── 初始状态 ──
  semesterStartDate: _initialSemesterStartDate,
  byokApiKey: _initialByokApiKey,
  byokModel: _initialByokModel,

  // ── 更新设置 ──
  updateSettings: (partial) => {
    set((state) => {
      const next = { ...state };

      if (partial.semesterStartDate !== undefined) {
        next.semesterStartDate = partial.semesterStartDate;
        setPreference('semester_start_date', partial.semesterStartDate);
      }

      if (partial.byokApiKey !== undefined) {
        next.byokApiKey = partial.byokApiKey;
        setApiKey('claude_api_key', partial.byokApiKey);
      }

      if (partial.byokModel !== undefined) {
        next.byokModel = partial.byokModel;
        storage.set('byok_model', partial.byokModel);
      }

      return next;
    });
  },

  // ── 清空所有数据 ──
  clearAllData: async () => {
    try {
      // 1. 清空 SQLite 所有表（按外键依赖正序删除，配合 ON DELETE CASCADE 双重保险）
      const db = await getDatabase();
      await db.withTransactionAsync(async () => {
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
      });

      // 4. 将重置后的默认值写回 MMKV（避免下次加载读到空值）
      setPreference('semester_start_date', resetDate);
    } catch (error) {
      console.error('[settingsStore] clearAllData 失败:', error);
      throw error;
    }
  },
}));
