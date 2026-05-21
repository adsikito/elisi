import { getDatabase, generateId } from './database';
import {
  DEFAULT_TIMETABLE_ID,
  EXAM_TIMETABLE_ID,
  buildWeekRangeMask,
  type TaskStatus,
} from './schema';

const COURSE_COUNT = 100;
const ROOT_TASK_COUNT = 50;
const TASK_COUNT = 300;
const COURSE_COLOR_COUNT = 12;
const FULL_SEMESTER_MASK = buildWeekRangeMask(1, 16);

const COURSE_TOPICS = [
  '数据结构',
  '操作系统',
  '数据库系统',
  '计算机网络',
  '软件工程',
  '人工智能',
  '机器学习',
  '编译原理',
  '信息安全',
  '离散数学',
  '线性代数',
  '高等数学',
];

const COURSE_SUFFIXES = [
  '基础',
  '进阶',
  '专题',
  '实验',
  '实训',
  '应用',
  '强化',
  '研讨',
];

const TEACHERS = [
  '张老师',
  '李老师',
  '王老师',
  '赵老师',
  '陈老师',
  '刘老师',
  '周老师',
  '吴老师',
];

const CLASSROOM_PREFIXES = ['A', 'B', 'C', 'D', 'E'];

const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'in_progress',
  'done',
  'cancelled',
];

interface NodeSeed {
  id: string;
  depth: number;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function pad(num: number): string {
  return String(num).padStart(3, '0');
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonday(date: Date): Date {
  const monday = new Date(date);
  const day = monday.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + offset);
  return monday;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildCourseName(index: number): string {
  const topic = COURSE_TOPICS[index % COURSE_TOPICS.length];
  const suffix = COURSE_SUFFIXES[(index * 3) % COURSE_SUFFIXES.length];
  return `${topic}${suffix}-${pad(index + 1)}`;
}

function buildClassroom(index: number): string {
  const block = pick(CLASSROOM_PREFIXES);
  const room = 100 + (index % 40) * 2 + randomInt(0, 1);
  return `${block}${room}`;
}

function buildRootTaskTitle(index: number): string {
  return `压力根节点-${pad(index + 1)}`;
}

function buildChildTaskTitle(index: number, depth: number): string {
  const tag = depth >= 10 ? '深链' : '子节点';
  return `压力${tag}-${pad(index + 1)}`;
}

function pickTaskTiming(referenceMonday: Date): {
  targetDate: string | null;
  startPeriod: number | null;
} {
  const roll = Math.random();
  const targetDate = formatLocalDate(addDays(referenceMonday, randomInt(0, 6)));

  if (roll < 0.5) {
    return {
      targetDate,
      startPeriod: randomInt(1, 12),
    };
  }

  if (roll < 0.75) {
    return {
      targetDate,
      startPeriod: null,
    };
  }

  if (roll < 0.9) {
    return {
      targetDate: null,
      startPeriod: randomInt(1, 12),
    };
  }

  return {
    targetDate: null,
    startPeriod: null,
  };
}

function buildTaskDescription(
  depth: number,
  targetDate: string | null,
  startPeriod: number | null,
): string {
  const parts = [`压力测试任务`, `深度 ${depth}`];
  if (targetDate) {
    parts.push(`目标 ${targetDate}`);
  }
  if (startPeriod !== null) {
    parts.push(`第${startPeriod}节`);
  }
  return parts.join(' · ');
}

function pickParent(
  pool: readonly NodeSeed[],
  roots: readonly NodeSeed[],
): NodeSeed {
  if (pool.length === 0) {
    throw new Error('Parent pool is empty.');
  }

  const roll = Math.random();
  if (roll < 0.25 && roots.length > 0) {
    return pick(roots);
  }

  if (roll < 0.65 && pool.length > 8) {
    return pool[randomInt(Math.max(0, pool.length - 12), pool.length - 1)];
  }

  return pick(pool);
}

export async function injectMockData(): Promise<void> {
  const db = await getDatabase();
  const courseIds: string[] = [];
  const roots: NodeSeed[] = [];
  const nodePool: NodeSeed[] = [];
  const referenceMonday = getMonday(new Date());
  const startedAt = Date.now();
  let timeTick = 0;

  const nextTimestamp = () =>
    new Date(startedAt + timeTick++ * 1000).toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM task_nodes');
    await db.runAsync('DELETE FROM course_schedules');
    await db.runAsync('DELETE FROM courses');

    for (let i = 0; i < COURSE_COUNT; i += 1) {
      const courseId = generateId();
      courseIds.push(courseId);
      const timetableId = i % 5 === 0 ? EXAM_TIMETABLE_ID : DEFAULT_TIMETABLE_ID;

      const createdAt = nextTimestamp();
      await db.runAsync(
        `INSERT INTO courses (
           id, timetable_id, name, color_index, classroom, teacher,
           start_week, end_week, note, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        courseId,
        timetableId,
        buildCourseName(i),
        randomInt(0, COURSE_COLOR_COUNT - 1),
        buildClassroom(i),
        pick(TEACHERS),
        1,
        16,
        i % 4 === 0 ? '用于 60fps 压力测试' : null,
        createdAt,
        createdAt,
      );

      const scheduleStartPeriod = randomInt(1, 12);
      const scheduleEndPeriod = Math.min(
        12,
        scheduleStartPeriod + randomInt(0, 2),
      );

      await db.runAsync(
        `INSERT INTO course_schedules (
           id, course_id, day_of_week, start_period, end_period, weeks_mask
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        generateId(),
        courseId,
        randomInt(1, 7),
        scheduleStartPeriod,
        scheduleEndPeriod,
        FULL_SEMESTER_MASK,
      );
    }

    for (let i = 0; i < ROOT_TASK_COUNT; i += 1) {
      const taskId = generateId();
      const { targetDate, startPeriod } = pickTaskTiming(referenceMonday);
      const createdAt = nextTimestamp();
      const courseId =
        Math.random() < 0.3 ? pick(courseIds) : null;

      await db.runAsync(
        `INSERT INTO task_nodes (
           id, parent_id, course_id, title, description, status,
           priority, due_date, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        taskId,
        null,
        courseId,
        buildRootTaskTitle(i),
        buildTaskDescription(0, targetDate, startPeriod),
        pick(TASK_STATUSES),
        1000 - i * 3,
        targetDate,
        createdAt,
        createdAt,
      );

      const seed = { id: taskId, depth: 0 };
      roots.push(seed);
      nodePool.push(seed);
    }

    const deepChains = [
      { rootIndex: 0, length: 18 },
      { rootIndex: 1, length: 12 },
      { rootIndex: 2, length: 8 },
    ];

    let childCount = 0;
    for (const chain of deepChains) {
      let parent = roots[chain.rootIndex];
      for (
        let step = 0;
        step < chain.length && childCount < TASK_COUNT - ROOT_TASK_COUNT;
        step += 1
      ) {
        const taskId = generateId();
        const depth = parent.depth + 1;
        const { targetDate, startPeriod } = pickTaskTiming(referenceMonday);
        const createdAt = nextTimestamp();
        const courseId =
          Math.random() < 0.35 ? pick(courseIds) : null;

        await db.runAsync(
          `INSERT INTO task_nodes (
             id, parent_id, course_id, title, description, status,
             priority, due_date, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          taskId,
          parent.id,
          courseId,
          buildChildTaskTitle(childCount, depth),
          buildTaskDescription(depth, targetDate, startPeriod),
          pick(TASK_STATUSES),
          randomInt(1, 900),
          targetDate,
          createdAt,
          createdAt,
        );

        parent = { id: taskId, depth };
        nodePool.push(parent);
        childCount += 1;
      }
    }

    while (childCount < TASK_COUNT - ROOT_TASK_COUNT) {
      const parent = pickParent(nodePool, roots);
      const depth = parent.depth + 1;
      const taskId = generateId();
      const { targetDate, startPeriod } = pickTaskTiming(referenceMonday);
      const createdAt = nextTimestamp();
      const courseId =
        Math.random() < 0.35 ? pick(courseIds) : null;

      await db.runAsync(
        `INSERT INTO task_nodes (
           id, parent_id, course_id, title, description, status,
           priority, due_date, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        taskId,
        parent.id,
        courseId,
        buildChildTaskTitle(childCount, depth),
        buildTaskDescription(depth, targetDate, startPeriod),
        pick(TASK_STATUSES),
        randomInt(1, 900),
        targetDate,
        createdAt,
        createdAt,
      );

      nodePool.push({ id: taskId, depth });
      childCount += 1;
    }
  });
}
