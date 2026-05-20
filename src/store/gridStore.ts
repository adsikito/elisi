import { create } from 'zustand';

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

interface SelectedCell {
  dayOfWeek: number;
  period: number;
}

interface GridState {
  currentWeek: number;
  timeSlots: TimeSlot[];
  courses: CourseItem[];
  selectedCell: SelectedCell | null;
  showQuickCreate: boolean;

  setCurrentWeek: (week: number) => void;
  setCourses: (courses: CourseItem[]) => void;
  setSelectedCell: (cell: SelectedCell | null) => void;
  setShowQuickCreate: (show: boolean) => void;
  addCourse: (course: CourseItem) => void;
  removeCourse: (id: string) => void;
}

// 默认大学 12 节课时间配置
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

export const useGridStore = create<GridState>((set) => ({
  currentWeek: 1,
  timeSlots: DEFAULT_TIME_SLOTS,
  courses: [],
  selectedCell: null,
  showQuickCreate: false,

  setCurrentWeek: (week) => set({ currentWeek: week }),

  setCourses: (courses) => set({ courses }),

  setSelectedCell: (cell) => set({ selectedCell: cell }),

  setShowQuickCreate: (show) => set({ showQuickCreate: show }),

  addCourse: (course) =>
    set((state) => ({ courses: [...state.courses, course] })),

  removeCourse: (id) =>
    set((state) => ({ courses: state.courses.filter((c) => c.id !== id) })),
}));
