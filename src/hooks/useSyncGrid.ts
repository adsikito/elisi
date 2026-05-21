import { useEffect, useRef, useState } from 'react';
import { useGridStore, type CourseItem, type TaskNodeExtended } from '../store/gridStore';
import { getLessons, getTasksByDateRange, type ScheduleSlot, type TaskNodeRow } from '../db';
import { getPreference } from '../store/mmkv';

interface SyncState {
  isLoading: boolean;
  error: string | null;
}

/** 按 dayOfWeek (1-7) 分组的软待办字典 */
type GroupedTasks = Record<number, TaskNodeExtended[]>;

const EMPTY_DAY_TASKS: GroupedTasks = {
  1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [],
};

/**
 * useSyncGrid — 监听 gridStore.currentWeek，自动从 SQLite 拉取硬课程 + 软待办。
 *
 * 混合查询策略：
 *   步骤A：getLessons(week, timetableId) — SQLite 位运算，O(1) 周次 + 课表过滤
 *   步骤B：getTasksByDateRange(start, end) — 利用 idx_tasks_due_date 部分索引
 *   两步并行执行，结果分别写入 gridStore.courses 和 gridStore.dayTasks
 *
 * 竞态防护：
 *   - fetchIdRef：单调递增 ID，仅最新一次请求可写入状态
 *   - cancelled flag：effect cleanup 时置 true，阻止过期请求 set state
 */
export function useSyncGrid(): SyncState {
  const currentWeek = useGridStore((s) => s.currentWeek);
  const activeTimetableId = useGridStore((s) => s.activeTimetableId);
  const refreshTick = useGridStore((s) => s.refreshTick);
  const setCourses = useGridStore((s) => s.setCourses);
  const setDayTasks = useGridStore((s) => s.setDayTasks);
  const loadTimeSlots = useGridStore((s) => s.loadTimeSlots);

  const [state, setState] = useState<SyncState>({ isLoading: false, error: null });

  // 单调递增 fetch ID，防止旧请求覆盖新数据
  const fetchIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const thisFetchId = ++fetchIdRef.current;

    setState({ isLoading: true, error: null });

    // 计算当前周的日期范围 [monday, sunday]
    const semesterStart = getPreference('semester_start_date', '');
    let weekDates: [string, string] | null = null;
    if (semesterStart) {
      weekDates = getWeekDateRange(currentWeek, semesterStart);
    }

    // 并行执行步骤A（硬课程）和步骤B（软待办）
    Promise.all([
      loadTimeSlots(),
      getLessons(currentWeek, activeTimetableId),
      weekDates
        ? getTasksByDateRange(weekDates[0], weekDates[1])
        : Promise.resolve<TaskNodeRow[]>([]),
    ])
      .then(([, slots, taskRows]) => {
        if (cancelled || thisFetchId !== fetchIdRef.current) return;

        // 步骤A：ScheduleSlot → CourseItem
        const courses: CourseItem[] = slots.map(mapScheduleToCourseItem);

        // 步骤B：TaskNodeRow → 按 dayOfWeek 分组的字典
        const dayTasks: GroupedTasks = weekDates
          ? groupTasksByDay(taskRows, weekDates[0])
          : { ...EMPTY_DAY_TASKS };

        setCourses(courses);
        setDayTasks(dayTasks);
        setState({ isLoading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled || thisFetchId !== fetchIdRef.current) return;

        const message =
          err instanceof Error ? err.message : `加载第 ${currentWeek} 周数据失败`;
        setState({ isLoading: false, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [activeTimetableId, currentWeek, refreshTick, loadTimeSlots, setCourses, setDayTasks]);

  return state;
}

// ============================================================
// 映射 & 分组工具
// ============================================================

/** ScheduleSlot → CourseItem 映射 */
function mapScheduleToCourseItem(slot: ScheduleSlot): CourseItem {
  return {
    id: slot.schedule_id,
    courseId: slot.course_id,
    timetableId: slot.timetable_id,
    name: slot.course_name,
    classroom: slot.classroom,
    teacher: slot.teacher,
    dayOfWeek: slot.day_of_week,
    startPeriod: slot.start_period,
    endPeriod: slot.end_period,
    colorIndex: slot.color_index,
  };
}

/**
 * 将任务按 dayOfWeek (1=周一, 7=周日) 分组
 * 仅依赖 due_date 的日期部分进行分组，按优先级降序排列
 */
function groupTasksByDay(
  tasks: TaskNodeRow[],
  mondayStr: string,
): GroupedTasks {
  const result: GroupedTasks = {
    1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [],
  };

  for (const task of tasks) {
    if (!task.due_date) continue;

    // 提取日期部分 (YYYY-MM-DD) 进行分组
    const taskDate = task.due_date.substring(0, 10);
    const dow = isoToDayOfWeek(taskDate);

    // 从 description 中提取节次: "⏰ 第X节" → X
    const periodMatch = task.description?.match(/第(\d+)节/);
    const startPeriod = periodMatch ? parseInt(periodMatch[1], 10) : 1;

    result[dow].push({
      ...task,
      dateStr: taskDate,
      startPeriod,
    });
  }

  // 每组按优先级降序排列（高优先级在前）
  for (let d = 1; d <= 7; d++) {
    result[d].sort((a, b) => b.priority - a.priority);
  }

  return result;
}

// ============================================================
// 日期工具（与 gridStore 保持一致）
// ============================================================

/**
 * 根据教学周序号计算该周的日期范围
 * @returns [mondayStr, sundayStr] 格式 YYYY-MM-DD
 */
function getWeekDateRange(
  weekNumber: number,
  semesterStartDate: string,
): [string, string] {
  const monday = normalizeToMonday(semesterStartDate);
  monday.setDate(monday.getDate() + (weekNumber - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return [formatDate(monday), formatDate(sunday)];
}

function normalizeToMonday(dateStr: string): Date {
  const d = parseDateStringLocal(dateStr);
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO 日期字符串 → dayOfWeek (1=周一, 7=周日) */
function isoToDayOfWeek(isoDate: string): number {
  const d = parseDateStringLocal(isoDate);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return day === 0 ? 7 : day;
}

function parseDateStringLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.substring(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}
