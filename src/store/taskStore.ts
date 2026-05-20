import { create } from 'zustand';
import type { ScheduledSubTask } from '@/ai/ByokConnector';
import { streamTaskBreakdown } from '@/ai/ByokConnector';
import type { TaskNodeRow } from '@/db';
import {
  createTask,
  getChildTasksWithCount,
  getRootTasks,
  updateTaskStatus,
} from '@/db';
import { updateTaskPriority } from '../db/queries';
import { getSchedulesByWeek } from '../db/queries';
import { useGridStore } from '@/store/gridStore';

export interface FlatRow {
  id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: TaskNodeRow['status'];
  priority: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  depth: number;
  hasChildren: boolean;
  isLoading: boolean;
}

interface TaskState {
  flatList: FlatRow[];
  expandedIds: Set<string>;
  isInitialLoading: boolean;
  loadingIds: Record<string, boolean>;
  loadRootTasks: () => Promise<void>;
  toggleExpand: (id: string) => Promise<void>;
  toggleStatus: (id: string) => Promise<void>;
  reorderTasks: (
    draggedTaskId: string,
    targetIndex: number,
    flatListData: FlatRow[],
  ) => Promise<void>;
  decomposeTask: (id: string) => Promise<void>;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

function toFlatRow(
  task: TaskNodeRow & { child_count: number },
  depth: number,
): FlatRow {
  return {
    id: task.id,
    parent_id: task.parent_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    created_at: task.created_at,
    updated_at: task.updated_at,
    depth,
    hasChildren: task.child_count > 0,
    isLoading: false,
  };
}

function collectDescendantIds(list: FlatRow[], parentId: string): string[] {
  const ids: string[] = [];
  const parentIdx = list.findIndex((r) => r.id === parentId);
  if (parentIdx === -1) return ids;

  const parentDepth = list[parentIdx].depth;
  for (let i = parentIdx + 1; i < list.length; i++) {
    if (list[i].depth <= parentDepth) break;
    ids.push(list[i].id);
  }

  return ids;
}

function findSiblingByParent(
  list: FlatRow[],
  startIndex: number,
  step: -1 | 1,
  parentId: string | null,
  draggedTaskId: string,
): FlatRow | null {
  for (let i = startIndex; i >= 0 && i < list.length; i += step) {
    const candidate = list[i];
    if (candidate.id === draggedTaskId) continue;
    if (candidate.parent_id === parentId) return candidate;
  }

  return null;
}

function resolveReorderPriority(
  prevSibling: FlatRow | null,
  nextSibling: FlatRow | null,
  fallbackPriority: number,
): number {
  if (prevSibling && nextSibling) {
    return (prevSibling.priority + nextSibling.priority) / 2;
  }

  if (nextSibling) {
    return nextSibling.priority + 10;
  }

  if (prevSibling) {
    return prevSibling.priority - 10;
  }

  return fallbackPriority;
}

function formatPeriodRange(start: number, end: number): string {
  return start === end ? `第${start}节` : `第${start}-${end}节`;
}

async function generateFreeSlots(currentWeek: number): Promise<string> {
  const freeGrid: boolean[][] = Array.from({ length: 7 }, () => Array(12).fill(true));
  const courses = await getSchedulesByWeek(currentWeek);

  for (const course of courses) {
    const dayIdx = course.day_of_week - 1;
    if (dayIdx < 0 || dayIdx >= 7) continue;

    const start = Math.max(1, course.start_period);
    const end = Math.min(12, course.end_period);
    if (start > end) continue;

    for (let period = start; period <= end; period += 1) {
      freeGrid[dayIdx][period - 1] = false;
    }
  }

  const daySummaries: string[] = [];

  for (let dayIdx = 0; dayIdx < 7; dayIdx += 1) {
    const dayFreeSlots = freeGrid[dayIdx];
    const ranges: string[] = [];

    let rangeStart = -1;
    for (let period = 1; period <= 12; period += 1) {
      if (dayFreeSlots[period - 1]) {
        if (rangeStart === -1) {
          rangeStart = period;
        }
        continue;
      }

      if (rangeStart !== -1) {
        ranges.push(formatPeriodRange(rangeStart, period - 1));
        rangeStart = -1;
      }
    }

    if (rangeStart !== -1) {
      ranges.push(formatPeriodRange(rangeStart, 12));
    }

    if (ranges.length > 0) {
      daySummaries.push(`${WEEKDAY_LABELS[dayIdx]}空闲: ${ranges.join(', ')}`);
    }
  }

  return daySummaries.join('; ');
}

function buildTaskDescription(subTask: ScheduledSubTask): string {
  const parts: string[] = [];
  const scheduleParts: string[] = [];

  if (subTask.target_date) {
    scheduleParts.push(subTask.target_date);
  }
  if (typeof subTask.start_period === 'number') {
    scheduleParts.push(`第${subTask.start_period}节`);
  }

  if (scheduleParts.length > 0) {
    parts.push(`⏰ ${scheduleParts.join(' ')}`);
  }

  parts.push(`${subTask.duration_minutes}min`);
  return parts.join(' · ');
}

export const useTaskStore = create<TaskState>((set, get) => ({
  flatList: [],
  expandedIds: new Set<string>(),
  isInitialLoading: true,
  loadingIds: {},

  loadRootTasks: async () => {
    set({ isInitialLoading: true });
    try {
      const roots = await getRootTasks();
      const rows = roots.map((t) => toFlatRow(t, 0));
      set({ flatList: rows, isInitialLoading: false });
    } catch {
      set({ isInitialLoading: false });
    }
  },

  toggleExpand: async (id: string) => {
    const { flatList, expandedIds } = get();
    const newExpanded = new Set(expandedIds);

    if (expandedIds.has(id)) {
      newExpanded.delete(id);
      const descIds = collectDescendantIds(flatList, id);
      const removeSet = new Set(descIds);
      set({
        flatList: flatList.filter((r) => !removeSet.has(r.id)),
        expandedIds: newExpanded,
      });
      return;
    }

    newExpanded.add(id);
    const idx = flatList.findIndex((r) => r.id === id);
    if (idx === -1) return;

    const withLoading = [...flatList];
    withLoading[idx] = { ...withLoading[idx], isLoading: true };
    set({ flatList: withLoading, expandedIds: newExpanded });

    try {
      const depth = flatList[idx].depth + 1;
      const children = await getChildTasksWithCount(id);
      const childRows = children.map((t) => toFlatRow(t, depth));

      const latest = get().flatList;
      const i = latest.findIndex((r) => r.id === id);
      if (i === -1) return;

      const next = [...latest];
      next[i] = { ...next[i], isLoading: false };
      next.splice(i + 1, 0, ...childRows);
      set({ flatList: next });
    } catch {
      const rollback = new Set(get().expandedIds);
      rollback.delete(id);
      const latest = get().flatList;
      const i = latest.findIndex((r) => r.id === id);
      if (i !== -1) {
        const next = [...latest];
        next[i] = { ...next[i], isLoading: false };
        set({ flatList: next, expandedIds: rollback });
      } else {
        set({ expandedIds: rollback });
      }
    }
  },

  toggleStatus: async (id: string) => {
    const { flatList } = get();
    const idx = flatList.findIndex((r) => r.id === id);
    if (idx === -1) return;

    const current = flatList[idx];
    const nextStatus = current.status === 'done' ? 'pending' : 'done';

    const next = [...flatList];
    next[idx] = { ...current, status: nextStatus };
    set({ flatList: next });

    try {
      await updateTaskStatus(id, nextStatus);
    } catch {
      const rollback = [...get().flatList];
      const ri = rollback.findIndex((r) => r.id === id);
      if (ri !== -1) {
        rollback[ri] = { ...rollback[ri], status: current.status };
        set({ flatList: rollback });
      }
    }
  },

  reorderTasks: async (
    draggedTaskId: string,
    targetIndex: number,
    flatListData: FlatRow[],
  ) => {
    const currentFlatList = get().flatList;
    const movedIndex =
      flatListData[targetIndex]?.id === draggedTaskId
        ? targetIndex
        : flatListData.findIndex((row) => row.id === draggedTaskId);

    if (movedIndex === -1) return;

    const movedRow = flatListData[movedIndex];
    if (!movedRow) return;

    const prevSibling = findSiblingByParent(
      flatListData,
      movedIndex - 1,
      -1,
      movedRow.parent_id,
      draggedTaskId,
    );
    const nextSibling = findSiblingByParent(
      flatListData,
      movedIndex + 1,
      1,
      movedRow.parent_id,
      draggedTaskId,
    );

    const newPriority = resolveReorderPriority(
      prevSibling,
      nextSibling,
      movedRow.priority,
    );

    const optimisticList = flatListData.map((row, index) =>
      index === movedIndex ? { ...row, priority: newPriority } : row,
    );

    set({ flatList: optimisticList });

    try {
      await updateTaskPriority(draggedTaskId, newPriority);
    } catch (error) {
      set({ flatList: currentFlatList });
      console.error(`[taskStore] reorder failed (${draggedTaskId}):`, error);
    }
  },

  decomposeTask: async (id: string) => {
    const { flatList, loadingIds } = get();
    if (loadingIds[id]) return;

    const idx = flatList.findIndex((r) => r.id === id);
    if (idx === -1) return;

    const taskTitle = flatList[idx].title;
    const currentWeek = useGridStore.getState().currentWeek;

    set((s) => ({ loadingIds: { ...s.loadingIds, [id]: true } }));

    try {
      const freeSlotsStr = await generateFreeSlots(currentWeek);
      const result = await streamTaskBreakdown(taskTitle, freeSlotsStr);
      const subs = Array.isArray(result.sub_tasks) ? result.sub_tasks : [];
      if (subs.length === 0) return;

      for (const rawSubTask of subs) {
        const subTask = rawSubTask as ScheduledSubTask;
        const title = subTask.title.trim();
        if (!title) continue;

        await createTask({
          parent_id: id,
          title,
          description: buildTaskDescription(subTask),
          due_date: subTask.target_date ?? null,
          priority: 1,
          status: 'pending',
        });
      }

      useGridStore.getState().forceRefreshGrid();

      const latest = get().flatList;
      const parentIndex = latest.findIndex((r) => r.id === id);
      if (parentIndex === -1) return;

      const removeSet = new Set(collectDescendantIds(latest, id));
      const next = latest.filter((row) => !removeSet.has(row.id));
      const refreshedParentIndex = next.findIndex((r) => r.id === id);
      if (refreshedParentIndex === -1) return;

      const latestParent = next[refreshedParentIndex];
      const children = await getChildTasksWithCount(id);
      const childRows = children.map((t) => toFlatRow(t, latestParent.depth + 1));

      next[refreshedParentIndex] = {
        ...latestParent,
        hasChildren: true,
        isLoading: false,
      };
      next.splice(refreshedParentIndex + 1, 0, ...childRows);

      const newExpanded = new Set(get().expandedIds);
      newExpanded.add(id);

      set({ flatList: next, expandedIds: newExpanded });
    } catch (error) {
      console.error(`[taskStore] AI breakdown failed (${id}):`, error);
      throw error;
    } finally {
      set((s) => {
        const next = { ...s.loadingIds };
        delete next[id];
        return { loadingIds: next };
      });
    }
  },
}));
