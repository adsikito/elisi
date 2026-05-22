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
  TimeSlotRow,
  TaskNodeRow,
  TaskStatus,
  PreferenceRow,
} from './schema';
export {
  DEFAULT_TIMETABLE_ID,
  EXAM_TIMETABLE_ID,
  DEFAULT_TIME_SLOT_ROWS,
  buildWeeksMask,
  parseWeeksMask,
  buildWeekRangeMask,
} from './schema';

// 查询方法
export {
  DatabaseError,
  insertCourse,
  insertCourseSchedule,
  createCourseWithSchedules,
  getAllCourses,
  getCourseById,
  deleteCourse,
  deleteCourseSchedule,
  getTimeSlots,
  updateTimeSlot,
  getSchedulesByWeek,
  getSchedulesByWeeks,
  getLessons,
  createTask,
  getTasksByCourseId,
  getTasksByDateRange,
  getRootTasks,
  getChildTasks,
  getChildTasksWithCount,
  updateTaskStatus,
  moveTasksByDate,
  deleteTask,
  getCourseStats,
} from './queries';
export type {
  CreateCourseParams,
  InsertCourseScheduleParams,
  UpdateTimeSlotParams,
  CreateTaskParams,
  ScheduleSlot,
  CourseStats,
} from './queries';
