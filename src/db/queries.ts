import type { SQLiteDatabase } from 'expo-sqlite';
import { generateId, getDatabase } from './database';
import type {
  CourseRow,
  TaskNodeRow,
  TaskStatus,
  TimeSlotRow,
} from './schema';
import {
  DEFAULT_TIMETABLE_ID,
  DEFAULT_TIME_SLOT_ROWS,
  buildWeeksMask,
  buildWeekRangeMask,
} from './schema';

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: unknown,
  ) {
    super(`[DB:${operation}] ${message}`);
    this.name = 'DatabaseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface CreateCourseParams {
  timetable_id?: string;
  name: string;
  color_index: number;
  classroom?: string;
  teacher?: string;
  start_week?: number;
  end_week?: number;
  note?: string;
}

export interface InsertCourseScheduleParams {
  course_id: string;
  day_of_week: number;
  start_period: number;
  end_period: number;
  start_week?: number;
  end_week?: number;
}

export interface TaskWithCountRow extends TaskNodeRow {
  child_count: number;
}

const TASK_CHILD_COUNT_JOIN = `
  LEFT JOIN (
    SELECT parent_id, COUNT(*) AS child_count
    FROM task_nodes
    GROUP BY parent_id
  ) child_counts ON child_counts.parent_id = t.id
`;

function toDatabaseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runWrite<T>(
  operation: string,
  action: (db: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const db = await getDatabase();

  try {
    await db.execAsync('BEGIN IMMEDIATE;');

    try {
      const result = await action(db);
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
  } catch (error) {
    throw new DatabaseError(
      `${operation} failed: ${toDatabaseErrorMessage(error)}`,
      operation,
      error,
    );
  }
}

function normalizeTimetableId(timetable_id?: string): string | null {
  const trimmed = timetable_id?.trim();
  return trimmed ? trimmed : null;
}

function getTimetableWhereClause(
  timetable_id?: string,
): { clause: string; params: string[] } {
  const normalized = normalizeTimetableId(timetable_id);
  if (!normalized) {
    return { clause: '', params: [] };
  }

  return {
    clause: ' AND c.timetable_id = ?',
    params: [normalized],
  };
}

export async function insertCourse(params: CreateCourseParams): Promise<string> {
  const courseId = generateId();
  const now = new Date().toISOString();

  await runWrite('insertCourse', async (db) => {
    await db.runAsync(
      `INSERT INTO courses (id, timetable_id, name, color_index, classroom, teacher, start_week, end_week, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      courseId,
      normalizeTimetableId(params.timetable_id) ?? DEFAULT_TIMETABLE_ID,
      params.name,
      params.color_index,
      params.classroom ?? '',
      params.teacher ?? '',
      params.start_week ?? 1,
      params.end_week ?? 16,
      params.note ?? null,
      now,
      now,
    );
  });

  return courseId;
}

export async function insertCourseSchedule(
  params: InsertCourseScheduleParams,
): Promise<string> {
  const scheduleId = generateId();
  const weeksMask = buildWeekRangeMask(
    params.start_week ?? 1,
    params.end_week ?? 16,
  );

  await runWrite('insertCourseSchedule', async (db) => {
    await db.runAsync(
      `INSERT INTO course_schedules (id, course_id, day_of_week, start_period, end_period, weeks_mask)
       VALUES (?, ?, ?, ?, ?, ?)`,
      scheduleId,
      params.course_id,
      params.day_of_week,
      params.start_period,
      params.end_period,
      weeksMask,
    );
  });

  return scheduleId;
}

export async function createCourseWithSchedules(
  params: CreateCourseParams,
  schedules: Array<{
    day_of_week: number;
    start_period: number;
    end_period: number;
    weeks: number[] | { start: number; end: number };
  }>,
): Promise<string> {
  const courseId = generateId();
  const now = new Date().toISOString();

  await runWrite('createCourseWithSchedules', async (db) => {
    await db.runAsync(
      `INSERT INTO courses (id, timetable_id, name, color_index, classroom, teacher, start_week, end_week, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      courseId,
      normalizeTimetableId(params.timetable_id) ?? DEFAULT_TIMETABLE_ID,
      params.name,
      params.color_index,
      params.classroom ?? '',
      params.teacher ?? '',
      params.start_week ?? 1,
      params.end_week ?? 16,
      params.note ?? null,
      now,
      now,
    );

    for (const schedule of schedules) {
      const mask = Array.isArray(schedule.weeks)
        ? buildWeeksMask(schedule.weeks)
        : buildWeekRangeMask(schedule.weeks.start, schedule.weeks.end);

      await db.runAsync(
        `INSERT INTO course_schedules (id, course_id, day_of_week, start_period, end_period, weeks_mask)
         VALUES (?, ?, ?, ?, ?, ?)`,
        generateId(),
        courseId,
        schedule.day_of_week,
        schedule.start_period,
        schedule.end_period,
        mask,
      );
    }
  });

  return courseId;
}

export async function getAllCourses(timetable_id?: string): Promise<CourseRow[]> {
  const db = await getDatabase();
  const timetableId = normalizeTimetableId(timetable_id);
  try {
    if (timetableId) {
      return await db.getAllAsync<CourseRow>(
        'SELECT * FROM courses WHERE timetable_id = ? ORDER BY created_at DESC',
        timetableId,
      );
    }

    return await db.getAllAsync<CourseRow>(
      'SELECT * FROM courses ORDER BY created_at DESC',
    );
  } catch (error) {
    throw new DatabaseError('Failed to fetch courses', 'getAllCourses', error);
  }
}

export async function getCourseById(id: string): Promise<CourseRow | null> {
  const db = await getDatabase();
  try {
    return await db.getFirstAsync<CourseRow>(
      'SELECT * FROM courses WHERE id = ?',
      id,
    );
  } catch (error) {
    throw new DatabaseError(
      `Failed to fetch course ${id}`,
      'getCourseById',
      error,
    );
  }
}

export async function deleteCourse(id: string): Promise<void> {
  await runWrite('deleteCourse', async (db) => {
    await db.runAsync('DELETE FROM courses WHERE id = ?', id);
  });
}

export async function deleteCourseSchedule(scheduleId: string): Promise<void> {
  await runWrite('deleteCourseSchedule', async (db) => {
    await db.runAsync('DELETE FROM course_schedules WHERE id = ?', scheduleId);
  });
}

export interface UpdateTimeSlotParams {
  period_name?: string;
  start_time?: string;
  end_time?: string;
}

export async function getTimeSlots(): Promise<TimeSlotRow[]> {
  const db = await getDatabase();

  try {
    let rows = await db.getAllAsync<TimeSlotRow>(
      'SELECT * FROM time_slots ORDER BY id ASC',
    );

    if (rows.length === 0) {
      await seedDefaultTimeSlots();
      rows = await db.getAllAsync<TimeSlotRow>(
        'SELECT * FROM time_slots ORDER BY id ASC',
      );
    }

    return rows;
  } catch (error) {
    throw new DatabaseError('Failed to fetch time slots', 'getTimeSlots', error);
  }
}

export async function updateTimeSlot(
  id: number,
  params: UpdateTimeSlotParams,
): Promise<void> {
  if (!Number.isInteger(id) || id < 1) {
    throw new RangeError(`time slot id must be a positive integer: ${id}`);
  }

  await runWrite('updateTimeSlot', async (db) => {
    const current = await db.getFirstAsync<TimeSlotRow>(
      'SELECT * FROM time_slots WHERE id = ?',
      id,
    );

    if (!current) {
      throw new Error(`time slot ${id} does not exist`);
    }

    const next: TimeSlotRow = {
      id,
      period_name: params.period_name?.trim() || current.period_name,
      start_time: params.start_time ?? current.start_time,
      end_time: params.end_time ?? current.end_time,
    };

    assertValidTimeRange(next.start_time, next.end_time);

    await db.runAsync(
      `UPDATE time_slots
       SET period_name = ?, start_time = ?, end_time = ?
       WHERE id = ?`,
      next.period_name,
      normalizeTime(next.start_time),
      normalizeTime(next.end_time),
      id,
    );
  });
}

async function seedDefaultTimeSlots(): Promise<void> {
  await runWrite('seedDefaultTimeSlots', async (db) => {
    for (const slot of DEFAULT_TIME_SLOT_ROWS) {
      await db.runAsync(
        `INSERT OR IGNORE INTO time_slots (id, period_name, start_time, end_time)
         VALUES (?, ?, ?, ?)`,
        slot.id,
        slot.period_name,
        slot.start_time,
        slot.end_time,
      );
    }
  });
}

function normalizeTime(value: string): string {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new RangeError(`Invalid time format: ${value}`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new RangeError(`Invalid time value: ${value}`);
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function assertValidTimeRange(startTime: string, endTime: string): void {
  const start = normalizeTime(startTime);
  const end = normalizeTime(endTime);
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (endMinutes <= startMinutes) {
    throw new RangeError(`time slot end must be after start: ${start}-${end}`);
  }
}

export interface ScheduleSlot {
  schedule_id: string;
  course_id: string;
  timetable_id: string;
  course_name: string;
  color_index: number;
  classroom: string;
  teacher: string;
  day_of_week: number;
  start_period: number;
  end_period: number;
  weeks_mask: number;
}

export async function getSchedulesByWeek(
  weekNumber: number,
  timetable_id?: string,
): Promise<ScheduleSlot[]> {
  if (weekNumber < 1 || weekNumber > 52) {
    throw new RangeError(`weekNumber must be within 1-52: ${weekNumber}`);
  }

  const db = await getDatabase();
  const weekBit = Number(1n << BigInt(weekNumber - 1));
  const timetableFilter = getTimetableWhereClause(timetable_id);

  try {
    return await db.getAllAsync<ScheduleSlot>(
      `SELECT
         cs.id           AS schedule_id,
         cs.course_id    AS course_id,
         c.timetable_id  AS timetable_id,
         c.name          AS course_name,
         c.color_index   AS color_index,
         c.classroom     AS classroom,
         c.teacher       AS teacher,
         cs.day_of_week  AS day_of_week,
         cs.start_period AS start_period,
         cs.end_period   AS end_period,
         cs.weeks_mask   AS weeks_mask
       FROM course_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE (cs.weeks_mask & ?) > 0
       ${timetableFilter.clause}
       ORDER BY cs.day_of_week ASC, cs.start_period ASC`,
      weekBit,
      ...timetableFilter.params,
    );
  } catch (error) {
    throw new DatabaseError(
      `Failed to fetch schedules for week ${weekNumber}`,
      'getSchedulesByWeek',
      error,
    );
  }
}

export async function getSchedulesByWeeks(
  weekNumbers: number[],
  timetable_id?: string,
): Promise<ScheduleSlot[]> {
  if (weekNumbers.length === 0) return [];

  for (const weekNumber of weekNumbers) {
    if (weekNumber < 1 || weekNumber > 52) {
      throw new RangeError(`weekNumber must be within 1-52: ${weekNumber}`);
    }
  }

  const db = await getDatabase();
  let combinedMask = 0n;
  for (const weekNumber of weekNumbers) {
    combinedMask |= 1n << BigInt(weekNumber - 1);
  }
  const timetableFilter = getTimetableWhereClause(timetable_id);

  try {
    return await db.getAllAsync<ScheduleSlot>(
      `SELECT
         cs.id           AS schedule_id,
         cs.course_id    AS course_id,
         c.timetable_id  AS timetable_id,
         c.name          AS course_name,
         c.color_index   AS color_index,
         c.classroom     AS classroom,
         c.teacher       AS teacher,
         cs.day_of_week  AS day_of_week,
         cs.start_period AS start_period,
         cs.end_period   AS end_period,
         cs.weeks_mask   AS weeks_mask
       FROM course_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE (cs.weeks_mask & ?) > 0
       ${timetableFilter.clause}
       ORDER BY cs.day_of_week ASC, cs.start_period ASC`,
      Number(combinedMask),
      ...timetableFilter.params,
    );
  } catch (error) {
    throw new DatabaseError(
      `Failed to fetch schedules for weeks [${weekNumbers.join(', ')}]`,
      'getSchedulesByWeeks',
      error,
    );
  }
}

export async function getLessons(
  weekNumber: number,
  timetable_id?: string,
): Promise<ScheduleSlot[]> {
  return getSchedulesByWeek(weekNumber, timetable_id);
}

export interface CreateTaskParams {
  parent_id?: string | null;
  course_id?: string | null;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  due_date?: string | null;
}

export async function createTask(params: CreateTaskParams): Promise<string> {
  const id = generateId();
  const now = new Date().toISOString();

  await runWrite('createTask', async (db) => {
    await db.runAsync(
      `INSERT INTO task_nodes (id, parent_id, course_id, title, description, status, priority, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      params.parent_id ?? null,
      params.course_id ?? null,
      params.title,
      params.description ?? null,
      params.status ?? 'pending',
      params.priority ?? 1,
      params.due_date ?? null,
      now,
      now,
    );
  });

  return id;
}

export async function getTasksByCourseId(
  courseId: string,
): Promise<TaskNodeRow[]> {
  const db = await getDatabase();
  try {
    return await db.getAllAsync<TaskNodeRow>(
      `SELECT * FROM task_nodes
       WHERE course_id = ?
       ORDER BY priority DESC, created_at ASC`,
      courseId,
    );
  } catch (error) {
    throw new DatabaseError(
      `Failed to fetch tasks for course ${courseId}`,
      'getTasksByCourseId',
      error,
    );
  }
}

export async function getRootTasks(): Promise<TaskWithCountRow[]> {
  const db = await getDatabase();
  try {
    return await db.getAllAsync<TaskWithCountRow>(
      `SELECT t.*,
              COALESCE(child_counts.child_count, 0) AS child_count
       FROM task_nodes t
       ${TASK_CHILD_COUNT_JOIN}
       WHERE t.parent_id IS NULL
       ORDER BY t.priority DESC, t.created_at ASC`,
    );
  } catch (error) {
    throw new DatabaseError('Failed to fetch root tasks', 'getRootTasks', error);
  }
}

export async function getChildTasks(parentId: string): Promise<TaskNodeRow[]> {
  const db = await getDatabase();
  try {
    return await db.getAllAsync<TaskNodeRow>(
      `SELECT * FROM task_nodes
       WHERE parent_id = ?
       ORDER BY priority DESC, created_at ASC`,
      parentId,
    );
  } catch (error) {
    throw new DatabaseError(
      `Failed to fetch child tasks for parent_id=${parentId}`,
      'getChildTasks',
      error,
    );
  }
}

export async function getChildTasksWithCount(
  parentId: string,
): Promise<TaskWithCountRow[]> {
  const db = await getDatabase();
  try {
    return await db.getAllAsync<TaskWithCountRow>(
      `SELECT t.*,
              COALESCE(child_counts.child_count, 0) AS child_count
       FROM task_nodes t
       ${TASK_CHILD_COUNT_JOIN}
       WHERE t.parent_id = ?
       ORDER BY t.priority DESC, t.created_at ASC`,
      parentId,
    );
  } catch (error) {
    throw new DatabaseError(
      `Failed to fetch child tasks with count for parent_id=${parentId}`,
      'getChildTasksWithCount',
      error,
    );
  }
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<void> {
  await runWrite('updateTaskStatus', async (db) => {
    await db.runAsync(
      `UPDATE task_nodes
       SET status = ?, updated_at = datetime('now')
       WHERE id = ?`,
      status,
      id,
    );
  });
}

export async function updateTaskPriority(
  id: string,
  newPriority: number,
): Promise<void> {
  await runWrite('updateTaskPriority', async (db) => {
    await db.runAsync(
      `UPDATE task_nodes
       SET priority = ?, updated_at = datetime('now')
       WHERE id = ?`,
      newPriority,
      id,
    );
  });
}

export async function deleteTask(id: string): Promise<void> {
  await runWrite('deleteTask', async (db) => {
    await db.runAsync('DELETE FROM task_nodes WHERE id = ?', id);
  });
}

export interface CourseStats {
  total: number;
  thisWeek: number;
}

export async function getTasksByDateRange(
  startDate: string,
  endDate: string,
): Promise<TaskNodeRow[]> {
  const db = await getDatabase();
  try {
    return await db.getAllAsync<TaskNodeRow>(
      `SELECT * FROM task_nodes
       WHERE due_date IS NOT NULL
         AND due_date >= ?
         AND due_date <= ?
       ORDER BY priority DESC, due_date ASC`,
      startDate,
      endDate,
    );
  } catch (error) {
    throw new DatabaseError(
      `Failed to fetch tasks in range [${startDate}, ${endDate}]`,
      'getTasksByDateRange',
      error,
    );
  }
}

function assertISODate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${label} must use YYYY-MM-DD format: ${value}`);
  }
}

export async function moveTasksByDate(
  fromDate: string,
  toDate: string,
): Promise<number> {
  assertISODate(fromDate, 'fromDate');
  assertISODate(toDate, 'toDate');

  return runWrite('moveTasksByDate', async (db) => {
    const result = await db.runAsync(
      `UPDATE task_nodes
       SET due_date = ?, updated_at = datetime('now')
       WHERE due_date IS NOT NULL
         AND substr(due_date, 1, 10) = ?
         AND status NOT IN ('done', 'cancelled')`,
      toDate,
      fromDate,
    );

    return result.changes ?? 0;
  });
}

export async function getCourseStats(
  currentWeek: number,
  timetable_id?: string,
): Promise<CourseStats> {
  if (currentWeek < 1 || currentWeek > 52) {
    throw new RangeError(`currentWeek must be within 1-52: ${currentWeek}`);
  }

  const db = await getDatabase();
  const weekBit = Number(1n << BigInt(currentWeek - 1));
  const timetableId = normalizeTimetableId(timetable_id);

  try {
    const [totalRow, weekRow] = timetableId
      ? await Promise.all([
          db.getFirstAsync<{ cnt: number }>(
            'SELECT COUNT(*) AS cnt FROM courses WHERE timetable_id = ?',
            timetableId,
          ),
          db.getFirstAsync<{ cnt: number }>(
            `SELECT COUNT(DISTINCT cs.course_id) AS cnt
             FROM course_schedules cs
             JOIN courses c ON c.id = cs.course_id
             WHERE (cs.weeks_mask & ?) > 0
               AND c.timetable_id = ?`,
            weekBit,
            timetableId,
          ),
        ])
      : await Promise.all([
          db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM courses'),
          db.getFirstAsync<{ cnt: number }>(
            `SELECT COUNT(DISTINCT cs.course_id) AS cnt
             FROM course_schedules cs
             WHERE (cs.weeks_mask & ?) > 0`,
            weekBit,
          ),
        ]);

    return {
      total: totalRow?.cnt ?? 0,
      thisWeek: weekRow?.cnt ?? 0,
    };
  } catch (error) {
    throw new DatabaseError(
      'Failed to fetch course stats',
      'getCourseStats',
      error,
    );
  }
}
