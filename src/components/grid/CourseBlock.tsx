import React from 'react';
import { Pressable, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const MACARON_COLORS = [
  { bg: '#FFD6E0', text: '#B8405E' },
  { bg: '#E2C2F0', text: '#7B4F9D' },
  { bg: '#C1F0DB', text: '#3A8A6A' },
  { bg: '#FFE0B2', text: '#B87A2A' },
  { bg: '#B3E5FC', text: '#2A7A9D' },
  { bg: '#FFF9C4', text: '#9D8A2A' },
  { bg: '#FFCCBC', text: '#B85A3A' },
  { bg: '#E1BEE7', text: '#7A3D8A' },
  { bg: '#C8E6C9', text: '#3A7A3E' },
  { bg: '#FFE0BD', text: '#B87040' },
  { bg: '#B2EBF2', text: '#2A7A8A' },
  { bg: '#F8BBD0', text: '#A0406A' },
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
  name,
  classroom,
  teacher,
  startPeriod,
  endPeriod,
  colorIndex,
  rowHeight,
  onPress,
}) => {
  const scale = useSharedValue(1);
  const palette = MACARON_COLORS[colorIndex % MACARON_COLORS.length];

  const spanCount = endPeriod - startPeriod + 1;
  const blockHeight = spanCount * rowHeight - 4;
  const topOffset = (startPeriod - 1) * rowHeight + 2;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

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
          elevation: 3,
          shadowColor: palette.text,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 6,
        },
      ]}
      onPressIn={() => {
        scale.value = withSpring(0.96, { damping: 15, stiffness: 300 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 300 });
      }}
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
        }}
        numberOfLines={spanCount >= 2 ? 2 : 1}
      >
        {name}
      </Text>
      {spanCount >= 2 && (
        <>
          <Text
            style={{
              fontSize: 11,
              color: palette.text,
              opacity: 0.8,
              marginTop: 2,
            }}
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
          style={{
            fontSize: 10,
            color: palette.text,
            opacity: 0.7,
            marginTop: 1,
          }}
          numberOfLines={1}
        >
          {classroom}
        </Text>
      )}
    </AnimatedPressable>
  );
};

export default React.memo(CourseBlock);
