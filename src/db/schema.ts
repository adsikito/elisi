/**
 * MyBrain — 本地数据库表结构定义
 *
 * 100% 离线优先，所有数据存储在本地 SQLite。
 * 使用 expo-sqlite 作为驱动，WAL 模式保证读写并发性能。
 *
 * 设计原则：
 *   - 所有时间以「教学周」为粒度，通过 weeks_mask 位图实现 O(1) 周次过滤
 *   - 任务树采用邻接表模型（parent_id），支持无限嵌套
 *   - 课程色板索引与 gridStore.ts / CourseBlock.tsx 的 MACARON_COLORS 对齐
 */

// ============================================================
// 1. 课程表（courses）
// ============================================================

/** 课程记录 — 对应 gridStore.ts 中的 CourseItem 持久化形态 */
export interface CourseRow {
  /** 主键，UUID v4 */
  id: string;
  /** 课程名称，如「高等数学」 */
  name: string;
  /** 马卡龙色板索引 (0-11)，与 MACARON_COLORS 对齐 */
  color_index: number;
  /** 教室 */
  classroom: string;
  /** 教师 */
  teacher: string;
  /** 教学起始周 */
  start_week: number;
  /** 教学结束周 */
  end_week: number;
  /** 备注（可选） */
  note: string | null;
  /** 创建时间，ISO 8601 */
  created_at: string;
  /** 更新时间，ISO 8601 */
  updated_at: string;
}

/** courses 表的 DDL */
export const CREATE_TABLE_COURSES = `
  CREATE TABLE IF NOT EXISTS courses (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL,
    color_index  INTEGER NOT NULL DEFAULT 0,
    classroom    TEXT NOT NULL DEFAULT '',
    teacher      TEXT NOT NULL DEFAULT '',
    start_week   INTEGER NOT NULL DEFAULT 1,
    end_week     INTEGER NOT NULL DEFAULT 16,
    note         TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// ============================================================
// 2. 课程时间安排（course_schedules）
// ============================================================

/**
 * 课程时间安排 — 一条记录 = 课程在一周内某个时间段的上课安排
 *
 * weeks_mask 位图设计（以 32 位 INTEGER 为例）：
 *   bit 0 (LSB) = 第 1 周，bit 1 = 第 2 周，… bit N = 第 N+1 周
 *   例：0b1010_0000_0000_0011 = 第 1、2、14、16 周上课
 *
 * 查询时使用 `weeks_mask & (1 << (weekNumber - 1))` 实现 O(1) 过滤。
 */
export interface CourseScheduleRow {
  /** 主键，UUID v4 */
  id: string;
  /** 外键 → courses.id */
  course_id: string;
  /** 星期几 (1=周一, 7=周日) */
  day_of_week: number;
  /** 开始节次 (1-12) */
  start_period: number;
  /** 结束节次 (1-12)，必须 >= start_period */
  end_period: number;
  /**
   * 周次位掩码 (INTEGER, 有符号 64 位)
   * 支持最多 52 周的教学安排
   * 示例：第 1-16 周 = 0xFFFF = 65535
   */
  weeks_mask: number;
}

/** course_schedules 表的 DDL */
export const CREATE_TABLE_COURSE_SCHEDULES = `
  CREATE TABLE IF NOT EXISTS course_schedules (
    id            TEXT PRIMARY KEY NOT NULL,
    course_id     TEXT NOT NULL,
    day_of_week   INTEGER NOT NULL CHECK(day_of_week BETWEEN 1 AND 7),
    start_period  INTEGER NOT NULL CHECK(start_period BETWEEN 1 AND 12),
    end_period    INTEGER NOT NULL CHECK(end_period BETWEEN 1 AND 12),
    weeks_mask    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    CHECK(end_period >= start_period)
  );
`;

/** 按 course_id 加速级联删除查询 */
export const CREATE_INDEX_SCHEDULES_COURSE_ID = `
  CREATE INDEX IF NOT EXISTS idx_schedules_course_id
    ON course_schedules(course_id);
`;

/** 按 day_of_week 加速按天查询（课表主界面热路径） */
export const CREATE_INDEX_SCHEDULES_DAY = `
  CREATE INDEX IF NOT EXISTS idx_schedules_day
    ON course_schedules(day_of_week);
`;

// ============================================================
// 3. 嵌套任务树（task_nodes）
// ============================================================

/** 任务节点状态 */
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

/** 任务节点 — 邻接表模型，支持无限嵌套 */
export interface TaskNodeRow {
  /** 主键，UUID v4 */
  id: string;
  /** 父任务 ID，null 表示顶层任务 */
  parent_id: string | null;
  /** 关联课程 ID（可选，用于「某课程的作业」） */
  course_id: string | null;
  /** 任务标题 */
  title: string;
  /** 任务描述 */
  description: string | null;
  /** 任务状态 */
  status: TaskStatus;
  /** 优先级 (0=低, 1=中, 2=高) */
  priority: number;
  /** 截止日期，ISO 8601 或 null */
  due_date: string | null;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/** task_nodes 表的 DDL */
export const CREATE_TABLE_TASK_NODES = `
  CREATE TABLE IF NOT EXISTS task_nodes (
    id           TEXT PRIMARY KEY NOT NULL,
    parent_id    TEXT,
    course_id    TEXT,
    title        TEXT NOT NULL,
    description  TEXT,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending', 'in_progress', 'done', 'cancelled')),
    priority     INTEGER NOT NULL DEFAULT 1 CHECK(priority BETWEEN 0 AND 2),
    due_date     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES task_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
  );
`;

/** 按 parent_id 加速子任务查询 */
export const CREATE_INDEX_TASKS_PARENT = `
  CREATE INDEX IF NOT EXISTS idx_tasks_parent_id
    ON task_nodes(parent_id);
`;

/** 按 status 加速任务看板查询 */
export const CREATE_INDEX_TASKS_STATUS = `
  CREATE INDEX IF NOT EXISTS idx_tasks_status
    ON task_nodes(status);
`;

/** 按 due_date 加速日历视图查询 */
export const CREATE_INDEX_TASKS_DUE = `
  CREATE INDEX IF NOT EXISTS idx_tasks_due_date
    ON task_nodes(due_date)
    WHERE due_date IS NOT NULL;
`;

// ============================================================
// 4. 应用偏好（preferences）— 轻量键值对，补充 MMKV
// ============================================================

/** 偏好设置行 */
export interface PreferenceRow {
  key: string;
  value: string;
  updated_at: string;
}

/** preferences 表的 DDL — 仅存储需要事务一致性的配置 */
export const CREATE_TABLE_PREFERENCES = `
  CREATE TABLE IF NOT EXISTS preferences (
    key         TEXT PRIMARY KEY NOT NULL,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// ============================================================
// 5. 全部建表语句聚合（按依赖顺序）
// ============================================================

/** 所有建表 DDL，按外键依赖顺序排列 */
export const ALL_CREATE_TABLES: readonly string[] = [
  CREATE_TABLE_COURSES,
  CREATE_TABLE_COURSE_SCHEDULES,
  CREATE_TABLE_TASK_NODES,
  CREATE_TABLE_PREFERENCES,
];

/** 所有索引 DDL */
export const ALL_CREATE_INDEXES: readonly string[] = [
  CREATE_INDEX_SCHEDULES_COURSE_ID,
  CREATE_INDEX_SCHEDULES_DAY,
  CREATE_INDEX_TASKS_PARENT,
  CREATE_INDEX_TASKS_STATUS,
  CREATE_INDEX_TASKS_DUE,
];

// ============================================================
// 6. 工具函数
// ============================================================

/**
 * 生成 weeks_mask 位掩码
 * 使用 BigInt 避免 32 位移位溢出（第 32+ 周）
 * 52 周位图最大为 2^52，在 Number 的 53 位安全范围内，安全转回 Number 给 SQLite
 *
 * @param weeks 周次数组，如 [1,2,3,5,7,9,11,13,15]
 * @returns 位掩码整数
 */
export function buildWeeksMask(weeks: number[]): number {
  let mask = 0n;
  for (const week of weeks) {
    if (week < 1 || week > 52) {
      throw new RangeError(`week 必须在 1-52 范围内，收到: ${week}`);
    }
    mask |= 1n << BigInt(week - 1);
  }
  return Number(mask);
}

/**
 * 解析 weeks_mask 为周次数组
 * @param mask 位掩码整数
 * @returns 周次数组（升序）
 */
export function parseWeeksMask(mask: number): number[] {
  const weeks: number[] = [];
  const bigMask = BigInt(Math.floor(mask));
  for (let i = 0n; i < 52n; i++) {
    if ((bigMask & (1n << i)) > 0n) {
      weeks.push(Number(i) + 1);
    }
  }
  return weeks;
}

/**
 * 生成连续周次范围的 weeks_mask
 * @param start 起始周
 * @param end 结束周
 * @returns 位掩码整数
 */
export function buildWeekRangeMask(start: number, end: number): number {
  if (start < 1 || end > 52 || start > end) {
    throw new RangeError(`无效周次范围: ${start}-${end}`);
  }
  let mask = 0n;
  for (let i = start; i <= end; i++) {
    mask |= 1n << BigInt(i - 1);
  }
  return Number(mask);
}
