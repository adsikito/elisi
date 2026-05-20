import React, { useCallback, useMemo } from 'react';
import { Pressable, Text, View, ScrollView, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useGridStore } from '../../store/gridStore';
import { getPreference } from '../../store/mmkv';
import { useSyncGrid } from '../../hooks/useSyncGrid';
import CourseBlock from './CourseBlock';
import TapToCreateModal from './TapToCreateModal';
import type { TaskNodeExtended } from '../../store/gridStore';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TOTAL_PERIODS = 12;
const ROW_HEIGHT = 64;
const HEADER_HEIGHT = 44;
const TIME_COL_WIDTH = 48;
const SCREEN_WIDTH = Dimensions.get('window').width;
const COL_WIDTH = (SCREEN_WIDTH - TIME_COL_WIDTH) / 7;

// 马卡龙背景色（用于空格 hover 效果）
const EMPTY_CELL_COLORS = [
  '#FFF5F7', '#F9F5FF', '#F0FFF7', '#FFFAF0', '#F0F8FF', '#FFFFF0', '#FFF0F5',
];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ============================================================
// 工具函数
// ============================================================

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeWeekDates(semesterStart: string, week: number): string[] {
  const start = new Date(semesterStart + 'T00:00:00');
  const monday = new Date(start);
  monday.setDate(start.getDate() + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return formatDate(d);
  });
}

// ============================================================
// 时间轴
// ============================================================

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

// ============================================================
// 星期表头
// ============================================================

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

// ============================================================
// 单个空格（可点击）
// ============================================================

interface EmptyCellProps {
  dayOfWeek: number;
  period: number;
  dateStr: string;
  onTap: (day: number, period: number, dateStr: string) => void;
}

const EmptyCell: React.FC<EmptyCellProps> = React.memo(
  ({ dayOfWeek, period, dateStr, onTap }) => {
    const scale = useSharedValue(1);
    const bgColor = useSharedValue('transparent');

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
      backgroundColor: bgColor.value,
    }));

    const handlePressIn = () => {
      scale.value = withSpring(0.92, { damping: 15, stiffness: 400 });
      bgColor.value = withTiming(
        EMPTY_CELL_COLORS[(dayOfWeek - 1) % EMPTY_CELL_COLORS.length],
        { duration: 150 },
      );
    };

    const handlePressOut = () => {
      scale.value = withSpring(1, { damping: 15, stiffness: 400 });
      bgColor.value = withTiming('transparent', { duration: 200 });
    };

    return (
      <AnimatedPressable
        style={[
          animatedStyle,
          {
            width: COL_WIDTH,
            height: ROW_HEIGHT,
            borderRadius: 8,
          },
        ]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => onTap(dayOfWeek, period, dateStr)}
      />
    );
  },
);

// ============================================================
// 某一列的所有空格
// ============================================================

interface GridColumnProps {
  dayOfWeek: number;
  dateStr: string;
  occupiedPeriods: Set<number>;
  onTap: (day: number, period: number, dateStr: string) => void;
}

const GridColumn: React.FC<GridColumnProps> = React.memo(
  ({ dayOfWeek, dateStr, occupiedPeriods, onTap }) => (
    <View style={{ width: COL_WIDTH }}>
      {Array.from({ length: TOTAL_PERIODS }, (_, i) => i + 1).map(
        (period) =>
          !occupiedPeriods.has(period) && (
            <EmptyCell
              key={period}
              dayOfWeek={dayOfWeek}
              period={period}
              dateStr={dateStr}
              onTap={onTap}
            />
          ),
      )}
    </View>
  ),
);

// ============================================================
// 软待办色块（低饱和度、半透明、错落叠放）
// ============================================================

interface TaskSlotBlockProps {
  task: TaskNodeExtended;
  index: number;
  rowHeight: number;
}

const TASK_PASTEL = {
  bg: '#D0D8E0',
  text: '#5A6A7A',
};

const TaskSlotBlock: React.FC<TaskSlotBlockProps> = React.memo(
  ({ task, index, rowHeight }) => {
    // 错落偏置：偶数项靠左，奇数项右移，形成视觉层次
    const leftOffset = index % 2 === 0 ? 2 : COL_WIDTH * 0.45;

    return (
      <View
        style={{
          position: 'absolute',
          top: index * rowHeight + 2,
          left: leftOffset,
          width: '45%',
          height: rowHeight - 6,
          backgroundColor: TASK_PASTEL.bg,
          borderRadius: 8,
          opacity: 0.6,
          paddingHorizontal: 6,
          paddingVertical: 4,
          justifyContent: 'center',
          zIndex: 5,
        }}
      >
        <Text
          style={{
            fontSize: 10,
            fontWeight: '600',
            color: TASK_PASTEL.text,
          }}
          numberOfLines={2}
        >
          {task.title}
        </Text>
      </View>
    );
  },
);

// ============================================================
// 周次切换条
// ============================================================

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
        <Text style={{ fontSize: 16, color: '#666', fontWeight: '700' }}>
          {'<'}
        </Text>
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
          第 {currentWeek} 周
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
        <Text style={{ fontSize: 16, color: '#666', fontWeight: '700' }}>
          {'>'}
        </Text>
      </Pressable>
    </View>
  );
});

// ============================================================
// 主网格组件
// ============================================================

const TheGrid: React.FC = () => {
  const { isLoading } = useSyncGrid();
  const courses = useGridStore((s) => s.courses);
  const dayTasks = useGridStore((s) => s.dayTasks);
  const currentWeek = useGridStore((s) => s.currentWeek);
  const openCreateModal = useGridStore((s) => s.openCreateModal);

  // loading 时网格轻微淡出
  const loadingProgress = useSharedValue(0);

  React.useEffect(() => {
    loadingProgress.value = withTiming(isLoading ? 1 : 0, { duration: 250 });
  }, [isLoading, loadingProgress]);

  const gridAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - loadingProgress.value * 0.35,
  }));

  // ── 1. 计算本周 7 天的绝对日期 ──
  const dateStrMap = useMemo(() => {
    const semesterStart = getPreference('semester_start_date', '');
    if (!semesterStart) return {} as Record<number, string>;
    const dates = computeWeekDates(semesterStart, currentWeek);
    const map: Record<number, string> = {};
    for (let i = 0; i < 7; i++) map[i + 1] = dates[i];
    return map;
  }, [currentWeek]);

  // ── 2. 计算每列已占用的 period ──
  const occupiedMap = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (let d = 1; d <= 7; d++) map.set(d, new Set());
    courses.forEach((c) => {
      const set = map.get(c.dayOfWeek);
      if (set) {
        for (let p = c.startPeriod; p <= c.endPeriod; p++) set.add(p);
      }
    });
    return map;
  }, [courses]);

  // ── 3. 按列分组课程 ──
  const coursesByDay = useMemo(() => {
    const grouped = new Map<number, typeof courses>();
    for (let d = 1; d <= 7; d++) grouped.set(d, []);
    courses.forEach((c) => grouped.get(c.dayOfWeek)?.push(c));
    return grouped;
  }, [courses]);

  // ── 4. 按列分组软待办 ──
  const tasksByDay = useMemo(() => {
    const grouped = new Map<number, TaskNodeExtended[]>();
    for (let d = 1; d <= 7; d++) grouped.set(d, dayTasks[d] ?? []);
    return grouped;
  }, [dayTasks]);

  // ── 回调 ──
  const handleCellTap = useCallback(
    (dayOfWeek: number, period: number, dateStr: string) => {
      openCreateModal(dayOfWeek, period, dateStr);
    },
    [openCreateModal],
  );

  const handleCoursePress = useCallback((_id: string) => {
    // TODO: 打开课程详情 / 编辑
  }, []);

  const gridHeight = HEADER_HEIGHT + TOTAL_PERIODS * ROW_HEIGHT;

  return (
    <View style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
      {/* 周次切换 */}
      <WeekSwitcher />

      {/* 网格主体 */}
      <Animated.View style={[{ flex: 1 }, gridAnimatedStyle]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ minHeight: gridHeight + 80 }}
          showsVerticalScrollIndicator={false}
          bounces
        >
          <View style={{ flexDirection: 'row' }}>
            {/* 时间轴 */}
            <TimeColumn />

            {/* 网格主体 */}
            <View>
              {/* 星期表头 */}
              <WeekdayHeader />

              {/* 格子容器层 */}
              <View style={{ position: 'relative' }}>
                {/* 空格点击层 + 软待办层 */}
                <View style={{ flexDirection: 'row' }}>
                  {Array.from({ length: 7 }, (_, i) => i + 1).map((day) => (
                    <GridColumn
                      key={day}
                      dayOfWeek={day}
                      dateStr={dateStrMap[day] ?? ''}
                      occupiedPeriods={occupiedMap.get(day) ?? new Set()}
                      onTap={handleCellTap}
                    />
                  ))}
                </View>

                {/* 软待办色块叠加（低饱和度半透明） */}
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
                      pointerEvents="none"
                    >
                      {dayItems.map((task, idx) => (
                        <TaskSlotBlock
                          key={task.id}
                          task={task}
                          index={idx}
                          rowHeight={ROW_HEIGHT}
                        />
                      ))}
                    </View>
                  );
                })}

                {/* 硬日程课程色块叠加（高饱和度悬浮） */}
                {Array.from({ length: 7 }, (_, i) => i + 1).map((day) => {
                  const dayCourses = coursesByDay.get(day) ?? [];
                  const leftOffset = (day - 1) * COL_WIDTH;
                  return dayCourses.map((course) => (
                    <View
                      key={course.id}
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
                        startPeriod={course.startPeriod}
                        endPeriod={course.endPeriod}
                        colorIndex={course.colorIndex}
                        rowHeight={ROW_HEIGHT}
                        headerHeight={0}
                        onPress={handleCoursePress}
                      />
                    </View>
                  ));
                })}
              </View>
            </View>
          </View>
        </ScrollView>
      </Animated.View>

      {/* 创建浮层 */}
      <TapToCreateModal />
    </View>
  );
};

export default React.memo(TheGrid);
