import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Swipeable } from 'react-native-gesture-handler';
import { useTaskStore, type FlatRow } from '@/store/taskStore';

const PALETTE = {
  card: '#FAFAFA',
  cardDone: '#F3F3F3',
  text: '#3D3D4E',
  textDone: '#B0B0BE',
  sub: '#9E9EB0',
  border: '#EBEBF0',
  accent: '#C1B3F0',
  accentDone: '#C1F0DB',
  loading: '#E2C2F0',
  priority0: '#C1F0DB',
  priority1: '#FFE0B2',
  priority2: '#FFD6E0',
  aiPurple: '#9B72CF',
  aiGlow: '#D4B8F6',
};

const INDENT_UNIT = 24;
const SWIPE_THRESHOLD = 80;

interface TaskItemProps {
  row: FlatRow;
  onToggleExpand: (id: string) => void;
  onToggleStatus: (id: string) => void;
}

const AIBreathingDot: React.FC = () => {
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200 }),
        withTiming(0, { duration: 1200 }),
      ),
      -1,
      false,
    );
  }, [progress]);

  const dotStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1], [0.8, 1.25]);
    const opacity = interpolate(progress.value, [0, 1], [0.4, 1]);
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  return (
    <Animated.View
      style={[
        {
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: PALETTE.aiPurple,
          marginLeft: 6,
        },
        dotStyle,
      ]}
    />
  );
};

const TaskItem: React.FC<TaskItemProps> = ({
  row,
  onToggleExpand,
  onToggleStatus,
}) => {
  const swipeableRef = useRef<Swipeable>(null);
  const checkScale = useSharedValue(row.status === 'done' ? 1 : 0);
  const arrowRotation = useSharedValue(0);

  const decomposeTask = useTaskStore((s) => s.decomposeTask);
  const isDecomposing = useTaskStore((s) => !!s.loadingIds[row.id]);

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkScale.value,
  }));

  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${arrowRotation.value}deg` }],
  }));

  const handleToggleStatus = useCallback(() => {
    const nextDone = row.status !== 'done';
    checkScale.value = withSpring(nextDone ? 1 : 0, {
      damping: 12,
      stiffness: 300,
    });
    onToggleStatus(row.id);
  }, [row.id, row.status, onToggleStatus, checkScale]);

  const handleToggleExpand = useCallback(() => {
    arrowRotation.value = withTiming(arrowRotation.value === 0 ? 90 : 0, {
      duration: 220,
    });
    onToggleExpand(row.id);
  }, [row.id, onToggleExpand, arrowRotation]);

  const handleDecompose = useCallback(async () => {
    swipeableRef.current?.close();
    await decomposeTask(row.id);
  }, [row.id, decomposeTask]);

  const renderRightActions = useCallback(
    (_progress: any, dragX: any) => {
      const actionStyle = useAnimatedStyle(() => {
        const scale = interpolate(
          dragX?.value ?? 0,
          [-SWIPE_THRESHOLD, -40, 0],
          [1, 0.9, 0.6],
        );
        return { transform: [{ scale }] };
      });

      return (
        <Animated.View style={[styles.swipeAction, actionStyle]}>
          <Pressable
            onPress={handleDecompose}
            style={styles.aiButton}
            disabled={isDecomposing}
          >
            <Text style={styles.aiIcon}>✦</Text>
            <Text style={styles.aiLabel}>
              {isDecomposing ? '拆解中...' : 'AI 拆解'}
            </Text>
          </Pressable>
        </Animated.View>
      );
    },
    [handleDecompose, isDecomposing],
  );

  const isDone = row.status === 'done';
  const priorityColor =
    row.priority === 2
      ? PALETTE.priority2
      : row.priority === 1
        ? PALETTE.priority1
        : PALETTE.priority0;

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={SWIPE_THRESHOLD}
      friction={2}
      overshootRight={false}
      containerStyle={{ marginHorizontal: 16 }}
    >
      <Animated.View
        entering={FadeIn.duration(240).springify()}
        style={[
          styles.card,
          {
            marginLeft: row.depth * INDENT_UNIT,
            backgroundColor: isDone ? PALETTE.cardDone : PALETTE.card,
          },
        ]}
      >
        <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />

        <Pressable
          onPress={handleToggleStatus}
          style={[
            styles.checkbox,
            {
              borderColor: isDone ? PALETTE.accentDone : PALETTE.accent,
              backgroundColor: isDone ? PALETTE.accentDone : 'transparent',
            },
          ]}
          hitSlop={8}
        >
          <Animated.View style={[styles.checkInner, checkStyle]}>
            <Text style={styles.checkMark}>✓</Text>
          </Animated.View>
        </Pressable>

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, isDone && styles.titleDone]}
              numberOfLines={2}
            >
              {row.title}
            </Text>
            {isDecomposing && <AIBreathingDot />}
          </View>
          {row.description ? (
            <Text style={styles.description} numberOfLines={1}>
              {row.description}
            </Text>
          ) : null}
        </View>

        {row.hasChildren ? (
          <Pressable
            onPress={handleToggleExpand}
            hitSlop={10}
            style={styles.arrowBtn}
          >
            <Animated.Text style={[styles.arrow, arrowStyle]}>▶</Animated.Text>
            {row.isLoading && (
              <View style={styles.loadingDot}>
                <Text style={styles.loadingText}>…</Text>
              </View>
            )}
          </Pressable>
        ) : row.isLoading ? (
          <View style={styles.arrowBtn}>
            <Text style={styles.loadingText}>…</Text>
          </View>
        ) : null}
      </Animated.View>
    </Swipeable>
  );
};

export default React.memo(TaskItem);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginVertical: 3,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  priorityBar: {
    width: 4,
    height: 28,
    borderRadius: 2,
    marginRight: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkInner: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
    marginTop: -1,
  },
  content: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: PALETTE.text,
    lineHeight: 21,
    flexShrink: 1,
  },
  titleDone: {
    color: PALETTE.textDone,
    textDecorationLine: 'line-through',
  },
  description: {
    fontSize: 12,
    color: PALETTE.sub,
    marginTop: 2,
  },
  arrowBtn: {
    paddingLeft: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    fontSize: 11,
    color: PALETTE.sub,
  },
  loadingDot: {
    position: 'absolute',
    bottom: -2,
    right: 0,
  },
  loadingText: {
    fontSize: 14,
    color: PALETTE.loading,
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginVertical: 3,
  },
  aiButton: {
    backgroundColor: PALETTE.aiPurple,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
  },
  aiIcon: {
    fontSize: 20,
    color: '#fff',
    marginBottom: 2,
  },
  aiLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
});
