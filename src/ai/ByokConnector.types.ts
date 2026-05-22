export interface ScheduledSubTask {
  title: string;
  duration_minutes: number;
  target_date?: string;
  start_period?: number;
}

export interface TaskBreakdownResult {
  sub_tasks: ScheduledSubTask[];
}

export type CopilotTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'cancelled'
  | 'all';

export type CopilotAction =
  | {
      type: 'create_task';
      title: string;
      due_date?: string | null;
      description?: string | null;
      start_period?: number;
      duration_minutes?: number;
      priority?: number;
    }
  | {
      type: 'move_tasks_by_date';
      from_date: string;
      to_date: string;
      status?: CopilotTaskStatus;
    };

export interface CopilotCommandContext {
  today: string;
  tomorrow: string;
  current_week: number;
}

export interface CopilotPlanResult {
  summary: string;
  actions: CopilotAction[];
}

export interface WeeklyFreeSlotsMap {
  week: number;
  date_range: {
    monday: string;
    sunday: string;
  };
  free_slots: Record<string, number[]>;
}
