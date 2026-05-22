import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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
};

const INDENT_UNIT = 24;
const SWIPE_WIDTH = 80;
const SWIPE_OPEN_OFFSET = -SWIPE_WIDTH;
const SWIPE_THRESHOLD = 80;
const HORIZONTAL_ACTIVE_OFFSET: [number, number] = [-20, 20];

const CARD_SPRING = {
  damping: 18,
  stiffness: 240,
  mass: 0.85,
};

const CHECK_SPRING = {
  damping: 12,
  stiffness: 320,
};

const ARROW_DURATION = 220;
const PULSE_UP_DURATION = 1200;
const PULSE_DOWN_DURATION = 1200;

interface TaskItemProps {
  row: FlatRow;
  drag: () => void;
  isActive: boolean;
  onToggleExpand: (id: string) => void;
  onToggleStatus: (id: string) => void | Promise<void>;
}

function commitAfterSpringAndInteractions(
  commit: () => void | Promise<void>,
  onSettled: () => void,
  label: string,
): void {
  // Keep the store mutation and database write outside the active animation frame.
  InteractionManager.runAfterInteractions(() => {
    void Promise.resolve()
      .then(commit)
      .catch((error) => {
        console.warn(`[TaskItem] ${label} failed:`, error);
      })
      .finally(onSettled);
  });
}

const AIBreathingDot: React.FC = () => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: PULSE_UP_DURATION }),
        withTiming(0, { duration: PULSE_DOWN_DURATION }),
      ),
      -1,
      false,
    );
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0.4, 1]),
    transform: [
      {
        scale: interpolate(progress.value, [0, 1], [0.82, 1.18]),
      },
    ],
  }));

  return <Animated.View style={[styles.aiPulse, style]} />;
};

const TaskItem: React.FC<TaskItemProps> = ({
  row,
  drag,
  isActive,
  onToggleExpand,
  onToggleStatus,
}) => {
  const translateX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const checkScale = useSharedValue(row.status === 'done' ? 1 : 0);
  const arrowRotation = useSharedValue(0);
  const activeProgress = useSharedValue(isActive ? 1 : 0);
  const isStatusCommitPendingRef = useRef(false);
  const isDecomposeCommitPendingRef = useRef(false);

  const decomposeTask = useTaskStore((s) => s.decomposeTask);
  const isDecomposing = useTaskStore((s) => !!s.loadingIds[row.id]);

  const isDone = row.status === 'done';

  useEffect(() => {
    activeProgress.value = withSpring(isActive ? 1 : 0, CARD_SPRING);
    if (isActive) {
      translateX.value = withSpring(0, CARD_SPRING);
    }
  }, [activeProgress, isActive, translateX]);

  useEffect(() => {
    checkScale.value = withSpring(isDone ? 1 : 0, CHECK_SPRING);
  }, [checkScale, isDone]);

  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkScale.value,
    transform: [{ scale: checkScale.value }],
  }));

  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${arrowRotation.value}deg` }],
  }));

  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const cardStyle = useAnimatedStyle(() => {
    const t = activeProgress.value;
    return {
      elevation: interpolate(t, [0, 1], [1, 10], Extrapolation.CLAMP),
      shadowOffset: {
        width: 0,
        height: interpolate(t, [0, 1], [1, 10], Extrapolation.CLAMP),
      },
      shadowOpacity: interpolate(t, [0, 1], [0.06, 0.14], Extrapolation.CLAMP),
      shadowRadius: interpolate(t, [0, 1], [4, 18], Extrapolation.CLAMP),
      transform: [
        {
          scale: interpolate(t, [0, 1], [1, 1.02], Extrapolation.CLAMP),
        },
      ],
    };
  });

  const actionStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      translateX.value,
      [SWIPE_OPEN_OFFSET, 0],
      [1, 0],
      Extrapolation.CLAMP,
    );

    return {
      opacity: progress,
      transform: [
        {
          scale: interpolate(progress, [0, 1], [0.94, 1], Extrapolation.CLAMP),
        },
      ],
    };
  });

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isActive)
        .activeOffsetX(HORIZONTAL_ACTIVE_OFFSET)
        .onBegin(() => {
          gestureStartX.value = translateX.value;
        })
        .onUpdate((event) => {
          const nextTranslateX = gestureStartX.value + event.translationX;
          translateX.value = Math.min(
            0,
            Math.max(SWIPE_OPEN_OFFSET, nextTranslateX),
          );
        })
        .onEnd((event) => {
          const shouldOpen =
            translateX.value < -SWIPE_THRESHOLD / 2 || event.velocityX < -450;
          translateX.value = withSpring(
            shouldOpen ? SWIPE_OPEN_OFFSET : 0,
            CARD_SPRING,
          );
        }),
    [gestureStartX, isActive, translateX],
  );

  const resetStatusCommit = useCallback(() => {
    isStatusCommitPendingRef.current = false;
  }, []);

  const commitToggleStatus = useCallback(
    (id: string) => {
      commitAfterSpringAndInteractions(
        () => onToggleStatus(id),
        resetStatusCommit,
        'toggle status',
      );
    },
    [onToggleStatus, resetStatusCommit],
  );

  const handleToggleStatus = useCallback(() => {
    if (isStatusCommitPendingRef.current) return;

    isStatusCommitPendingRef.current = true;
    const nextDone = !isDone;
    checkScale.value = withSpring(nextDone ? 1 : 0, CHECK_SPRING, (finished) => {
      if (finished) {
        runOnJS(commitToggleStatus)(row.id);
        return;
      }

      runOnJS(resetStatusCommit)();
    });
  }, [checkScale, commitToggleStatus, isDone, resetStatusCommit, row.id]);

  const handleToggleExpand = useCallback(() => {
    const nextRotation = arrowRotation.value === 0 ? 90 : 0;
    arrowRotation.value = withTiming(nextRotation, { duration: ARROW_DURATION });
    onToggleExpand(row.id);
  }, [arrowRotation, onToggleExpand, row.id]);

  const handleStartDrag = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    drag();
  }, [drag]);

  const resetDecomposeCommit = useCallback(() => {
    isDecomposeCommitPendingRef.current = false;
  }, []);

  const commitDecomposeTask = useCallback(
    (id: string) => {
      commitAfterSpringAndInteractions(
        () => decomposeTask(id),
        resetDecomposeCommit,
        'decompose task',
      );
    },
    [decomposeTask, resetDecomposeCommit],
  );

  const handleDecompose = useCallback(() => {
    if (isDecomposeCommitPendingRef.current || isDecomposing) return;

    isDecomposeCommitPendingRef.current = true;
    translateX.value = withSpring(0, CARD_SPRING, (finished) => {
      if (finished) {
        runOnJS(commitDecomposeTask)(row.id);
        return;
      }

      runOnJS(resetDecomposeCommit)();
    });
  }, [commitDecomposeTask, isDecomposing, resetDecomposeCommit, row.id, translateX]);

  const priorityColor =
    row.priority >= 2
      ? PALETTE.priority2
      : row.priority >= 1
        ? PALETTE.priority1
        : PALETTE.priority0;

  return (
    <View style={styles.swipeContainer}>
      <Animated.View style={[styles.swipeAction, actionStyle]}>
        <Pressable
          onPress={handleDecompose}
          style={styles.aiButton}
          disabled={isDecomposing}
        >
          <Text style={styles.aiIcon}>AI</Text>
          <Text style={styles.aiLabel}>
            {isDecomposing ? '处理中...' : 'AI 拆解'}
          </Text>
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={swipeStyle}>
          <Animated.View
            style={[
              styles.card,
              cardStyle,
              {
                marginLeft: row.depth * INDENT_UNIT,
                backgroundColor: isDone ? PALETTE.cardDone : PALETTE.card,
                zIndex: isActive ? 2 : 0,
              },
            ]}
          >
            <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />

            <Pressable
              onLongPress={handleStartDrag}
              delayLongPress={120}
              hitSlop={10}
              style={styles.dragHandle}
            >
              <Text style={styles.dragIcon}>≡</Text>
            </Pressable>

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
                {isDecomposing ? <AIBreathingDot /> : null}
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
                <Animated.Text style={[styles.arrow, arrowStyle]}>⌄</Animated.Text>
                {row.isLoading ? <Text style={styles.loadingText}>•</Text> : null}
              </Pressable>
            ) : row.isLoading ? (
              <View style={styles.arrowBtn}>
                <Text style={styles.loadingText}>•</Text>
              </View>
            ) : null}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

export default memo(TaskItem);

const styles = StyleSheet.create({
  swipeContainer: {
    marginHorizontal: 16,
  },
  swipeAction: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginVertical: 3,
  },
  aiButton: {
    width: SWIPE_WIDTH,
    height: '100%',
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: PALETTE.aiPurple,
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiIcon: {
    marginBottom: 2,
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  aiLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  aiPulse: {
    width: 10,
    height: 10,
    marginLeft: 6,
    borderRadius: 5,
    backgroundColor: PALETTE.aiPurple,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  priorityBar: {
    width: 4,
    height: 28,
    marginRight: 10,
    borderRadius: 2,
  },
  dragHandle: {
    width: 20,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  dragIcon: {
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
    color: PALETTE.sub,
  },
  checkbox: {
    width: 22,
    height: 22,
    marginRight: 12,
    borderWidth: 2,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkInner: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    marginTop: -1,
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
    color: PALETTE.text,
  },
  titleDone: {
    color: PALETTE.textDone,
    textDecorationLine: 'line-through',
  },
  description: {
    marginTop: 2,
    fontSize: 12,
    color: PALETTE.sub,
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
  loadingText: {
    fontSize: 14,
    color: PALETTE.loading,
  },
});
