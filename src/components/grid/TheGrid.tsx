import React, { useCallback, useMemo } from 'react';
import { Pressable, Text, View, ScrollView, Dimensions } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useGridStore } from '../../store/gridStore';
import { useSyncGrid } from '../../hooks/useSyncGrid';
import CourseBlock from './CourseBlock';

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

// ===== 时间轴 =====
const TimeColumn: React.FC = React.memo(() => {
  const timeSlots = useGridStore((s) => s.timeSlots);
  return (
    <View style={{ width: TIME_COL_WIDTH }}>
      {/* 表头占位 */}
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

// ===== 星期表头 =====
const WeekdayHeader: React.FC = React.memo(() => (
  <View style={{ flexDirection: 'row' }}>
    {WEEKDAYS.map((day, i) => (
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

// ===== 单个空格（可点击） =====
interface EmptyCellProps {
  dayOfWeek: number;
  period: number;
  onTap: (day: number, period: number) => void;
}

const EmptyCell: React.FC<EmptyCellProps> = React.memo(
  ({ dayOfWeek, period, onTap }) => {
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
        onPress={() => onTap(dayOfWeek, period)}
      />
    );
  },
);

// ===== 某一列的所有空格 =====
interface GridColumnProps {
  dayOfWeek: number;
  occupiedPeriods: Set<number>;
  onTap: (day: number, period: number) => void;
}

const GridColumn: React.FC<GridColumnProps> = React.memo(
  ({ dayOfWeek, occupiedPeriods, onTap }) => (
    <View style={{ width: COL_WIDTH }}>
      {Array.from({ length: TOTAL_PERIODS }, (_, i) => i + 1).map(
        (period) =>
          !occupiedPeriods.has(period) && (
            <EmptyCell
              key={period}
              dayOfWeek={dayOfWeek}
              period={period}
              onTap={onTap}
            />
          ),
      )}
    </View>
  ),
);

// ===== 快速创建浮层 =====
interface QuickCreateProps {
  dayOfWeek: number;
  period: number;
  onClose: () => void;
}

const QuickCreateOverlay: React.FC<QuickCreateProps> = React.memo(
  ({ dayOfWeek, period, onClose }) => {
    const timeSlots = useGridStore((s) => s.timeSlots);
    const slot = timeSlots.find((s) => s.period === period);

    return (
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(150)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.25)',
          zIndex: 100,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Pressable style={{ flex: 1, width: '100%' }} onPress={onClose} />
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          exiting={SlideOutDown.duration(200)}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: '#fff',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 24,
            paddingTop: 20,
            paddingBottom: 40,
            elevation: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.12,
            shadowRadius: 16,
          }}
        >
          {/* 拖拽指示条 */}
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: '#E0E0E0',
              alignSelf: 'center',
              marginBottom: 16,
            }}
          />

          <Text style={{ fontSize: 20, fontWeight: '700', color: '#333' }}>
            极速创建任务
          </Text>

          <View
            style={{
              flexDirection: 'row',
              marginTop: 12,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                backgroundColor: '#E2C2F0',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 20,
                marginRight: 8,
              }}
            >
              <Text style={{ fontSize: 13, color: '#7B4F9D', fontWeight: '600' }}>
                {WEEKDAYS[dayOfWeek - 1]}
              </Text>
            </View>
            <View
              style={{
                backgroundColor: '#B3E5FC',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 20,
                marginRight: 8,
              }}
            >
              <Text style={{ fontSize: 13, color: '#2A7A9D', fontWeight: '600' }}>
                第{period}节
              </Text>
            </View>
            {slot && (
              <Text style={{ fontSize: 12, color: '#999' }}>
                {slot.startTime} - {slot.endTime}
              </Text>
            )}
          </View>

          {/* 这里预留输入区域，由业务层扩展 */}
          <View
            style={{
              marginTop: 20,
              height: 48,
              backgroundColor: '#F5F5F5',
              borderRadius: 12,
              justifyContent: 'center',
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ color: '#BBB', fontSize: 14 }}>
              输入任务名称...
            </Text>
          </View>
        </Animated.View>
      </Animated.View>
    );
  },
);

// ===== 周次切换条 =====
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

// ===== 主网格组件 =====
const TheGrid: React.FC = () => {
  const { isLoading } = useSyncGrid();
  const courses = useGridStore((s) => s.courses);
  const selectedCell = useGridStore((s) => s.selectedCell);
  const showQuickCreate = useGridStore((s) => s.showQuickCreate);
  const setSelectedCell = useGridStore((s) => s.setSelectedCell);
  const setShowQuickCreate = useGridStore((s) => s.setShowQuickCreate);

  // loading 时网格轻微淡出，切换周次时丝滑过渡
  const loadingProgress = useSharedValue(0);

  React.useEffect(() => {
    loadingProgress.value = withTiming(isLoading ? 1 : 0, { duration: 250 });
  }, [isLoading, loadingProgress]);

  const gridAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - loadingProgress.value * 0.35, // 最低 0.65 透明度
  }));

  // 计算每列已占用的 period（用于排除空格渲染）
  const occupiedMap = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (let d = 1; d <= 7; d++) map.set(d, new Set());
    courses.forEach((c) => {
      const set = map.get(c.dayOfWeek);
      if (set) {
        for (let p = c.startPeriod; p <= c.endPeriod; p++) {
          set.add(p);
        }
      }
    });
    return map;
  }, [courses]);

  // 按列分组课程
  const coursesByDay = useMemo(() => {
    const grouped = new Map<number, typeof courses>();
    for (let d = 1; d <= 7; d++) grouped.set(d, []);
    courses.forEach((c) => {
      grouped.get(c.dayOfWeek)?.push(c);
    });
    return grouped;
  }, [courses]);

  const handleCellTap = useCallback(
    (dayOfWeek: number, period: number) => {
      setSelectedCell({ dayOfWeek, period });
      setShowQuickCreate(true);
    },
    [setSelectedCell, setShowQuickCreate],
  );

  const handleCloseQuickCreate = useCallback(() => {
    setShowQuickCreate(false);
    setSelectedCell(null);
  }, [setShowQuickCreate, setSelectedCell]);

  const handleCoursePress = useCallback((_id: string) => {
    // TODO: 打开课程详情 / 编辑
  }, []);

  const gridHeight = HEADER_HEIGHT + TOTAL_PERIODS * ROW_HEIGHT;

  return (
    <View style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
      {/* 周次切换 */}
      <WeekSwitcher />

      {/* 网格主体，loading 时淡出 */}
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

            {/* 课程色块层（绝对定位） */}
            <View style={{ position: 'relative' }}>
              {/* 空格点击层 */}
              <View style={{ flexDirection: 'row' }}>
                {Array.from({ length: 7 }, (_, i) => i + 1).map((day) => (
                  <GridColumn
                    key={day}
                    dayOfWeek={day}
                    occupiedPeriods={occupiedMap.get(day) ?? new Set()}
                    onTap={handleCellTap}
                  />
                ))}
              </View>

              {/* 课程色块叠加 */}
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

      {/* 快速创建浮层 */}
      {showQuickCreate && selectedCell && (
        <QuickCreateOverlay
          dayOfWeek={selectedCell.dayOfWeek}
          period={selectedCell.period}
          onClose={handleCloseQuickCreate}
        />
      )}
    </View>
  );
};

export default React.memo(TheGrid);
