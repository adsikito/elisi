/**
 * MyBrain — 数据库查询层
 *
 * 核心设计：
 *   - 所有查询方法返回强类型结果
 *   - 课表查询使用 SQLite 位运算（&）实现 O(1) 周次过滤
 *   - 批量操作使用事务保证原子性
 *   - 错误统一包装为 DatabaseError 便于上层处理
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase, generateId } from './database';
import type {
  CourseRow,
  CourseScheduleRow,
  TaskNodeRow,
  TaskStatus,
} from './schema';
import {
  buildWeeksMask,
  buildWeekRangeMask,
} from './schema';

// ============================================================
// 自定义错误类型
// ============================================================

/** 数据库操作错误，携带操作上下文 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: unknown,
  ) {
    super(`[DB:${operation}] ${message}`);
    this.name = 'DatabaseError';
  }
}

// ============================================================
// 课程（courses）查询
// ============================================================

/** 创建课程的参数 */
export interface CreateCourseParams {
  name: string;
  color_index: number;
  classroom?: string;
  teacher?: string;
  start_week?: number;
  end_week?: number;
  note?: string;
}

/**
 * 创建课程及其时间安排（事务性）
 *
 * @param params 课程基本信息
 * @param schedules 时间安排列表（不含 id 和 course_id）
 * @returns 创建的课程 ID
 */
export async function createCourseWithSchedules(
  params: CreateCourseParams,
  schedules: Array<{
    day_of_week: number;
    start_period: number;
    end_period: number;
    weeks: number[] | { start: number; end: number };
  }>,
): Promise<string> {
  const db = await getDatabase();
  const courseId = generateId();
  const now = new Date().toISOString();

  try {
    await db.withTransactionAsync(async () => {
      // 1. 插入课程
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

      // 2. 插入时间安排
      for (const s of schedules) {
        const mask = Array.isArray(s.weeks)
          ? buildWeeksMask(s.weeks)
          : buildWeekRangeMask(s.weeks.start, s.weeks.end);

        await db.runAsync(
          `INSERT INTO course_schedules (id, course_id, day_of_week, start_period, end_period, weeks_mask)
           VALUES (?, ?, ?, ?, ?, ?)`,
          generateId(),
          courseId,
          s.day_of_week,
          s.start_period,
          s.end_period,
          mask,
        );
      }
    });
  } catch (error) {
    throw new DatabaseError(
      `创建课程失败: ${error instanceof Error ? error.message : String(error)}`,
      'createCourseWithSchedules',
      error,
    );
  }

  return courseId;
}

/**
 * 获取所有课程
 */
export async function getAllCourses(): Promise<CourseRow[]> {
  const db = await getDatabase();
  try {
    return await db.getAllAsync<CourseRow>(
      'SELECT * FROM courses ORDER BY created_at DESC',
    );
  } catch (error) {
    throw new DatabaseError('获取课程列表失败', 'getAllCourses', error);
  }
}

/**
 * 根据 ID 获取单个课程
 */
export async function getCourseById(id: string): Promise<CourseRow | null> {
  const db = await getDatabase();
  try {
    return await db.getFirstAsync<CourseRow>(
      'SELECT * FROM courses WHERE id = ?',
      id,
    );
  } catch (error) {
    throw new DatabaseError(`获取课程 ${id} 失败`, 'getCourseById', error);
  }
}

/**
 * 删除课程（级联删除关联的时间安排）
 */
export async function deleteCourse(id: string): Promise<void> {
  const db = await getDatabase();
  try {
    await db.runAsync('DELETE FROM courses WHERE id = ?', id);
  } catch (error) {
    throw new DatabaseError(`删除课程 ${id} 失败`, 'deleteCourse', error);
  }
}

// ============================================================
// 课表查询（核心热路径）
// ============================================================

/** 课表查询结果 — 展平的课程+时间安排联合视图 */
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

/**
 * 【核心查询】根据教学周获取课表
 *
 * 使用 SQLite 按位与运算 `weeks_mask & (1 << (weekNumber - 1))` 实现 O(1) 过滤。
 * 该操作在 SQLite 引擎层完成，仅返回匹配行，避免全表扫描到 JS 层再过滤。
 *
 * 性能目标：< 1ms（配合 idx_schedules_day 索引）
 *
 * @param weekNumber 教学周序号 (1-52)
 * @returns 该周的全部课程安排，按星期几 + 节次排序
 *
 * @example
 *   const week3 = await getSchedulesByWeek(3);
 *   // week3 包含所有第 3 周的课程安排
 */
export async function getSchedulesByWeek(
  weekNumber: number,
): Promise<ScheduleSlot[]> {
  if (weekNumber < 1 || weekNumber > 52) {
    throw new RangeError(`weekNumber 必须在 1-52 范围内，收到: ${weekNumber}`);
  }

  const db = await getDatabase();

  // 使用 BigInt 避免 32 位移位溢出
  const weekBit = Number(1n << BigInt(weekNumber - 1));

  try {
    return await db.getAllAsync<ScheduleSlot>(
      `SELECT
         cs.id            AS schedule_id,
         cs.course_id     AS course_id,
         c.name           AS course_name,
         c.color_index    AS color_index,
         c.classroom      AS classroom,
         c.teacher        AS teacher,
         cs.day_of_week   AS day_of_week,
         cs.start_period  AS start_period,
         cs.end_period    AS end_period,
         cs.weeks_mask    AS weeks_mask
       FROM course_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE (cs.weeks_mask & ?) > 0
       ORDER BY cs.day_of_week ASC, cs.start_period ASC`,
      weekBit,
    );
  } catch (error) {
    throw new DatabaseError(
      `查询第 ${weekNumber} 周课表失败`,
      'getSchedulesByWeek',
      error,
    );
  }
}

/**
 * 批量预加载多个周的课表（首页滑动预加载优化）
 *
 * 使用 OR 合并多个位掩码，一次查询获取多周数据。
 * 调用方按 weekNumber 分组即可。
 *
 * @param weekNumbers 需要加载的周次数组
 * @returns 全部匹配的课程安排
 */
export async function getSchedulesByWeeks(
  weekNumbers: number[],
): Promise<ScheduleSlot[]> {
  if (weekNumbers.length === 0) return [];

  for (const w of weekNumbers) {
    if (w < 1 || w > 52) {
      throw new RangeError(`weekNumber 必须在 1-52 范围内，收到: ${w}`);
    }
  }

  const db = await getDatabase();

  // 合并所有周的位掩码（BigInt 避免溢出）
  let combinedMask = 0n;
  for (const w of weekNumbers) {
    combinedMask |= 1n << BigInt(w - 1);
  }

  try {
    return await db.getAllAsync<ScheduleSlot>(
      `SELECT
         cs.id            AS schedule_id,
         cs.course_id     AS course_id,
         c.name           AS course_name,
         c.color_index    AS color_index,
         c.classroom      AS classroom,
         c.teacher        AS teacher,
         cs.day_of_week   AS day_of_week,
         cs.start_period  AS start_period,
         cs.end_period    AS end_period,
         cs.weeks_mask    AS weeks_mask
       FROM course_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE (cs.weeks_mask & ?) > 0
       ORDER BY cs.day_of_week ASC, cs.start_period ASC`,
      Number(combinedMask),
    );
  } catch (error) {
    throw new DatabaseError(
      `批量查询课表失败: 周次 [${weekNumbers.join(',')}]`,
      'getSchedulesByWeeks',
      error,
    );
  }
}

// ============================================================
// 任务树（task_nodes）查询
// ============================================================

/** 创建任务的参数 */
export interface CreateTaskParams {
  parent_id?: string | null;
  course_id?: string | null;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  due_date?: string | null;
}

/**
 * 创建任务节点
 */
export async function createTask(params: CreateTaskParams): Promise<string> {
  const db = await getDatabase();
  const id = generateId();
  const now = new Date().toISOString();

  try {
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
  } catch (error) {
    throw new DatabaseError(
      `创建任务失败: ${error instanceof Error ? error.message : String(error)}`,
      'createTask',
      error,
    );
  }

  return id;
}

/**
 * 获取指定课程的所有任务（平铺）
 */
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
      `获取课程 ${courseId} 的任务失败`,
      'getTasksByCourseId',
      error,
    );
  }
}

/**
 * 获取顶层任务（parent_id IS NULL）及其直接子任务数量
 */
export async function getRootTasks(): Promise<
  (TaskNodeRow & { child_count: number })[]
> {
  const db = await getDatabase();
  try {
    return await db.getAllAsync<TaskNodeRow & { child_count: number }>(
      `SELECT t.*,
              (SELECT COUNT(*) FROM task_nodes WHERE parent_id = t.id) AS child_count
       FROM task_nodes t
       WHERE t.parent_id IS NULL
       ORDER BY t.priority DESC, t.created_at ASC`,
    );
  } catch (error) {
    throw new DatabaseError('获取顶层任务失败', 'getRootTasks', error);
  }
}

/**
 * 获取指定任务的所有子任务（递归一层）
 */
export async function getChildTasks(
  parentId: string,
): Promise<TaskNodeRow[]> {
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
      `获取子任务失败: parent_id=${parentId}`,
      'getChildTasks',
      error,
    );
  }
}

/**
 * 获取子任务并附带各自的直接子任务数量（用于展开时判断是否可继续展开）
 */
export async function getChildTasksWithCount(
  parentId: string,
): Promise<(TaskNodeRow & { child_count: number })[]> {
  const db = await getDatabase();
  try {
    return await db.getAllAsync<TaskNodeRow & { child_count: number }>(
      `SELECT t.*,
              (SELECT COUNT(*) FROM task_nodes WHERE parent_id = t.id) AS child_count
       FROM task_nodes t
       WHERE t.parent_id = ?
       ORDER BY t.priority DESC, t.created_at ASC`,
      parentId,
    );
  } catch (error) {
    throw new DatabaseError(
      `获取子任务(含数量)失败: parent_id=${parentId}`,
      'getChildTasksWithCount',
      error,
    );
  }
}

/**
 * 更新任务状态
 */
export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<void> {
  const db = await getDatabase();
  try {
    await db.runAsync(
      `UPDATE task_nodes
       SET status = ?, updated_at = datetime('now')
       WHERE id = ?`,
      status,
      id,
    );
  } catch (error) {
    throw new DatabaseError(
      `更新任务 ${id} 状态失败`,
      'updateTaskStatus',
      error,
    );
  }
}

/**
 * 删除任务（级联删除所有子任务）
 */
export async function deleteTask(id: string): Promise<void> {
  const db = await getDatabase();
  try {
    await db.runAsync('DELETE FROM task_nodes WHERE id = ?', id);
  } catch (error) {
    throw new DatabaseError(`删除任务 ${id} 失败`, 'deleteTask', error);
  }
}

// ============================================================
// 日期范围任务查询（软待办 — 课表网格用）
// ============================================================

/**
 * 获取 due_date 落在 [startDate, endDate] 区间内的所有任务
 *
 * 利用 idx_tasks_due_date 部分索引（WHERE due_date IS NOT NULL）实现快速范围扫描。
 * 字符串比较 YYYY-MM-DD 格式天然有序，等价于日期比较。
 *
 * @param startDate 起始日期 (YYYY-MM-DD)
 * @param endDate   结束日期 (YYYY-MM-DD)
 * @returns 匹配的任务列表，按 priority DESC, due_date ASC 排序
 */
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
      `查询日期范围任务失败: [${startDate}, ${endDate}]`,
      'getTasksByDateRange',
      error,
    );
  }
}

// ============================================================
// 统计查询
// ============================================================

/** 课程统计信息 */
export interface CourseStats {
  total: number;
  thisWeek: number;
}

/**
 * 获取课程统计
 */
export async function getCourseStats(
  currentWeek: number,
): Promise<CourseStats> {
  const db = await getDatabase();
  const weekBit = 1 << (currentWeek - 1);

  try {
    const [totalRow, weekRow] = await Promise.all([
      db.getFirstAsync<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM courses',
      ),
      db.getFirstAsync<{ cnt: number }>(
        `SELECT COUNT(DISTINCT cs.course_id) AS cnt
         FROM course_schedules cs
         WHERE cs.weeks_mask & ? > 0`,
        weekBit,
      ),
    ]);

    return {
      total: totalRow?.cnt ?? 0,
      thisWeek: weekRow?.cnt ?? 0,
    };
  } catch (error) {
    throw new DatabaseError('获取课程统计失败', 'getCourseStats', error);
  }
}
