import type { SQLiteDatabase } from 'expo-sqlite';
import { generateId, getDatabase, withImmediateTransaction } from './database';
import type {
  CourseRow,
  TaskNodeRow,
  TaskStatus,
} from './schema';
import { buildWeeksMask, buildWeekRangeMask } from './schema';

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
    return await withImmediateTransaction(db, () => action(db));
  } catch (error) {
    throw new DatabaseError(
      `${operation} failed: ${toDatabaseErrorMessage(error)}`,
      operation,
      error,
    );
  }
}

export async function insertCourse(params: CreateCourseParams): Promise<string> {
  const courseId = generateId();
  const now = new Date().toISOString();

  await runWrite('insertCourse', async (db) => {
    await db.runAsync(
      `INSERT INTO courses (id, name, color_index, classroom, teacher, start_week, end_week, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      courseId,
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
      `INSERT INTO courses (id, name, color_index, classroom, teacher, start_week, end_week, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      courseId,
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

export async function getAllCourses(): Promise<CourseRow[]> {
  const db = await getDatabase();
  try {
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

export interface ScheduleSlot {
  schedule_id: string;
  course_id: string;
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
): Promise<ScheduleSlot[]> {
  if (weekNumber < 1 || weekNumber > 52) {
    throw new RangeError(`weekNumber must be within 1-52: ${weekNumber}`);
  }

  const db = await getDatabase();
  const weekBit = Number(1n << BigInt(weekNumber - 1));

  try {
    return await db.getAllAsync<ScheduleSlot>(
      `SELECT
         cs.id           AS schedule_id,
         cs.course_id    AS course_id,
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
       ORDER BY cs.day_of_week ASC, cs.start_period ASC`,
      weekBit,
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

  try {
    return await db.getAllAsync<ScheduleSlot>(
      `SELECT
         cs.id           AS schedule_id,
         cs.course_id    AS course_id,
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
       ORDER BY cs.day_of_week ASC, cs.start_period ASC`,
      Number(combinedMask),
    );
  } catch (error) {
    throw new DatabaseError(
      `Failed to fetch schedules for weeks [${weekNumbers.join(', ')}]`,
      'getSchedulesByWeeks',
      error,
    );
  }
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

export async function getCourseStats(
  currentWeek: number,
): Promise<CourseStats> {
  if (currentWeek < 1 || currentWeek > 52) {
    throw new RangeError(`currentWeek must be within 1-52: ${currentWeek}`);
  }

  const db = await getDatabase();
  const weekBit = Number(1n << BigInt(currentWeek - 1));

  try {
    const [totalRow, weekRow] = await Promise.all([
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
