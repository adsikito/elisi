import React, { useCallback, useMemo } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import {
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
import { useGridStore } from '../../store/gridStore';
import { useSyncGrid } from '../../hooks/useSyncGrid';
import CourseBlock from './CourseBlock';
import TaskSlotBlock from './TaskSlotBlock';
import TapToCreateModal from './TapToCreateModal';
import ItemDetailModal from './ItemDetailModal';
import type { TaskNodeExtended } from '../../store/gridStore';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TOTAL_PERIODS = 12;
const ROW_HEIGHT = 64;
const HEADER_HEIGHT = 44;
const TIME_COL_WIDTH = 48;
const SCREEN_WIDTH = Dimensions.get('window').width;
const COL_WIDTH = (SCREEN_WIDTH - TIME_COL_WIDTH) / 7;
const GRID_WIDTH = COL_WIDTH * 7;
const GRID_HEIGHT = ROW_HEIGHT * TOTAL_PERIODS;

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
});

const EMPTY_CELL_COLORS = [
  '#FFF5F7',
  '#F9F5FF',
  '#F0FFF7',
  '#FFFAF0',
  '#F0F8FF',
  '#FFFFF0',
  '#FFF0F5',
];

const TimeColumn: React.FC = React.memo(() => {
  const timeSlots = useGridStore((s) => s.timeSlots);

  return (
    <View style={{ width: TIME_COL_WIDTH }}>
      <View style={{ height: HEADER_HEIGHT }} />
      {timeSlots.map((slot) => (
        <View
          key={slot.period}
          style={{
            height: ROW_HEIGHT,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 10, color: '#999', fontWeight: '600' }}>
            {slot.period}
          </Text>
          <Text style={{ fontSize: 8, color: '#bbb', marginTop: 1 }}>
            {slot.startTime}
          </Text>
        </View>
      ))}
    </View>
  );
});

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
  occupied: boolean;
}

const GridCell: React.FC<GridCellProps> = React.memo(
  ({ dayOfWeek, period, occupied }) => {
    const cellStyle = useMemo(
      () => ({
        position: 'absolute' as const,
        left: (dayOfWeek - 1) * COL_WIDTH,
        top: (period - 1) * ROW_HEIGHT,
        width: COL_WIDTH,
        height: ROW_HEIGHT,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: occupied ? 'rgba(255,255,255,0.18)' : 'rgba(203,180,219,0.32)',
        backgroundColor: occupied
          ? 'transparent'
          : EMPTY_CELL_COLORS[(dayOfWeek - 1) % EMPTY_CELL_COLORS.length],
        opacity: occupied ? 0.06 : 0.78,
        overflow: 'hidden' as const,
      }),
      [dayOfWeek, period, occupied],
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
  const courses = useGridStore((s) => s.courses);
  const dayTasks = useGridStore((s) => s.dayTasks);
  const openDetailModal = useGridStore((s) => s.openDetailModal);
  const isImporting = useGridStore((s) => s.isImporting);

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
      console.warn('Failed to import schedule image.', error);
    }
  }, [isImporting]);

  const gridHeight = HEADER_HEIGHT + GRID_HEIGHT;

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
            {isImporting ? '🧠 视觉引擎解析中...' : '🖼️ 智能导入课表'}
          </Text>
        </Pressable>
      </View>

      <Animated.View
        pointerEvents={isImporting ? 'none' : 'auto'}
        style={[{ flex: 1 }, gridAnimatedStyle]}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ minHeight: gridHeight + 80 }}
          showsVerticalScrollIndicator={false}
          bounces
        >
          <View style={{ flexDirection: 'row' }}>
            <TimeColumn />

            <View>
              <WeekdayHeader />

              <View style={{ position: 'relative', width: GRID_WIDTH, height: GRID_HEIGHT }}>
                {Array.from({ length: 7 }, (_, dayIndex) => dayIndex + 1).flatMap((day) =>
                  Array.from({ length: TOTAL_PERIODS }, (_, periodIndex) => {
                    const period = periodIndex + 1;
                    const occupied = occupiedMap.get(day)?.has(period) ?? false;
                    return (
                      <GridCell
                        key={`${day}-${period}`}
                        dayOfWeek={day}
                        period={period}
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
                      {dayItems.map((task, idx) => (
                        <TaskSlotBlock
                          key={task.id}
                          task={task}
                          index={idx}
                          rowHeight={ROW_HEIGHT}
                          onPress={() => handleTaskPress(task)}
                        />
                      ))}
                    </View>
                  );
                })}

                {Array.from({ length: 7 }, (_, i) => i + 1).map((day) => {
                  const dayCourses = coursesByDay.get(day) ?? [];
                  const leftOffset = (day - 1) * COL_WIDTH;
                  return dayCourses.map((course) => (
                    <View
                      key={course.id}
                      pointerEvents="box-none"
                      style={{
                        position: 'absolute',
                        left: leftOffset,
                        width: COL_WIDTH,
                        top: 0,
                        bottom: 0,
                      }}
                    >
                      <CourseBlock
                        id={course.id}
                        name={course.name}
                        classroom={course.classroom}
                        teacher={course.teacher}
                        dayOfWeek={course.dayOfWeek}
                        startPeriod={course.startPeriod}
                        endPeriod={course.endPeriod}
                        colorIndex={course.colorIndex}
                        rowHeight={ROW_HEIGHT}
                        headerHeight={0}
                        weekRange={course.weekRange}
                        onPress={() => handleCoursePress(course)}
                      />
                    </View>
                  ));
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
