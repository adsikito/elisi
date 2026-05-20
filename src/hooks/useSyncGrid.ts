import { useEffect, useRef, useState } from 'react';
import { useGridStore, type CourseItem } from '../store/gridStore';
import { getSchedulesByWeek, type ScheduleSlot } from '../db/queries';

interface SyncState {
  isLoading: boolean;
  error: string | null;
}

/**
 * useSyncGrid — 监听 gridStore.currentWeek，自动从 SQLite 拉取对应周次课表。
 *
 * 设计要点：
 *   1. currentWeek 变化时触发异步查询，通过 cancelled flag 处理竞态。
 *   2. 查询结果映射为 CourseItem[] 后整体写入 gridStore.courses。
 *   3. 仅在 currentWeek 的引用真正变化时触发，避免无意义重跑。
 *   4. 返回 { isLoading, error } 供 UI 层使用。
 */
export function useSyncGrid(): SyncState {
  const currentWeek = useGridStore((s) => s.currentWeek);
  const setCourses = useGridStore((s) => s.setCourses);

  const [state, setState] = useState<SyncState>({ isLoading: false, error: null });

  // 用 ref 追踪最新一次请求，防止旧请求覆盖新数据
  const fetchIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const thisFetchId = ++fetchIdRef.current;

    setState({ isLoading: true, error: null });

    getSchedulesByWeek(currentWeek)
      .then((slots: ScheduleSlot[]) => {
        if (cancelled || thisFetchId !== fetchIdRef.current) return;

        const courses: CourseItem[] = slots.map(mapScheduleToCourseItem);
        setCourses(courses);
        setState({ isLoading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled || thisFetchId !== fetchIdRef.current) return;

        const message =
          err instanceof Error ? err.message : `加载第 ${currentWeek} 周课表失败`;
        setState({ isLoading: false, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [currentWeek, setCourses]);

  return state;
}

/** ScheduleSlot → CourseItem 映射 */
function mapScheduleToCourseItem(slot: ScheduleSlot): CourseItem {
  return {
    id: slot.schedule_id,
    name: slot.course_name,
    classroom: slot.classroom,
    teacher: slot.teacher,
    dayOfWeek: slot.day_of_week,
    startPeriod: slot.start_period,
    endPeriod: slot.end_period,
    colorIndex: slot.color_index,
  };
}
