import { create } from 'zustand';
import type { TaskNodeRow, TaskStatus } from '@/db';
import { getSchedulesByWeek, parseWeeksMask, type ScheduleSlot } from '@/db';
import { getPreference } from '@/store/mmkv';
import { useTaskStore } from '@/store/taskStore';

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
  setCurrentWeek: (week: number) => Promise<void>;
  setCourses: (courses: CourseItem[]) => void;
  openCreateModal: (dayOfWeek: number, period: number, dateStr: string) => void;
  closeCreateModal: () => void;
  addCourse: (course: CourseItem) => void;
  removeCourse: (id: string) => void;
  /** 手动刷新软待办缓存（任务变更后调用） */
  refreshDayTasks: () => void;
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
// 工具函数
// ============================================================

/**
 * 根据教学周序号计算该周的日期范围
 * @returns [mondayStr, sundayStr] 格式 YYYY-MM-DD
 */
function getWeekDateRange(
  weekNumber: number,
  semesterStartDate: string,
): [string, string] {
  const start = new Date(semesterStartDate + 'T00:00:00');
  // 教学周从周一开始，semesterStartDate 应为第一周的周一
  const monday = new Date(start);
  monday.setDate(start.getDate() + (weekNumber - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return [formatDate(monday), formatDate(sunday)];
}

/** Date → YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO 日期字符串 → dayOfWeek (1=周一, 7=周日) */
function isoToDayOfWeek(isoDate: string): number {
  const d = new Date(isoDate + 'T00:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return day === 0 ? 7 : day;
}

/**
 * 从 taskStore.flatList 中过滤出本周任务，按 dayOfWeek 分组
 * 纯内存操作，O(n) 遍历，毫秒级完成
 */
function filterAndGroupTasks(
  flatList: Array<{
    id: string;
    parent_id: string | null;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: number;
    due_date: string | null;
    created_at: string;
    updated_at: string;
    depth: number;
    hasChildren: boolean;
    isLoading: boolean;
  }>,
  mondayStr: string,
  sundayStr: string,
): Record<number, TaskNodeExtended[]> {
  const result: Record<number, TaskNodeExtended[]> = {
    1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [],
  };

  for (const task of flatList) {
    if (!task.due_date) continue;

    // 提取日期部分进行比较（避免时区问题）
    const taskDate = task.due_date.substring(0, 10);
    if (taskDate < mondayStr || taskDate > sundayStr) continue;

    const dow = isoToDayOfWeek(taskDate);
    result[dow].push({
      ...task,
      dateStr: taskDate,
    });
  }

  // 按优先级降序排列（高优先级在前）
  for (let d = 1; d <= 7; d++) {
    result[d].sort((a, b) => b.priority - a.priority);
  }

  return result;
}

/**
 * 从 ScheduleSlot[] 转换为 CourseItem[]（供 UI 消费）
 */
function scheduleSlotsToCourses(slots: ScheduleSlot[]): CourseItem[] {
  return slots.map((s) => {
    const weeks = parseWeeksMask(s.weeks_mask);
    const weekRange = weeks.length > 0
      ? `${weeks[0]}-${weeks[weeks.length - 1]}`
      : undefined;
    return {
      id: s.schedule_id,
      name: s.course_name,
      classroom: s.classroom,
      teacher: s.teacher,
      dayOfWeek: s.day_of_week,
      startPeriod: s.start_period,
      endPeriod: s.end_period,
      colorIndex: s.color_index,
      weekRange,
    };
  });
}

// ============================================================
// Store
// ============================================================

export const useGridStore = create<GridState>((set, get) => ({
  // ── 初始状态 ──
  currentWeek: 1,
  timeSlots: DEFAULT_TIME_SLOTS,
  courses: [],
  dayTasks: { ...EMPTY_DAY_TASKS },
  isCreateModalOpen: false,
  selectedSlotContext: null,

  // ── setCurrentWeek：核心数据同步入口 ──
  setCurrentWeek: async (week: number) => {
    set({ currentWeek: week });

    // 并行加载硬日程 + 软待办
    await Promise.all([
      // 1. 硬日程：SQLite 位运算查询
      (async () => {
        try {
          const slots = await getSchedulesByWeek(week);
          set({ courses: scheduleSlotsToCourses(slots) });
        } catch (e) {
          console.error('[gridStore] 加载课表失败:', e);
          set({ courses: [] });
        }
      })(),

      // 2. 软待办：从 taskStore 内存数据过滤
      (async () => {
        try {
          const semesterStart = getPreference('semester_start_date', '');
          if (!semesterStart) {
            set({ dayTasks: { ...EMPTY_DAY_TASKS } });
            return;
          }

          const [monday, sunday] = getWeekDateRange(week, semesterStart);
          const flatList = useTaskStore.getState().flatList;
          const grouped = filterAndGroupTasks(flatList, monday, sunday);
          set({ dayTasks: grouped });
        } catch (e) {
          console.error('[gridStore] 加载软待办失败:', e);
          set({ dayTasks: { ...EMPTY_DAY_TASKS } });
        }
      })(),
    ]);
  },

  setCourses: (courses) => set({ courses }),

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

  // ── 手动刷新软待办（任务增删改后调用） ──
  refreshDayTasks: () => {
    const { currentWeek } = get();
    try {
      const semesterStart = getPreference('semester_start_date', '');
      if (!semesterStart) {
        set({ dayTasks: { ...EMPTY_DAY_TASKS } });
        return;
      }

      const [monday, sunday] = getWeekDateRange(currentWeek, semesterStart);
      const flatList = useTaskStore.getState().flatList;
      const grouped = filterAndGroupTasks(flatList, monday, sunday);
      set({ dayTasks: grouped });
    } catch (e) {
      console.error('[gridStore] 刷新软待办失败:', e);
    }
  },
}));
