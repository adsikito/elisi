import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

// 马卡龙色板：低饱和度、高明度
const MACARON_COLORS = [
  { bg: '#FFD6E0', text: '#B8405E' }, // 草莓粉
  { bg: '#E2C2F0', text: '#7B4F9D' }, // 薰衣草
  { bg: '#C1F0DB', text: '#3A8A6A' }, // 薄荷绿
  { bg: '#FFE0B2', text: '#B87A2A' }, // 蜜桃橙
  { bg: '#B3E5FC', text: '#2A7A9D' }, // 天空蓝
  { bg: '#FFF9C4', text: '#9D8A2A' }, // 柠檬黄
  { bg: '#FFCCBC', text: '#B85A3A' }, // 珊瑚橘
  { bg: '#E1BEE7', text: '#7A3D8A' }, // 丁香紫
  { bg: '#C8E6C9', text: '#3A7A3E' }, // 鼠尾草
  { bg: '#FFE0BD', text: '#B87040' }, // 杏色
  { bg: '#B2EBF2', text: '#2A7A8A' }, // 粉蓝
  { bg: '#F8BBD0', text: '#A0406A' }, // 玫瑰粉
];

interface CourseBlockProps {
  id: string;
  name: string;
  classroom: string;
  teacher: string;
  dayOfWeek: number;
  startPeriod: number;
  endPeriod: number;
  colorIndex: number;
  rowHeight: number;
  headerHeight: number;
  weekRange?: string;
  onPress?: (e: import('react-native').GestureResponderEvent) => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const CourseBlock: React.FC<CourseBlockProps> = ({
  id,
  name,
  classroom,
  teacher,
  dayOfWeek,
  startPeriod,
  endPeriod,
  colorIndex,
  rowHeight,
  headerHeight,
  weekRange,
  onPress,
}) => {
  const scale = useSharedValue(1);
  const palette = MACARON_COLORS[colorIndex % MACARON_COLORS.length];

  const spanCount = endPeriod - startPeriod + 1;
  const blockHeight = spanCount * rowHeight - 4; // 4px gap
  const topOffset = (startPeriod - 1) * rowHeight + 2;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  return (
    <AnimatedPressable
      style={[
        animatedStyle,
        {
          position: 'absolute',
          top: topOffset,
          left: 2,
          right: 2,
          height: blockHeight,
          backgroundColor: palette.bg,
          borderRadius: 12,
          paddingHorizontal: 8,
          paddingVertical: 6,
          zIndex: 10,
          // Android elevation shadow
          elevation: 3,
          shadowColor: palette.text,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 6,
        },
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={(e) => {
        e.stopPropagation();
        onPress?.(e);
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: '700',
          color: palette.text,
          numberOfLines: spanCount >= 2 ? 2 : 1,
        }}
        numberOfLines={spanCount >= 2 ? 2 : 1}
      >
        {name}
      </Text>
      {spanCount >= 2 && (
        <>
          <Text
            style={{ fontSize: 11, color: palette.text, opacity: 0.8, marginTop: 2 }}
            numberOfLines={1}
          >
            @{classroom}
          </Text>
          <Text
            style={{ fontSize: 11, color: palette.text, opacity: 0.65 }}
            numberOfLines={1}
          >
            {teacher}
          </Text>
        </>
      )}
      {spanCount === 1 && (
        <Text
          style={{ fontSize: 10, color: palette.text, opacity: 0.7, marginTop: 1 }}
          numberOfLines={1}
        >
          {classroom}
        </Text>
      )}
    </AnimatedPressable>
  );
};

export default React.memo(CourseBlock);
