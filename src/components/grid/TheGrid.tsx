import React, { useCallback, useMemo } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSettingsStore } from '@/store/settingsStore';
import { useGridStore } from '../../store/gridStore';
import { useSyncGrid } from '../../hooks/useSyncGrid';
import CourseBlock from './CourseBlock';
import TaskSlotBlock from './TaskSlotBlock';
import TapToCreateModal from './TapToCreateModal';
import ItemDetailModal from './ItemDetailModal';
import type { TaskNodeExtended } from '../../store/gridStore';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const BASE_PERIOD_MINUTES = 45;
const BASE_ROW_HEIGHT = 64;
const MIN_ROW_HEIGHT = 52;
const MAX_ROW_HEIGHT = 88;
const HEADER_HEIGHT = 44;
const TIME_COL_WIDTH = 48;
const SCREEN_WIDTH = Dimensions.get('window').width;
const COL_WIDTH = (SCREEN_WIDTH - TIME_COL_WIDTH) / 7;
const GRID_WIDTH = COL_WIDTH * 7;

interface PeriodTimeSlot {
  period: number;
  startTime: string;
  endTime: string;
}

interface PeriodLayout extends PeriodTimeSlot {
  top: number;
  height: number;
  minutes: number;
}

interface GridMetrics {
  slots: PeriodLayout[];
  layoutByPeriod: ReadonlyMap<number, PeriodLayout>;
  bodyHeight: number;
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

const EMPTY_CELL_COLORS = [
  '#FFF5F7',
  '#F9F5FF',
  '#F0FFF7',
  '#FFFAF0',
  '#F0F8FF',
  '#FFFFF0',
  '#FFF0F5',
];

const styles = StyleSheet.create({
  importBar: {
    alignItems: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FAFAFA',
  },
  importButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(123,79,157,0.28)',
    backgroundColor: '#FFFFFF',
    shadowColor: '#7B4F9D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  importButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  importButtonDisabled: {
    backgroundColor: '#F8F2FB',
    borderColor: 'rgba(123,79,157,0.18)',
    opacity: 0.88,
  },
  importButtonText: {
    color: '#7B4F9D',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyWatermark: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 0,
  },
  emptyWatermarkText: {
    maxWidth: GRID_WIDTH - 32,
    color: '#B79CC9',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    opacity: 0.42,
    letterSpacing: 0,
  },
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTimeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function getSlotDurationMinutes(slot: PeriodTimeSlot): number {
  const start = parseTimeToMinutes(slot.startTime);
  const end = parseTimeToMinutes(slot.endTime);
  const duration = end >= start ? end - start : end + 24 * 60 - start;
  return Math.max(1, duration);
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

function tryParseJSON(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

function buildGridMetrics(timeSlots: PeriodTimeSlot[]): GridMetrics {
  let top = 0;
  const layoutByPeriod = new Map<number, PeriodLayout>();
  const slots = timeSlots.map((slot) => {
    const minutes = getSlotDurationMinutes(slot);
    const height = Math.round(
      clamp(
        (minutes / BASE_PERIOD_MINUTES) * BASE_ROW_HEIGHT,
        MIN_ROW_HEIGHT,
        MAX_ROW_HEIGHT,
      ),
    );
    const layout: PeriodLayout = {
      ...slot,
      minutes,
      top,
      height,
    };
    top += height;
    layoutByPeriod.set(slot.period, layout);
    return layout;
  });

  return {
    slots,
    layoutByPeriod,
    bodyHeight: top,
  };
}

function getPeriodLayout(period: number, metrics: GridMetrics): PeriodLayout {
  return (
    metrics.layoutByPeriod.get(period) ??
    metrics.slots[0] ?? {
      period,
      startTime: '00:00',
      endTime: '00:45',
      minutes: BASE_PERIOD_MINUTES,
      top: 0,
      height: BASE_ROW_HEIGHT,
    }
  );
}

function getPeriodSpanHeight(startPeriod: number, endPeriod: number, metrics: GridMetrics): number {
  const start = Math.min(startPeriod, endPeriod);
  const end = Math.max(startPeriod, endPeriod);
  const height = metrics.slots
    .filter((slot) => slot.period >= start && slot.period <= end)
    .reduce((sum, slot) => sum + slot.height, 0);

  if (height > 0) return height;
  return getPeriodLayout(startPeriod, metrics).height;
}

interface TimeColumnProps {
  slots: PeriodLayout[];
}

const TimeColumn: React.FC<TimeColumnProps> = React.memo(({ slots }) => (
  <View style={{ width: TIME_COL_WIDTH }}>
    <View style={{ height: HEADER_HEIGHT }} />
    {slots.map((slot) => (
      <View
        key={slot.period}
        style={{
          height: slot.height,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 2,
        }}
      >
        <Text style={{ fontSize: 10, color: '#999', fontWeight: '700' }}>
          {slot.period}
        </Text>
        <Text
          style={{ fontSize: 8, color: '#B0B0BE', marginTop: 1 }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
        >
          {slot.startTime}
        </Text>
        <Text
          style={{ fontSize: 8, color: '#C6C2CC' }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
        >
          {slot.endTime}
        </Text>
      </View>
    ))}
  </View>
));

const WeekdayHeader: React.FC = React.memo(() => (
  <View style={{ flexDirection: 'row' }}>
    {WEEKDAYS.map((day) => (
      <View
        key={day}
        style={{
          width: COL_WIDTH,
          height: HEADER_HEIGHT,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#555' }}>
          {day}
        </Text>
      </View>
    ))}
  </View>
));

interface GridCellProps {
  dayOfWeek: number;
  period: number;
  top: number;
  height: number;
  occupied: boolean;
}

const GridCell: React.FC<GridCellProps> = React.memo(
  ({ dayOfWeek, period, top, height, occupied }) => {
    const cellStyle = useMemo(
      () => ({
        position: 'absolute' as const,
        left: (dayOfWeek - 1) * COL_WIDTH,
        top,
        width: COL_WIDTH,
        height,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: occupied ? 'rgba(255,255,255,0.18)' : 'rgba(203,180,219,0.32)',
        backgroundColor: occupied
          ? 'transparent'
          : EMPTY_CELL_COLORS[(dayOfWeek - 1) % EMPTY_CELL_COLORS.length],
        opacity: occupied ? 0.06 : 0.78,
        overflow: 'hidden' as const,
      }),
      [dayOfWeek, height, occupied, top],
    );

    const handlePress = useCallback(() => {
      if (occupied) return;
      useGridStore.getState().openCreateModal(dayOfWeek, period);
    }, [dayOfWeek, period, occupied]);

    if (occupied) {
      return <View pointerEvents="none" style={cellStyle} />;
    }

    return (
      <Pressable
        accessibilityRole="button"
        android_ripple={{ color: 'rgba(123,79,157,0.10)' }}
        style={cellStyle}
        onPress={handlePress}
      />
    );
  },
);

const WeekSwitcher: React.FC = React.memo(() => {
  const currentWeek = useGridStore((s) => s.currentWeek);
  const setCurrentWeek = useGridStore((s) => s.setCurrentWeek);

  const handlePrev = useCallback(
    () => setCurrentWeek(Math.max(1, currentWeek - 1)),
    [currentWeek, setCurrentWeek],
  );

  const handleNext = useCallback(
    () => setCurrentWeek(currentWeek + 1),
    [currentWeek, setCurrentWeek],
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        backgroundColor: '#FAFAFA',
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
      }}
    >
      <Pressable
        onPress={handlePrev}
        hitSlop={12}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: '#F0F0F0',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 16, color: '#666', fontWeight: '700' }}>{'<'}</Text>
      </Pressable>

      <View
        style={{
          marginHorizontal: 20,
          paddingHorizontal: 16,
          paddingVertical: 4,
          backgroundColor: '#E2C2F0',
          borderRadius: 16,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#7B4F9D' }}>
          第{currentWeek}周
        </Text>
      </View>

      <Pressable
        onPress={handleNext}
        hitSlop={12}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: '#F0F0F0',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 16, color: '#666', fontWeight: '700' }}>{'>'}</Text>
      </Pressable>
    </View>
  );
});

const TheGrid: React.FC = () => {
  const { isLoading } = useSyncGrid();
  const timeSlots = useSettingsStore(readSettingsTimeSlots);
  const courses = useGridStore((s) => s.courses);
  const dayTasks = useGridStore((s) => s.dayTasks);
  const openDetailModal = useGridStore((s) => s.openDetailModal);
  const isImporting = useGridStore((s) => s.isImporting);

  const metrics = useMemo(() => buildGridMetrics(timeSlots), [timeSlots]);
  const loadingProgress = useSharedValue(0);

  React.useEffect(() => {
    loadingProgress.value = withTiming(isLoading ? 1 : 0, { duration: 250 });
  }, [isLoading, loadingProgress]);

  const gridAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - loadingProgress.value * 0.35,
  }));

  const occupiedMap = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (let d = 1; d <= 7; d += 1) map.set(d, new Set());
    courses.forEach((c) => {
      const set = map.get(c.dayOfWeek);
      if (set) {
        for (let p = c.startPeriod; p <= c.endPeriod; p += 1) {
          set.add(p);
        }
      }
    });
    return map;
  }, [courses]);

  const coursesByDay = useMemo(() => {
    const grouped = new Map<number, typeof courses>();
    for (let d = 1; d <= 7; d += 1) grouped.set(d, []);
    courses.forEach((c) => grouped.get(c.dayOfWeek)?.push(c));
    return grouped;
  }, [courses]);

  const tasksByDay = useMemo(() => {
    const grouped = new Map<number, TaskNodeExtended[]>();
    for (let d = 1; d <= 7; d += 1) grouped.set(d, dayTasks[d] ?? []);
    return grouped;
  }, [dayTasks]);

  const isWeekEmpty =
    courses.length === 0 && Object.values(dayTasks).every((items) => items.length === 0);

  const handleCoursePress = useCallback(
    (course: (typeof courses)[0]) => {
      openDetailModal({ type: 'course', item: course });
    },
    [openDetailModal],
  );

  const handleTaskPress = useCallback(
    (task: TaskNodeExtended) => {
      openDetailModal({ type: 'task', item: task });
    },
    [openDetailModal],
  );

  const handleImportPress = useCallback(async () => {
    if (isImporting) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (result.canceled) return;

      const uri = result.assets[0]?.uri;
      if (!uri) return;

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await useGridStore.getState().importSchedule(base64);
    } catch (error) {
      Alert.alert(
        '导入失败',
        (error as { message?: string } | undefined)?.message || '识别过程中发生未知错误。',
      );
    }
  }, [isImporting]);

  const scrollContentHeight = HEADER_HEIGHT + metrics.bodyHeight + 80;

  return (
    <View style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
      <WeekSwitcher />

      <View style={styles.importBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isImporting, busy: isImporting }}
          disabled={isImporting}
          onPress={handleImportPress}
          style={({ pressed }) => [
            styles.importButton,
            pressed && !isImporting ? styles.importButtonPressed : null,
            isImporting ? styles.importButtonDisabled : null,
          ]}
        >
          {isImporting ? <ActivityIndicator size="small" color="#7B4F9D" /> : null}
          <Text style={styles.importButtonText}>
            {isImporting ? '视觉引擎解析中...' : '智能导入课表'}
          </Text>
        </Pressable>
      </View>

      <Animated.View
        pointerEvents={isImporting ? 'none' : 'auto'}
        style={[{ flex: 1 }, gridAnimatedStyle]}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ minHeight: scrollContentHeight }}
          showsVerticalScrollIndicator={false}
          bounces
        >
          <View style={{ flexDirection: 'row' }}>
            <TimeColumn slots={metrics.slots} />

            <View>
              <WeekdayHeader />

              <View
                style={{
                  position: 'relative',
                  width: GRID_WIDTH,
                  height: metrics.bodyHeight,
                }}
              >
                {isWeekEmpty ? (
                  <View pointerEvents="none" style={styles.emptyWatermark}>
                    <Text style={styles.emptyWatermarkText}>
                      ☕ 享受本周的空白时光 / 或点击任意格子见缝插针
                    </Text>
                  </View>
                ) : null}

                {Array.from({ length: 7 }, (_, dayIndex) => dayIndex + 1).flatMap((day) =>
                  metrics.slots.map((slot) => {
                    const occupied = occupiedMap.get(day)?.has(slot.period) ?? false;
                    return (
                      <GridCell
                        key={`${day}-${slot.period}`}
                        dayOfWeek={day}
                        period={slot.period}
                        top={slot.top}
                        height={slot.height}
                        occupied={occupied}
                      />
                    );
                  }),
                )}

                {Array.from({ length: 7 }, (_, i) => i + 1).map((day) => {
                  const dayItems = tasksByDay.get(day) ?? [];
                  if (dayItems.length === 0) return null;
                  const leftOffset = (day - 1) * COL_WIDTH;

                  return (
                    <View
                      key={`tasks-${day}`}
                      style={{
                        position: 'absolute',
                        left: leftOffset,
                        width: COL_WIDTH,
                        top: 0,
                        bottom: 0,
                      }}
                      pointerEvents="box-none"
                    >
                      {dayItems.map((task, idx) => {
                        const periodLayout = getPeriodLayout(task.startPeriod || 1, metrics);
                        return (
                          <View
                            key={task.id}
                            pointerEvents="box-none"
                            style={{
                              position: 'absolute',
                              top: periodLayout.top,
                              left: 0,
                              right: 0,
                              height: periodLayout.height,
                            }}
                          >
                            <TaskSlotBlock
                              task={{ ...task, startPeriod: 1 }}
                              index={idx}
                              rowHeight={periodLayout.height}
                              onPress={() => handleTaskPress(task)}
                            />
                          </View>
                        );
                      })}
                    </View>
                  );
                })}

                {Array.from({ length: 7 }, (_, i) => i + 1).map((day) => {
                  const dayCourses = coursesByDay.get(day) ?? [];
                  const leftOffset = (day - 1) * COL_WIDTH;

                  return dayCourses.map((course) => {
                    const startLayout = getPeriodLayout(course.startPeriod, metrics);
                    const spanCount = Math.max(1, course.endPeriod - course.startPeriod + 1);
                    const spanHeight = getPeriodSpanHeight(
                      course.startPeriod,
                      course.endPeriod,
                      metrics,
                    );

                    return (
                      <View
                        key={course.id}
                        pointerEvents="box-none"
                        style={{
                          position: 'absolute',
                          left: leftOffset,
                          width: COL_WIDTH,
                          top: startLayout.top,
                          height: spanHeight,
                        }}
                      >
                        <CourseBlock
                          id={course.id}
                          name={course.name}
                          classroom={course.classroom}
                          teacher={course.teacher}
                          dayOfWeek={course.dayOfWeek}
                          startPeriod={1}
                          endPeriod={spanCount}
                          colorIndex={course.colorIndex}
                          rowHeight={spanHeight / spanCount}
                          headerHeight={0}
                          weekRange={course.weekRange}
                          onPress={() => handleCoursePress(course)}
                        />
                      </View>
                    );
                  });
                })}
              </View>
            </View>
          </View>
        </ScrollView>
      </Animated.View>

      <TapToCreateModal />
      <ItemDetailModal />
    </View>
  );
};

export default React.memo(TheGrid);
