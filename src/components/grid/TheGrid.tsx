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
import {
  DEFAULT_TIME_SLOTS,
  TIMETABLE_OPTIONS,
  useGridStore,
} from '../../store/gridStore';
import { useSyncGrid } from '../../hooks/useSyncGrid';
import CourseBlock from './CourseBlock';
import TaskSlotBlock from './TaskSlotBlock';
import TapToCreateModal from './TapToCreateModal';
import ItemDetailModal from './ItemDetailModal';
import type { TaskNodeExtended } from '../../store/gridStore';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const BASE_PERIOD_MINUTES = 45;
const BASE_ROW_HEIGHT = 64;
const PIXELS_PER_MINUTE = BASE_ROW_HEIGHT / BASE_PERIOD_MINUTES;
const HEADER_HEIGHT = 44;
const TIME_COL_WIDTH = 48;
const SCREEN_WIDTH = Dimensions.get('window').width;
const COL_WIDTH = (SCREEN_WIDTH - TIME_COL_WIDTH) / 7;
const GRID_WIDTH = COL_WIDTH * 7;

interface PeriodTimeSlot {
  period: number;
  periodName?: string;
  startTime: string;
  endTime: string;
}

interface PeriodLayout extends PeriodTimeSlot {
  top: number;
  height: number;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
}

interface GridMetrics {
  slots: PeriodLayout[];
  layoutByPeriod: ReadonlyMap<number, PeriodLayout>;
  bodyHeight: number;
  dayStartMinutes: number;
  dayEndMinutes: number;
  totalMinutes: number;
}

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
  timetableBar: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: '#FAFAFA',
  },
  timetableControl: {
    minHeight: 46,
    borderRadius: 18,
    padding: 4,
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(123,79,157,0.18)',
    shadowColor: '#7B4F9D',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  timetableOption: {
    flex: 1,
    minHeight: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  timetableOptionPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  timetableOptionText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#9E8BAD',
    letterSpacing: 0,
  },
  timetableOptionTextActive: {
    color: '#FFFFFF',
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

function buildGridMetrics(timeSlots: PeriodTimeSlot[]): GridMetrics {
  const source = timeSlots.length > 0 ? timeSlots : DEFAULT_TIME_SLOTS;
  const sortedSlots = [...source]
    .map((slot) => ({
      ...slot,
      startTime: normalizeTime(slot.startTime) ?? slot.startTime,
      endTime: normalizeTime(slot.endTime) ?? slot.endTime,
    }))
    .sort((a, b) => a.period - b.period);

  const firstSlot = sortedSlots[0];
  const lastSlot = sortedSlots[sortedSlots.length - 1];
  const dayStartMinutes = firstSlot ? parseTimeToMinutes(firstSlot.startTime) : 0;
  let dayEndMinutes = lastSlot ? parseTimeToMinutes(lastSlot.endTime) : BASE_PERIOD_MINUTES;
  if (dayEndMinutes <= dayStartMinutes) {
    dayEndMinutes += 24 * 60;
  }

  const totalMinutes = Math.max(1, dayEndMinutes - dayStartMinutes);
  const bodyHeight = Math.round(totalMinutes * PIXELS_PER_MINUTE);
  const layoutByPeriod = new Map<number, PeriodLayout>();

  const slots = sortedSlots.map((slot) => {
    let startMinutes = parseTimeToMinutes(slot.startTime);
    if (startMinutes < dayStartMinutes) {
      startMinutes += 24 * 60;
    }

    let endMinutes = parseTimeToMinutes(slot.endTime);
    if (endMinutes <= startMinutes) {
      endMinutes += 24 * 60;
    }

    const durationMinutes = Math.max(1, endMinutes - startMinutes);
    const top = ((startMinutes - dayStartMinutes) / totalMinutes) * bodyHeight;
    const height = Math.max(
      StyleSheet.hairlineWidth,
      (durationMinutes / totalMinutes) * bodyHeight,
    );
    const layout: PeriodLayout = {
      ...slot,
      startMinutes,
      endMinutes,
      durationMinutes,
      top,
      height,
    };
    layoutByPeriod.set(slot.period, layout);
    return layout;
  });

  return {
    slots,
    layoutByPeriod,
    bodyHeight,
    dayStartMinutes,
    dayEndMinutes,
    totalMinutes,
  };
}

function getPeriodLayout(period: number, metrics: GridMetrics): PeriodLayout {
  return (
    metrics.layoutByPeriod.get(period) ??
    metrics.slots[0] ?? {
      period,
      startTime: '00:00',
      endTime: '00:45',
      startMinutes: 0,
      endMinutes: BASE_PERIOD_MINUTES,
      durationMinutes: BASE_PERIOD_MINUTES,
      top: 0,
      height: BASE_ROW_HEIGHT,
    }
  );
}

function getPeriodSpanLayout(
  startPeriod: number,
  endPeriod: number,
  metrics: GridMetrics,
): { top: number; height: number } {
  const start = Math.min(startPeriod, endPeriod);
  const end = Math.max(startPeriod, endPeriod);
  const startLayout = getPeriodLayout(start, metrics);
  const endLayout = getPeriodLayout(end, metrics);
  const bottom = Math.max(startLayout.top + startLayout.height, endLayout.top + endLayout.height);

  return {
    top: startLayout.top,
    height: Math.max(StyleSheet.hairlineWidth, bottom - startLayout.top),
  };
}

interface TimeColumnProps {
  slots: PeriodLayout[];
  bodyHeight: number;
}

const TimeColumn: React.FC<TimeColumnProps> = React.memo(({ slots, bodyHeight }) => (
  <View style={{ width: TIME_COL_WIDTH }}>
    <View style={{ height: HEADER_HEIGHT }} />
    <View style={{ height: bodyHeight, position: 'relative' }}>
      {slots.map((slot) => (
        <View
          key={slot.period}
          style={{
            position: 'absolute',
            top: slot.top,
            left: 0,
            right: 0,
            height: slot.height,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 2,
          }}
        >
          <Text style={{ fontSize: 10, color: '#999', fontWeight: '700' }}>
            {slot.periodName ?? slot.period}
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

interface GridGuidesProps {
  slots: PeriodLayout[];
  bodyHeight: number;
}

const GridGuides: React.FC<GridGuidesProps> = React.memo(({ slots, bodyHeight }) => {
  const horizontalLines = useMemo(() => {
    const lines = new Set<number>();
    slots.forEach((slot) => {
      lines.add(slot.top);
      lines.add(slot.top + slot.height);
    });
    return Array.from(lines).sort((a, b) => a - b);
  }, [slots]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: 8 }, (_, index) => (
        <View
          key={`v-${index}`}
          style={{
            position: 'absolute',
            left: index * COL_WIDTH,
            top: 0,
            bottom: 0,
            width: StyleSheet.hairlineWidth,
            backgroundColor: 'rgba(203,180,219,0.24)',
          }}
        />
      ))}
      {horizontalLines.map((top) => (
        <View
          key={`h-${top.toFixed(2)}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: clamp(top, 0, bodyHeight),
            height: StyleSheet.hairlineWidth,
            backgroundColor: 'rgba(203,180,219,0.34)',
          }}
        />
      ))}
    </View>
  );
});

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

const TimetableSwitcher: React.FC = React.memo(() => {
  const activeTimetableId = useGridStore((s) => s.activeTimetableId);
  const setActiveTimetableId = useGridStore((s) => s.setActiveTimetableId);

  return (
    <View style={styles.timetableBar}>
      <View style={styles.timetableControl}>
        {TIMETABLE_OPTIONS.map((option) => {
          const active = activeTimetableId === option.id;

          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setActiveTimetableId(option.id)}
              style={({ pressed }) => [
                styles.timetableOption,
                active ? { backgroundColor: option.accent } : null,
                pressed ? styles.timetableOptionPressed : null,
              ]}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                style={[
                  styles.timetableOptionText,
                  active ? styles.timetableOptionTextActive : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

const TheGrid: React.FC = () => {
  const { isLoading } = useSyncGrid();
  const timeSlots = useGridStore((s) => s.timeSlots);
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
      <TimetableSwitcher />

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
            <TimeColumn slots={metrics.slots} bodyHeight={metrics.bodyHeight} />

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

                <GridGuides slots={metrics.slots} bodyHeight={metrics.bodyHeight} />

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
                        zIndex: 20,
                        elevation: 4,
                      }}
                      pointerEvents="box-none"
                    >
                      {dayItems.map((task) => {
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
                              zIndex: 20,
                              elevation: 4,
                            }}
                          >
                            <TaskSlotBlock
                              task={task}
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
                    const spanCount = Math.max(1, course.endPeriod - course.startPeriod + 1);
                    const spanLayout = getPeriodSpanLayout(
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
                          top: spanLayout.top,
                          height: spanLayout.height,
                          zIndex: 10,
                        }}
                      >
                        <CourseBlock
                          id={course.id}
                          name={course.name}
                          classroom={course.classroom}
                          teacher={course.teacher}
                          dayOfWeek={course.dayOfWeek}
                          periodCount={spanCount}
                          colorIndex={course.colorIndex}
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
