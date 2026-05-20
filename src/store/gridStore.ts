import { create } from 'zustand';
import type { TaskNodeRow } from '@/db/schema';

// ============================================================
// 类型定义
// ============================================================

export interface TimeSlot {
  period: number;
  startTime: string; // "HH:mm"
  endTime: string;
}

export interface CourseItem {
  id: string;
  name: string;
  classroom: string;
  teacher: string;
  dayOfWeek: number; // 1-7, 1=周一
  startPeriod: number; // 1-12
  endPeriod: number; // 1-12, >= startPeriod
  colorIndex: number; // 0-11, 索引到马卡龙色板
  weekRange?: string; // e.g. "1-16"
}

/** 扩展的任务节点 — 携带特定日期字符串，用于软待办渲染 */
export interface TaskNodeExtended extends TaskNodeRow {
  /** 该任务在本周对应的绝对日期 (YYYY-MM-DD) */
  dateStr: string;
}

/** 创建面板的点击上下文 */
export interface SlotContext {
  dayOfWeek: number;
  startPeriod: number;
  dateStr: string; // ISO 日期字符串，用于绑定软待办
}

interface GridState {
  // ── 硬日程 ──
  currentWeek: number;
  timeSlots: TimeSlot[];
  courses: CourseItem[];

  // ── 软待办 ──
  /** 按星期 1-7 分组的当前周任务缓存 */
  dayTasks: Record<number, TaskNodeExtended[]>;

  // ── 创建面板 ──
  isCreateModalOpen: boolean;
  selectedSlotContext: SlotContext | null;

  // ── Actions ──
  setCurrentWeek: (week: number) => void;
  setCourses: (courses: CourseItem[]) => void;
  setDayTasks: (tasks: Record<number, TaskNodeExtended[]>) => void;
  openCreateModal: (dayOfWeek: number, period: number, dateStr: string) => void;
  closeCreateModal: () => void;
  addCourse: (course: CourseItem) => void;
  removeCourse: (id: string) => void;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_TIME_SLOTS: TimeSlot[] = [
  { period: 1, startTime: '08:00', endTime: '08:45' },
  { period: 2, startTime: '08:55', endTime: '09:40' },
  { period: 3, startTime: '10:00', endTime: '10:45' },
  { period: 4, startTime: '10:55', endTime: '11:40' },
  { period: 5, startTime: '14:00', endTime: '14:45' },
  { period: 6, startTime: '14:55', endTime: '15:40' },
  { period: 7, startTime: '16:00', endTime: '16:45' },
  { period: 8, startTime: '16:55', endTime: '17:40' },
  { period: 9, startTime: '19:00', endTime: '19:45' },
  { period: 10, startTime: '19:55', endTime: '20:40' },
  { period: 11, startTime: '20:50', endTime: '21:35' },
  { period: 12, startTime: '21:45', endTime: '22:30' },
];

/** 空的 dayTasks 初始化字典 */
const EMPTY_DAY_TASKS: Record<number, TaskNodeExtended[]> = {
  1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [],
};

// ============================================================
// Store
// ============================================================

export const useGridStore = create<GridState>((set) => ({
  // ── 初始状态 ──
  currentWeek: 1,
  timeSlots: DEFAULT_TIME_SLOTS,
  courses: [],
  dayTasks: { ...EMPTY_DAY_TASKS },
  isCreateModalOpen: false,
  selectedSlotContext: null,

  // ── Actions ──
  setCurrentWeek: (week: number) => set({ currentWeek: week }),

  setCourses: (courses) => set({ courses }),

  setDayTasks: (tasks) => set({ dayTasks: tasks }),

  // ── 创建面板 ──
  openCreateModal: (dayOfWeek, period, dateStr) =>
    set({
      isCreateModalOpen: true,
      selectedSlotContext: { dayOfWeek, startPeriod: period, dateStr },
    }),

  closeCreateModal: () =>
    set({
      isCreateModalOpen: false,
      selectedSlotContext: null,
    }),

  addCourse: (course) =>
    set((state) => ({ courses: [...state.courses, course] })),

  removeCourse: (id) =>
    set((state) => ({ courses: state.courses.filter((c) => c.id !== id) })),
}));
