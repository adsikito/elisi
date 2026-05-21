import { create } from 'zustand';
import { extractScheduleFromImage } from '@/ai/ByokConnector';
import {
  getTimeSlots,
  insertCourse,
  insertCourseSchedule,
  updateTimeSlot as persistTimeSlot,
} from '@/db/queries';
import {
  DEFAULT_TIMETABLE_ID,
  EXAM_TIMETABLE_ID,
  DEFAULT_TIME_SLOT_ROWS,
  type TaskNodeRow,
  type TimeSlotRow,
} from '@/db/schema';

// ============================================================
// 类型定义
// ============================================================

export interface TimeSlot {
  id: number;
  period: number;
  periodName: string;
  startTime: string; // "HH:mm"
  endTime: string;
}

export interface CourseItem {
  id: string;
  courseId?: string;
  timetableId?: string;
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
  /** 从 description 中解析出的节次 (1-12)，用于定位渲染位置 */
  startPeriod?: number;
}

/** 创建面板的点击上下文 */
export interface SlotContext {
  dayOfWeek: number;
  startPeriod: number;
  endPeriod: number;
  dateStr?: string;
}

/** 详情弹窗选中项 — 硬日程或软待办 */
export type DetailItem =
  | { type: 'course'; item: CourseItem }
  | { type: 'task'; item: TaskNodeExtended };

interface GridState {
  // ── 硬日程 ──
  currentWeek: number;
  activeTimetableId: string;
  timeSlots: TimeSlot[];
  courses: CourseItem[];

  // ── 软待办 ──
  /** 按星期 1-7 分组的当前周任务缓存 */
  dayTasks: Record<number, TaskNodeExtended[]>;

  // ── 强制刷新 ──
  refreshTick: number;
  isImporting: boolean;

  // ── 创建面板 ──
  isCreateModalOpen: boolean;
  selectedSlotContext: SlotContext | null;

  // ── 详情弹窗 ──
  isDetailModalOpen: boolean;
  selectedDetailItem: DetailItem | null;

  // ── Actions ──
  setCurrentWeek: (week: number) => void;
  setActiveTimetableId: (timetableId: string) => void;
  toggleTimetable: () => void;
  setCourses: (courses: CourseItem[]) => void;
  setDayTasks: (tasks: Record<number, TaskNodeExtended[]>) => void;
  loadTimeSlots: () => Promise<void>;
  updateTimeSlot: (
    id: number,
    changes: Partial<Pick<TimeSlot, 'periodName' | 'startTime' | 'endTime'>>,
  ) => Promise<void>;
  forceRefreshGrid: () => void;
  openCreateModal: (dayOfWeek: number, period: number, dateStr?: string) => void;
  closeCreateModal: () => void;
  openDetailModal: (item: DetailItem) => void;
  closeDetailModal: () => void;
  addCourse: (course: CourseItem) => void;
  removeCourse: (id: string) => void;
  importSchedule: (base64Image: string) => Promise<void>;
}

// ============================================================
// 常量
// ============================================================

export const DEFAULT_TIME_SLOTS: TimeSlot[] = DEFAULT_TIME_SLOT_ROWS.map(mapTimeSlotRow);

/** 空的 dayTasks 初始化字典 */
const EMPTY_DAY_TASKS: Record<number, TaskNodeExtended[]> = {
  1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [],
};

const IMPORT_START_WEEK = 1;
const IMPORT_END_WEEK = 16;

export const TIMETABLE_OPTIONS = [
  {
    id: DEFAULT_TIMETABLE_ID,
    label: '本周课表',
    shortLabel: '本周',
    accent: '#7B4F9D',
    background: '#EDE8FD',
  },
  {
    id: EXAM_TIMETABLE_ID,
    label: '考试周课表',
    shortLabel: '考试周',
    accent: '#B86144',
    background: '#FFE3D8',
  },
] as const;

function mapTimeSlotRow(row: TimeSlotRow): TimeSlot {
  return {
    id: row.id,
    period: row.id,
    periodName: row.period_name,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}
// ============================================================
// Store
// ============================================================

export const useGridStore = create<GridState>((set, get) => ({
  // ── 初始状态 ──
  currentWeek: 1,
  activeTimetableId: DEFAULT_TIMETABLE_ID,
  timeSlots: DEFAULT_TIME_SLOTS,
  courses: [],
  dayTasks: { ...EMPTY_DAY_TASKS },
  refreshTick: 0,
  isImporting: false,
  isCreateModalOpen: false,
  selectedSlotContext: null,
  isDetailModalOpen: false,
  selectedDetailItem: null,

  // ── Actions ──
  setCurrentWeek: (week: number) => set({ currentWeek: week }),

  setActiveTimetableId: (timetableId) =>
    set((state) => {
      const nextTimetableId = timetableId.trim() || DEFAULT_TIMETABLE_ID;
      if (state.activeTimetableId === nextTimetableId) return state;

      return {
        activeTimetableId: nextTimetableId,
        refreshTick: state.refreshTick + 1,
      };
    }),

  toggleTimetable: () =>
    set((state) => ({
      activeTimetableId:
        state.activeTimetableId === DEFAULT_TIMETABLE_ID
          ? EXAM_TIMETABLE_ID
          : DEFAULT_TIMETABLE_ID,
      refreshTick: state.refreshTick + 1,
    })),

  setCourses: (courses) => set({ courses }),

  setDayTasks: (tasks) => set({ dayTasks: tasks }),

  loadTimeSlots: async () => {
    const rows = await getTimeSlots();
    set({ timeSlots: rows.map(mapTimeSlotRow) });
  },

  updateTimeSlot: async (id, changes) => {
    await persistTimeSlot(id, {
      period_name: changes.periodName,
      start_time: changes.startTime,
      end_time: changes.endTime,
    });

    const rows = await getTimeSlots();
    set({ timeSlots: rows.map(mapTimeSlotRow) });
  },

  forceRefreshGrid: () => set((state) => ({ refreshTick: state.refreshTick + 1 })),

  // ── 创建面板 ──
  openCreateModal: (dayOfWeek, period, dateStr) =>
    set({
      isCreateModalOpen: true,
      selectedSlotContext: {
        dayOfWeek,
        startPeriod: period,
        endPeriod: period,
        ...(dateStr ? { dateStr } : {}),
      },
    }),

  closeCreateModal: () =>
    set({
      isCreateModalOpen: false,
      selectedSlotContext: null,
    }),

  // ── 详情弹窗 ──
  openDetailModal: (item) =>
    set({
      isDetailModalOpen: true,
      selectedDetailItem: item,
    }),

  closeDetailModal: () =>
    set({
      isDetailModalOpen: false,
      selectedDetailItem: null,
    }),

  addCourse: (course) =>
    set((state) => ({ courses: [...state.courses, course] })),

  removeCourse: (id) =>
    set((state) => ({ courses: state.courses.filter((c) => c.id !== id) })),

  importSchedule: async (base64Image) => {
    const MACARON_COLORS = [
      '#FFB3BA',
      '#FFDFBA',
      '#FFFFBA',
      '#BAFFC9',
      '#BAE1FF',
      '#E8BAFF',
      '#D4F0F0',
      '#FFC4C4',
    ];

    set({ isImporting: true });

    try {
      const data = await extractScheduleFromImage(base64Image);
      if (!Array.isArray(data?.courses)) {
        throw new Error('AI schedule result must include a courses array.');
      }

      for (let index = 0; index < data.courses.length; index += 1) {
        const course = data.courses[index];
        const colorIndex = Math.floor(Math.random() * MACARON_COLORS.length);
        const courseId = await insertCourse({
          timetable_id: get().activeTimetableId,
          name: course.title,
          color_index: colorIndex,
          classroom: course.location ?? '',
          teacher: course.teacher ?? '',
          start_week: IMPORT_START_WEEK,
          end_week: IMPORT_END_WEEK,
        });

        await insertCourseSchedule({
          course_id: courseId,
          day_of_week: course.dayOfWeek,
          start_period: course.startPeriod,
          end_period: course.endPeriod,
          start_week: IMPORT_START_WEEK,
          end_week: IMPORT_END_WEEK,
        });
      }

      get().forceRefreshGrid();
      set({ isImporting: false });
    } catch (error) {
      set({ isImporting: false });

      if (error instanceof Error && error.message.includes('API 密钥')) {
        throw error;
      }

      throw error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : '识别过程中发生未知错误');
    }
  },
}));
