import { create } from 'zustand';
import type { TaskNodeRow } from '@/db';
import {
  getRootTasks,
  getChildTasksWithCount,
  createTask,
  updateTaskStatus,
} from '@/db';
import { streamTaskBreakdown } from '@/ai/ByokConnector';

/** 扁平化行 —— 注入 FlashList 的数据单元 */
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
  /** 树深度，根节点 = 0 */
  depth: number;
  /** 是否拥有子节点 */
  hasChildren: boolean;
  /** 是否正在异步加载子节点 */
  isLoading: boolean;
}

interface TaskState {
  /** 扁平化视图 —— FlashList 的 data */
  flatList: FlatRow[];
  /** 当前展开的父节点 id 集合 */
  expandedIds: Set<string>;
  /** 页面首次加载中 */
  isInitialLoading: boolean;
  /** AI 拆解进行中的任务 id 集合 */
  loadingIds: Record<string, boolean>;

  /** 加载根任务 */
  loadRootTasks: () => Promise<void>;
  /** 切换展开 / 折叠 */
  toggleExpand: (id: string) => Promise<void>;
  /** 切换任务完成状态 */
  toggleStatus: (id: string) => Promise<void>;
  /** AI 拆解任务 */
  decomposeTask: (id: string) => Promise<void>;
}

/** 从 TaskNodeRow + child_count 构造 FlatRow */
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

/** 收集指定节点下所有展开的后代 id（深度优先，用于折叠时批量移除） */
function collectDescendantIds(
  list: FlatRow[],
  parentId: string,
): string[] {
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
      // ── 折叠：移除所有后代行 ──
      newExpanded.delete(id);
      const descIds = collectDescendantIds(flatList, id);
      const removeSet = new Set(descIds);
      set({
        flatList: flatList.filter((r) => !removeSet.has(r.id)),
        expandedIds: newExpanded,
      });
      return;
    }

    // ── 展开：标记 loading → 异步拉取 → 插入 ──
    newExpanded.add(id);
    const idx = flatList.findIndex((r) => r.id === id);
    if (idx === -1) return;

    // 显示 loading 指示器
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
      // 出错时回滚 expanded 状态
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

    // 乐观更新
    const next = [...flatList];
    next[idx] = { ...current, status: nextStatus };
    set({ flatList: next });

    try {
      await updateTaskStatus(id, nextStatus);
    } catch {
      // 回滚
      const rollback = [...get().flatList];
      const ri = rollback.findIndex((r) => r.id === id);
      if (ri !== -1) {
        rollback[ri] = { ...rollback[ri], status: current.status };
        set({ flatList: rollback });
      }
    }
  },

  decomposeTask: async (id: string) => {
    const { flatList } = get();
    const idx = flatList.findIndex((r) => r.id === id);
    if (idx === -1) return;

    const taskTitle = flatList[idx].title;

    // 标记 loading
    set((s) => ({ loadingIds: { ...s.loadingIds, [id]: true } }));

    try {
      // 1. 调用 AI 分解任务
      const result = await streamTaskBreakdown(taskTitle);
      const subs = result.sub_tasks;
      if (!subs || subs.length === 0) return;

      // 2. 批量插入子任务到 SQLite
      const parentDepth = flatList[idx].depth;
      for (let i = 0; i < subs.length; i++) {
        await createTask({
          parent_id: id,
          title: subs[i].title,
          description: subs[i].description ?? null,
          priority: subs[i].priority ?? 1,
          status: 'pending',
        });
      }

      // 3. 从 DB 重新拉取该节点的子任务（获得真实 id 和 child_count）
      const children = await getChildTasksWithCount(id);
      const childRows = children.map((t) => toFlatRow(t, parentDepth + 1));

      // 4. 更新 flatList：标记父节点 hasChildren，插入子节点
      const latest = get().flatList;
      const i = latest.findIndex((r) => r.id === id);
      if (i === -1) return;

      const next = [...latest];
      next[i] = { ...next[i], hasChildren: true, isLoading: false };
      next.splice(i + 1, 0, ...childRows);

      // 5. 自动展开该节点，清除 loading
      const newExpanded = new Set(get().expandedIds);
      newExpanded.add(id);

      set({ flatList: next, expandedIds: newExpanded });
    } catch (error) {
      console.error(`[taskStore] AI 分解任务失败 (${id}):`, error);
      throw error;
    } finally {
      // 清除 loading
      set((s) => {
        const next = { ...s.loadingIds };
        delete next[id];
        return { loadingIds: next };
      });
    }
  },
}));
