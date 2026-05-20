export interface ScheduledSubTask {
  title: string;
  duration_minutes: number;
  target_date?: string;
  start_period?: number;
}

export interface TaskBreakdownResult {
  sub_tasks: ScheduledSubTask[];
}

export interface WeeklyFreeSlotsMap {
  week: number;
  date_range: {
    monday: string;
    sunday: string;
  };
  free_slots: Record<string, number[]>;
}
