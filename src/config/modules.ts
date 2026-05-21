export interface AppModuleDefinition {
  id: string;
  title: string;
  tabTitle: string;
  description: string;
  icon: string;
  route: string;
  accent: string;
  background: string;
  border: string;
}

export const DEFAULT_ACTIVE_MODULES = ['Tasks', 'Copilot'];

export const APP_MODULES: AppModuleDefinition[] = [
  {
    id: 'Tasks',
    title: '任务树',
    tabTitle: '任务',
    description: '多级待办、AI 拆解和拖拽优先级。',
    icon: 'checkbox-outline',
    route: 'tasks',
    accent: '#7A54B8',
    background: '#E7D8FF',
    border: '#D8C3FF',
  },
  {
    id: 'Copilot',
    title: 'AI 助手',
    tabTitle: '助手',
    description: '把模糊计划整理成可直接安排的建议。',
    icon: 'sparkles-outline',
    route: 'copilot',
    accent: '#2B7EA7',
    background: '#D7F1FF',
    border: '#BEE7FF',
  },
  {
    id: 'Habits',
    title: '习惯',
    tabTitle: '习惯',
    description: '记录学习打卡、复盘节奏和每日练习。',
    icon: 'repeat-outline',
    route: 'habits',
    accent: '#3A8E68',
    background: '#D9F8E8',
    border: '#BDEFD6',
  },
  {
    id: 'Expenses',
    title: '记账',
    tabTitle: '记账',
    description: '记录校园消费、周预算和小额流水。',
    icon: 'wallet-outline',
    route: 'expenses',
    accent: '#B86144',
    background: '#FFE3D8',
    border: '#FFD0BE',
  },
];

export function isModuleEnabled(activeModules: string[], moduleId: string): boolean {
  return activeModules.includes(moduleId);
}
