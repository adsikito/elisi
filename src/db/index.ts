/**
 * MyBrain — 数据库层 barrel export
 *
 * 用法：
 *   import { getDatabase, getSchedulesByWeek, buildWeeksMask } from '@/db';
 *   import { storage, getPreference, setPreference } from '@/db';
 */

// 数据库连接
export {
  getDatabase,
  closeDatabase,
  checkpoint,
  getDatabaseInfo,
  resetDatabase,
  generateId,
} from './database';

// 表结构 & 类型
export type {
  CourseRow,
  CourseScheduleRow,
  TaskNodeRow,
  TaskStatus,
  PreferenceRow,
} from './schema';
export {
  buildWeeksMask,
  parseWeeksMask,
  buildWeekRangeMask,
} from './schema';

// 查询方法
export {
  DatabaseError,
  createCourseWithSchedules,
  getAllCourses,
  getCourseById,
  deleteCourse,
  getSchedulesByWeek,
  getSchedulesByWeeks,
  createTask,
  getTasksByCourseId,
  getTasksByDateRange,
  getRootTasks,
  getChildTasks,
  getChildTasksWithCount,
  updateTaskStatus,
  deleteTask,
  getCourseStats,
} from './queries';
export type {
  CreateCourseParams,
  CreateTaskParams,
  ScheduleSlot,
  CourseStats,
} from './queries';
