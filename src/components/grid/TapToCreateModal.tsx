/**
 * TapToCreateModal — 点击空格弹出的创建面板
 *
 * 订阅 gridStore 的 isCreateModalOpen / selectedSlotContext，
 * 支持「硬日程课程」和「软待办任务」两种创建模式。
 * 动画全部通过 Reanimated shared value 驱动，UI 线程执行。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useGridStore } from '@/store/gridStore';
import { useTaskStore } from '@/store/taskStore';
import {
  createCourseWithSchedules,
  createTask as dbCreateTask,
} from '@/db';
import { getPreference } from '@/store/mmkv';

// ============================================================
// 常量
// ============================================================

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 马卡龙色板 — 与 CourseBlock.tsx / schema.ts 对齐 */
const MACARON_COLORS = [
  { bg: '#FFD6E0', text: '#B8405E' }, // 草莓粉
  { bg: '#E2C2F0', text: '#7B4F9D' }, // 薰衣草
  { bg: '#C1F0DB', text: '#3A8A6A' }, // 薄荷绿
  { bg: '#FFE0B2', text: '#B87A2A' }, // 蜜桃橙
  { bg: '#B3E5FC', text: '#2A7A9D' }, // 天空蓝
  { bg: '#FFF9C4', text: '#9D8A2A' }, // 柠檬黄
  { bg: '#FFCCBC', text: '#B85A3A' }, // 珊瑚
  { bg: '#E1BEE7', text: '#7A3D8A' }, // 丁香
  { bg: '#C8E6C9', text: '#3A7A3E' }, // 鼠尾草
  { bg: '#FFE0BD', text: '#B87040' }, // 杏色
  { bg: '#B2EBF2', text: '#2A7A8A' }, // 粉蓝
  { bg: '#F8BBD0', text: '#A0406A' }, // 玫瑰粉
];

// ============================================================
// 辅助组件
// ============================================================

/** 马卡龙色分段选择器 */
interface SegmentedControlProps {
  selectedIndex: number;
  onSelect: (index: number) => void;
}

const SegmentedControl: React.FC<SegmentedControlProps> = ({
  selectedIndex,
  onSelect,
}) => {
  const labels = ['硬日程课程', '软待办任务'];

  return (
    <View style={styles.segmentedContainer}>
      {labels.map((label, i) => {
        const isActive = selectedIndex === i;
        // 硬日程 = 高饱和度薰衣草，软待办 = 低饱和度半透明薄荷
        const bgColor = i === 0 ? '#E2C2F0' : 'rgba(193,240,219,0.5)';
        const textColor = i === 0 ? '#7B4F9D' : '#3A8A6A';

        return (
          <Pressable
            key={label}
            onPress={() => onSelect(i)}
            style={[
              styles.segmentItem,
              {
                backgroundColor: isActive ? bgColor : 'transparent',
                opacity: isActive ? 1 : 0.5,
              },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: isActive ? textColor : '#9E9EB0' },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

// ============================================================
// 主组件
// ============================================================

const TapToCreateModal: React.FC = () => {
  // ── Store 订阅 ──
  const isOpen = useGridStore((s) => s.isCreateModalOpen);
  const slotCtx = useGridStore((s) => s.selectedSlotContext);
  const closeCreateModal = useGridStore((s) => s.closeCreateModal);
  const loadRootTasks = useTaskStore((s) => s.loadRootTasks);

  // ── 本地状态 ──
  const [mode, setMode] = useState(0); // 0=硬日程, 1=软待办
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── 动画 ──
  const scale = useSharedValue(0.8);
  const backdropOpacity = useSharedValue(0);

  const inputRef = useRef<TextInput>(null);

  // 弹窗打开时的入场动画
  useEffect(() => {
    if (isOpen) {
      scale.value = withSpring(1, {
        damping: 18,
        stiffness: 300,
        mass: 0.8,
      });
      backdropOpacity.value = withTiming(1, { duration: 250 });
      // 自动聚焦输入框
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen, scale, backdropOpacity]);

  // 关闭弹窗（先执行退场动画，再卸载）
  const handleClose = useCallback(() => {
    scale.value = withTiming(0.8, { duration: 200 });
    backdropOpacity.value = withTiming(0, { duration: 200 });
    setTimeout(() => {
      closeCreateModal();
      setTitle('');
      setMode(0);
      setIsSubmitting(false);
    }, 220);
  }, [closeCreateModal, scale, backdropOpacity]);

  // ── 动画样式 ──
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const modalStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: backdropOpacity.value,
  }));

  // ── 提交逻辑 ──
  const handleSubmit = useCallback(async () => {
    if (!slotCtx || !title.trim() || isSubmitting) return;

    Keyboard.dismiss();
    setIsSubmitting(true);

    try {
      if (mode === 0) {
        // ═══ 硬日程：createCourseWithSchedules ═══
        const currentWeek = useGridStore.getState().currentWeek;
        const semesterStart = getPreference('semester_start_date', '');
        const endWeek = semesterStart
          ? Math.min(currentWeek + 15, 52)
          : 16;

        await createCourseWithSchedules(
          {
            name: title.trim(),
            color_index: Math.floor(Math.random() * MACARON_COLORS.length),
            classroom: '',
            teacher: '',
            start_week: currentWeek,
            end_week: endWeek,
          },
          [
            {
              day_of_week: slotCtx.dayOfWeek,
              start_period: slotCtx.startPeriod,
              end_period: slotCtx.startPeriod,
              weeks: { start: currentWeek, end: endWeek },
            },
          ],
        );
      } else {
        // ═══ 软待办：dbCreateTask ═══
        await dbCreateTask({
          title: title.trim(),
          description: `⏰ 第${slotCtx.startPeriod}节`,
          due_date: slotCtx.dateStr,
          priority: 1,
          status: 'pending',
        });
      }

      // ═══ 刷新看板 ═══
      const week = useGridStore.getState().currentWeek;
      await useGridStore.getState().setCurrentWeek(week);
      await loadRootTasks();

      handleClose();
    } catch (error) {
      const label = mode === 0 ? '课程' : '任务';
      console.error(`[TapToCreate] 创建${label}失败:`, error);
      Alert.alert('创建失败', `无法创建${label}，请稍后重试。`, [
        { text: '好的' },
      ]);
      setIsSubmitting(false);
    }
  }, [slotCtx, title, mode, isSubmitting, loadRootTasks, handleClose]);

  // ── 空态守卫 ──
  if (!isOpen || !slotCtx) return null;

  const dayLabel = WEEKDAY_LABELS[slotCtx.dayOfWeek - 1] ?? '未知';

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={styles.overlay}
    >
      {/* 背景遮罩 */}
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.avoidingView}
      >
        {/* 弹窗主体 */}
        <Animated.View style={[styles.modal, modalStyle]}>
          {/* 拖拽指示条 */}
          <View style={styles.dragHandle} />

          {/* 锚点标签 */}
          <Text style={styles.anchorText}>
            📅 锁定：{dayLabel} 第{slotCtx.startPeriod}节
            {'\n'}
            <Text style={styles.anchorDate}>({slotCtx.dateStr})</Text>
          </Text>

          {/* 分段选择器 */}
          <SegmentedControl selectedIndex={mode} onSelect={setMode} />

          {/* 输入框 */}
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={
              mode === 0 ? '输入课程名称...' : '输入待办内容...'
            }
            placeholderTextColor="#C0C0D0"
            value={title}
            onChangeText={setTitle}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          {/* 确认按钮 */}
          <Pressable
            onPress={handleSubmit}
            disabled={!title.trim() || isSubmitting}
            style={[
              styles.confirmButton,
              {
                backgroundColor:
                  mode === 0 ? '#E2C2F0' : 'rgba(193,240,219,0.7)',
                opacity: !title.trim() || isSubmitting ? 0.5 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.confirmText,
                { color: mode === 0 ? '#7B4F9D' : '#3A8A6A' },
              ]}
            >
              {isSubmitting ? '创建中...' : '确认创建'}
            </Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
};

export default React.memo(TapToCreateModal);

// ============================================================
// 样式
// ============================================================

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  avoidingView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 32,
  },
  modal: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 28,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E0',
    alignSelf: 'center',
    marginBottom: 16,
  },
  anchorText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3D3D4E',
    textAlign: 'center',
    lineHeight: 24,
  },
  anchorDate: {
    fontSize: 13,
    fontWeight: '400',
    color: '#9E9EB0',
  },
  segmentedContainer: {
    flexDirection: 'row',
    backgroundColor: '#F5F3FA',
    borderRadius: 12,
    padding: 4,
    marginTop: 20,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    marginTop: 16,
    height: 48,
    backgroundColor: '#F5F3FA',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#3D3D4E',
  },
  confirmButton: {
    marginTop: 16,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
