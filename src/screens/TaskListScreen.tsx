import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import {
  ActivityIndicator,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  isAIConfigured,
  streamTaskBreakdown,
  type ScheduledSubTask,
} from '@/ai/ByokConnector';
import TaskItem from '@/components/tasks/TaskItem';
import { useGridStore } from '@/store/gridStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTaskStore, type FlatRow } from '@/store/taskStore';

const COLORS = {
  bg: '#F5F3FA',
  title: '#3D3D4E',
  sub: '#B0B0BE',
  accent: '#C1B3F0',
  accentStrong: '#8F73C8',
};

interface PeriodTimeSlot {
  period: number;
  startTime: string;
  endTime: string;
}

interface QuickAddDraft {
  title: string;
  dueDate: string | null;
  startPeriod: number | null;
}

const DEFAULT_TIME_SLOTS: PeriodTimeSlot[] = [
  { period: 1, startTime: '08:00', endTime: '08:45' },
  { period: 2, startTime: '08:55', endTime: '09:40' },
  { period: 3, startTime: '10:00', endTime: '10:45' },
  { period: 4, startTime: '10:55', endTime: '11:40' },
  { period: 5, startTime: '14:00', endTime: '14:45' },
  { period: 6, startTime: '14:55', endTime: '15:40' },
  { period: 7, startTime: '16:00', endTime: '16:45' },
  { period: 8, startTime: '16:55', endTime: '17:40' },
  { period: 9, startTime: '19:00', endTime: '19:45' },
  { period: 10, startTime: '19:55', endTime: '20:40' },
  { period: 11, startTime: '20:50', endTime: '21:35' },
  { period: 12, startTime: '21:45', endTime: '22:30' },
];

const WEEKDAY_INDEX: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeTimeSlots(raw: unknown): PeriodTimeSlot[] | null {
  const source =
    typeof raw === 'string'
      ? tryParseJSON(raw)
      : Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
          ? Object.values(raw as Record<string, unknown>)
          : null;

  if (!Array.isArray(source)) return null;

  const slots = source
    .map((item, index): PeriodTimeSlot | null => {
      if (Array.isArray(item)) {
        const startTime = normalizeTime(item[0]);
        const endTime = normalizeTime(item[1]);
        if (!startTime || !endTime) return null;
        return { period: index + 1, startTime, endTime };
      }

      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const startTime = normalizeTime(
        record.startTime ?? record.start_time ?? record.start ?? record.begin ?? record.from,
      );
      const endTime = normalizeTime(
        record.endTime ?? record.end_time ?? record.end ?? record.finish ?? record.to,
      );
      if (!startTime || !endTime) return null;

      const periodValue = Number(record.period ?? record.index ?? index + 1);
      return {
        period: Number.isInteger(periodValue) && periodValue > 0 ? periodValue : index + 1,
        startTime,
        endTime,
      };
    })
    .filter((slot): slot is PeriodTimeSlot => slot !== null)
    .sort((a, b) => a.period - b.period);

  return slots.length > 0 ? slots : null;
}

function readSettingsTimeSlots(state: unknown): PeriodTimeSlot[] {
  const record = state as Record<string, unknown>;
  return (
    normalizeTimeSlots(
      record.classTimeSlots ??
        record.courseTimeSlots ??
        record.scheduleTimeSlots ??
        record.periodTimeSlots ??
        record.classSchedule ??
        record.timeSlots,
    ) ?? DEFAULT_TIME_SLOTS
  );
}

function tryParseJSON(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseSlotTime(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDueDate(text: string): string | null {
  const today = new Date();
  if (/大后天/.test(text)) return formatDate(addDays(today, 3));
  if (/后天/.test(text)) return formatDate(addDays(today, 2));
  if (/明天/.test(text)) return formatDate(addDays(today, 1));
  if (/今天|今晚|今早|上午|下午|晚上/.test(text)) return formatDate(today);

  const fullDateMatch = text.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})[日号]?/);
  if (fullDateMatch) {
    const [, year, month, day] = fullDateMatch;
    return formatDate(new Date(Number(year), Number(month) - 1, Number(day)));
  }

  const monthDayMatch = text.match(/(?:^|[^\d])(\d{1,2})[月/-](\d{1,2})[日号]?/);
  if (monthDayMatch) {
    const [, month, day] = monthDayMatch;
    const candidate = new Date(today.getFullYear(), Number(month) - 1, Number(day));
    if (candidate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      candidate.setFullYear(candidate.getFullYear() + 1);
    }
    return formatDate(candidate);
  }

  const weekdayMatch = text.match(/(下周|这周|本周)?周([一二三四五六日天])/);
  if (weekdayMatch) {
    const [, prefix, dayText] = weekdayMatch;
    const target = WEEKDAY_INDEX[dayText];
    const current = today.getDay() === 0 ? 7 : today.getDay();
    let offset = target - current;

    if (prefix === '下周') {
      offset += 7;
    } else if (!prefix && offset < 0) {
      offset += 7;
    }

    return formatDate(addDays(today, offset));
  }

  return null;
}

function parseClockMinutes(text: string): number | null {
  const match = text.match(/(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:[:：点时](\d{1,2})?)?/);
  if (!match || !/[点时:：]/.test(match[0])) return null;

  const meridiem = match[1];
  let hour = Number(match[2]);
  const minute = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59) return null;

  if ((meridiem === '下午' || meridiem === '晚上') && hour < 12) {
    hour += 12;
  }
  if (meridiem === '中午' && hour < 11) {
    hour += 12;
  }
  if (meridiem === '凌晨' && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
}

function resolvePeriodFromClock(minutes: number | null, timeSlots: PeriodTimeSlot[]): number | null {
  if (minutes === null) return null;

  const exactSlot = timeSlots.find((slot) => {
    const start = parseSlotTime(slot.startTime);
    const end = parseSlotTime(slot.endTime);
    return minutes >= start - 5 && minutes <= end + 5;
  });
  if (exactSlot) return exactSlot.period;

  let nearest: { period: number; distance: number } | null = null;
  for (const slot of timeSlots) {
    const midpoint = (parseSlotTime(slot.startTime) + parseSlotTime(slot.endTime)) / 2;
    const distance = Math.abs(minutes - midpoint);
    if (!nearest || distance < nearest.distance) {
      nearest = { period: slot.period, distance };
    }
  }

  return nearest && nearest.distance <= 90 ? nearest.period : null;
}

function parseExplicitPeriod(text: string): number | null {
  const match = text.match(/第\s*(\d{1,2})\s*节/);
  if (!match) return null;
  const period = Number(match[1]);
  return Number.isInteger(period) && period >= 1 && period <= 12 ? period : null;
}

function stripScheduleWords(text: string): string {
  return text
    .replace(/(今天|今晚|今早|明天|后天|大后天)/g, '')
    .replace(/(下周|这周|本周)?周[一二三四五六日天]/g, '')
    .replace(/\d{4}[年/-]\d{1,2}[月/-]\d{1,2}[日号]?/g, '')
    .replace(/(^|[^\d])\d{1,2}[月/-]\d{1,2}[日号]?/g, '$1')
    .replace(/(凌晨|早上|上午|中午|下午|晚上)?\s*\d{1,2}(?:[:：点时]\d{0,2})?分?/g, '')
    .replace(/第\s*\d{1,2}\s*节/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLocalDraft(text: string, timeSlots: PeriodTimeSlot[]): QuickAddDraft {
  const dueDate = parseDueDate(text);
  const explicitPeriod = parseExplicitPeriod(text);
  const clockPeriod = resolvePeriodFromClock(parseClockMinutes(text), timeSlots);
  const startPeriod = explicitPeriod ?? clockPeriod;
  const title = startPeriod || dueDate ? stripScheduleWords(text) || text : text;

  return {
    title,
    dueDate,
    startPeriod,
  };
}

function mergeAIDraft(
  originalText: string,
  localDraft: QuickAddDraft,
  aiSubTask: ScheduledSubTask | null,
): QuickAddDraft {
  if (!aiSubTask) return localDraft;

  const aiTitle = aiSubTask.title?.trim();
  return {
    title:
      aiTitle && aiTitle.length <= originalText.length + 8
        ? aiTitle
        : localDraft.title,
    dueDate: aiSubTask.target_date ?? localDraft.dueDate,
    startPeriod:
      typeof aiSubTask.start_period === 'number'
        ? aiSubTask.start_period
        : localDraft.startPeriod,
  };
}

async function buildQuickAddDraft(
  text: string,
  timeSlots: PeriodTimeSlot[],
): Promise<QuickAddDraft> {
  const localDraft = buildLocalDraft(text, timeSlots);

  if (!isAIConfigured()) {
    return localDraft;
  }

  try {
    const result = await streamTaskBreakdown(text);
    const firstSubTask = Array.isArray(result.sub_tasks) ? result.sub_tasks[0] ?? null : null;
    return mergeAIDraft(text, localDraft, firstSubTask);
  } catch (error) {
    console.warn('[TaskListScreen] quick add NLP fallback:', error);
    return localDraft;
  }
}

function runAfterInteractionsAsync<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    InteractionManager.runAfterInteractions(() => {
      void work().then(resolve).catch(reject);
    });
  });
}

interface QuickAddInputProps {
  bottomInset: number;
  timeSlots: PeriodTimeSlot[];
}

const QuickAddInput: React.FC<QuickAddInputProps> = ({ bottomInset, timeSlots }) => {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = text.trim().length > 0 && !isSubmitting;

  const handleSubmitTask = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const draft = await buildQuickAddDraft(trimmed, timeSlots);
      const description = draft.startPeriod ? `第${draft.startPeriod}节` : undefined;

      await runAfterInteractionsAsync(async () => {
        await useTaskStore.getState().createTask({
          title: draft.title,
          description,
          due_date: draft.dueDate,
          parent_id: null,
          priority: 1,
          status: 'pending',
        });

        useGridStore.getState().forceRefreshGrid();
        setText('');
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, text, timeSlots]);

  return (
    <View style={[styles.inputDock, { paddingBottom: Math.max(bottomInset, 10) }]}>
      <View pointerEvents="none" style={styles.inputDockGlow}>
        <View style={styles.inputDockGlowFaint} />
        <View style={styles.inputDockGlowMid} />
        <View style={styles.inputDockGlowStrong} />
      </View>

      <View style={styles.composerBar}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="写下一个新任务..."
          placeholderTextColor="#B8A9C8"
          style={styles.composerInput}
          returnKeyType="send"
          enablesReturnKeyAutomatically
          autoCorrect={false}
          autoCapitalize="none"
          editable={!isSubmitting}
          onSubmitEditing={handleSubmitTask}
        />

        <Pressable
          onPress={handleSubmitTask}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ busy: isSubmitting, disabled: !canSubmit }}
          style={({ pressed }) => [
            styles.sendButton,
            !canSubmit ? styles.sendButtonDisabled : null,
            pressed && canSubmit ? styles.sendButtonPressed : null,
          ]}
        >
          <Text style={styles.sendButtonText}>➔</Text>
        </Pressable>
      </View>
    </View>
  );
};

const TaskListScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const timeSlots = useSettingsStore(readSettingsTimeSlots);

  const flatData = useTaskStore((s) => s.flatList);
  const isInitialLoading = useTaskStore((s) => s.isInitialLoading);
  const loadRootTasks = useTaskStore((s) => s.loadRootTasks);
  const toggleExpand = useTaskStore((s) => s.toggleExpand);
  const toggleStatus = useTaskStore((s) => s.toggleStatus);

  useEffect(() => {
    loadRootTasks();
  }, [loadRootTasks]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FlatRow>) => (
      <TaskItem
        row={item}
        drag={() => {}}
        isActive={false}
        onToggleExpand={toggleExpand}
        onToggleStatus={toggleStatus}
      />
    ),
    [toggleExpand, toggleStatus],
  );

  const keyExtractor = useCallback((item: FlatRow) => item.id, []);

  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      { paddingBottom: 116 + insets.bottom },
      flatData.length === 0 ? styles.listContentEmpty : null,
    ],
    [flatData.length, insets.bottom],
  );

  if (isInitialLoading) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>任务</Text>
          <Text style={styles.headerCount}>{flatData.length} 项</Text>
        </View>

        <FlashList
          data={flatData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={styles.list}
          contentContainerStyle={listContentStyle}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🚀</Text>
              <Text
                style={styles.emptyText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
              >
                太棒了！今天没有任何任务。点击下方极速创建...
              </Text>
            </View>
          }
        />

        <QuickAddInput bottomInset={insets.bottom} timeSlots={timeSlots} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default TaskListScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.title,
    letterSpacing: 0,
  },
  headerCount: {
    fontSize: 13,
    color: COLORS.sub,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 48,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.sub,
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 0,
  },
  inputDock: {
    paddingHorizontal: 16,
    paddingTop: 18,
    backgroundColor: 'rgba(245,243,250,0.96)',
  },
  inputDockGlow: {
    position: 'absolute',
    top: -40,
    left: 0,
    right: 0,
    height: 58,
    overflow: 'hidden',
  },
  inputDockGlowFaint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 58,
    backgroundColor: 'rgba(193,179,240,0.04)',
  },
  inputDockGlowMid: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 38,
    backgroundColor: 'rgba(207,195,237,0.10)',
  },
  inputDockGlowStrong: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 18,
    backgroundColor: 'rgba(245,243,250,0.92)',
  },
  composerBar: {
    minHeight: 56,
    borderRadius: 18,
    paddingLeft: 16,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFDFE',
    borderWidth: 1,
    borderColor: '#E7DDF4',
    shadowColor: '#8E7AA6',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  composerInput: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
    paddingRight: 12,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.title,
    letterSpacing: 0,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentStrong,
    shadowColor: '#8A73B4',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  sendButtonPressed: {
    transform: [{ translateY: 1 }],
    opacity: 0.9,
  },
  sendButtonDisabled: {
    backgroundColor: '#D8D0E7',
    shadowOpacity: 0.08,
  },
  sendButtonText: {
    color: '#FFFDFE',
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '800',
  },
});
