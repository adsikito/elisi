import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

import { createCourseWithSchedules, createTask } from '@/db';
import { useGridStore, type SlotContext } from '@/store/gridStore';
import { useTaskStore } from '@/store/taskStore';

type CreateMode = 'course' | 'task';

const WEEKDAY_LABELS = [
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日',
] as const;

const MACARON_PALETTE = [
  { bg: '#FFD6E8', text: '#B84F78' },
  { bg: '#E7D8FF', text: '#7A54B8' },
  { bg: '#D9F8E8', text: '#3A8E68' },
  { bg: '#FFF0C9', text: '#9B7428' },
  { bg: '#D7F1FF', text: '#2B7EA7' },
  { bg: '#FFE3D8', text: '#B86144' },
] as const;

const COURSE_COLOR_COUNT = 12;
const EXIT_DURATION = 220;

const TapToCreateModal: React.FC = () => {
  const isOpen = useGridStore((s) => s.isCreateModalOpen);
  const slotCtx = useGridStore((s) => s.selectedSlotContext);
  const closeCreateModal = useGridStore((s) => s.closeCreateModal);
  const loadRootTasks = useTaskStore((s) => s.loadRootTasks);

  const [shouldRender, setShouldRender] = useState(isOpen);
  const [activeSlot, setActiveSlot] = useState<SlotContext | null>(slotCtx);
  const [mode, setMode] = useState<CreateMode>('course');
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scale = useSharedValue(0.92);
  const translateY = useSharedValue(16);
  const backdropOpacity = useSharedValue(0);

  const slotLabel = useMemo(() => {
    if (!activeSlot) return '';
    const dayLabel = WEEKDAY_LABELS[activeSlot.dayOfWeek - 1] ?? '未知';
    return `📅 已锁定：${dayLabel} 第 ${activeSlot.startPeriod} 节课`;
  }, [activeSlot]);

  const hintText = useMemo(() => {
    if (mode === 'course') {
      return '输入课程名，比如「高数」';
    }
    return '输入待办标题，比如「复习高数」';
  }, [mode]);

  const resetDraft = useCallback(() => {
    setTitle('');
    setMode('course');
    setIsSubmitting(false);
  }, []);

  useEffect(() => {
    if (isOpen && slotCtx) {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      setShouldRender(true);
      setActiveSlot(slotCtx);
      setMode('course');
      setTitle('');
      setIsSubmitting(false);

      scale.value = withSpring(1, { damping: 16, stiffness: 240, mass: 0.85 });
      translateY.value = withSpring(0, { damping: 18, stiffness: 220, mass: 0.9 });
      backdropOpacity.value = withTiming(1, { duration: 180 });

      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => {
        inputRef.current?.focus();
      }, 220);
      return;
    }

    if (!isOpen && shouldRender) {
      scale.value = withTiming(0.92, { duration: EXIT_DURATION });
      translateY.value = withTiming(16, { duration: EXIT_DURATION });
      backdropOpacity.value = withTiming(0, { duration: EXIT_DURATION });

      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setShouldRender(false);
        setActiveSlot(null);
        resetDraft();
      }, EXIT_DURATION);
    }
  }, [isOpen, slotCtx, resetDraft, scale, translateY, backdropOpacity]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    },
    [],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

const sheetStyle = useAnimatedStyle(() => ({
  opacity: backdropOpacity.value,
  transform: [
    { scale: scale.value },
    { translateY: translateY.value },
  ] as const,
}));

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    closeCreateModal();
  }, [closeCreateModal, isSubmitting]);

  const handleSubmit = useCallback(async () => {
    if (!activeSlot || !title.trim() || isSubmitting) return;

    Keyboard.dismiss();
    setIsSubmitting(true);

    const cleanTitle = title.trim();
    const currentWeek = useGridStore.getState().currentWeek;
    // TODO: 未来接入周次选择器。
    const endWeek = currentWeek;

    try {
      if (mode === 'course') {
        await createCourseWithSchedules(
          {
            name: cleanTitle,
            color_index: Math.floor(Math.random() * COURSE_COLOR_COUNT),
            classroom: '',
            teacher: '',
            start_week: currentWeek,
            end_week: endWeek,
          },
          [
            {
              day_of_week: activeSlot.dayOfWeek,
              start_period: activeSlot.startPeriod,
              end_period: activeSlot.startPeriod,
              weeks: { start: currentWeek, end: endWeek },
            },
          ],
        );
      } else {
        const dayLabel = WEEKDAY_LABELS[activeSlot.dayOfWeek - 1] ?? '未知';
        await createTask({
          title: cleanTitle,
          description: `由课表格位创建：${dayLabel} 第 ${activeSlot.startPeriod} 节课`,
          priority: 1,
          status: 'pending',
          due_date: activeSlot.dateStr,
        });
      }

      useGridStore.getState().forceRefreshGrid();
      await loadRootTasks();
      closeCreateModal();
    } catch (error) {
      console.error('[TapToCreateModal] create failed:', error);
      setIsSubmitting(false);
    }
  }, [activeSlot, title, isSubmitting, mode, closeCreateModal, loadRootTasks]);

  if (!shouldRender || !activeSlot) {
    return null;
  }

  const activePalette = mode === 'course' ? MACARON_PALETTE[1] : MACARON_PALETTE[2];

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(180)}
      style={styles.overlay}
      pointerEvents="box-none"
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.avoidingView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 18 : 0}
      >
        <Animated.View style={[styles.sheet, sheetStyle]}>
          <View style={styles.handle} />

          <View style={styles.heroStrip}>
            <Text style={styles.heroText}>{slotLabel}</Text>
            <Text style={styles.heroSubtext}>
              先给这个格子一个名字，再决定它是硬日程还是软待办。
            </Text>
          </View>

          <View style={styles.inputBlock}>
            <Text style={styles.fieldLabel}>任务标题</Text>
            <TextInput
              ref={inputRef}
              value={title}
              onChangeText={setTitle}
              placeholder={hintText}
              placeholderTextColor="#BDAFCF"
              style={styles.input}
              returnKeyType="done"
              autoCorrect={false}
              autoCapitalize="none"
              editable={!isSubmitting}
              onSubmitEditing={handleSubmit}
            />
          </View>

          <View style={styles.segmentGroup}>
            <Pressable
              onPress={() => setMode('course')}
              style={[
                styles.segmentItem,
                mode === 'course' && {
                  backgroundColor: activePalette.bg,
                  borderColor: activePalette.bg,
                },
              ]}
            >
              <View
                style={[
                  styles.segmentDot,
                  mode === 'course' && { backgroundColor: activePalette.text },
                ]}
              />
              <Text
                style={[
                  styles.segmentText,
                  mode === 'course' && { color: activePalette.text },
                ]}
              >
                创建为硬日程课程
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setMode('task')}
              style={[
                styles.segmentItem,
                mode === 'task' && {
                  backgroundColor: activePalette.bg,
                  borderColor: activePalette.bg,
                },
              ]}
            >
              <View
                style={[
                  styles.segmentDot,
                  mode === 'task' && { backgroundColor: activePalette.text },
                ]}
              />
              <Text
                style={[
                  styles.segmentText,
                  mode === 'task' && { color: activePalette.text },
                ]}
              >
                创建为软待办任务
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={!title.trim() || isSubmitting}
            style={({ pressed }) => [
              styles.confirmButton,
              {
                backgroundColor: mode === 'course' ? '#DCC9FF' : '#D9F8E8',
                opacity: !title.trim() || isSubmitting ? 0.5 : pressed ? 0.92 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.confirmText,
                { color: mode === 'course' ? '#7851B4' : '#3A8E68' },
              ]}
            >
              {isSubmitting ? '正在创建…' : '确认创建'}
            </Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
};

export default React.memo(TapToCreateModal);

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 18, 38, 0.38)',
  },
  avoidingView: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: '#FFFDFE',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E7D9F4',
    marginBottom: 14,
  },
  heroStrip: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#F8F0FF',
    borderWidth: 1,
    borderColor: '#EFE0FF',
  },
  heroText: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
    color: '#4F376E',
  },
  heroSubtext: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: '#8E7AA6',
    fontWeight: '500',
  },
  inputBlock: {
    marginTop: 14,
  },
  fieldLabel: {
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#8F7BAA',
    letterSpacing: 0,
  },
  input: {
    height: 52,
    borderRadius: 16,
    paddingHorizontal: 16,
    backgroundColor: '#FAF7FF',
    borderWidth: 1,
    borderColor: '#E8DDF7',
    fontSize: 15,
    color: '#332447',
  },
  segmentGroup: {
    marginTop: 14,
    gap: 10,
  },
  segmentItem: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FAF7FF',
    borderWidth: 1,
    borderColor: '#E8DDF7',
  },
  segmentDot: {
    width: 11,
    height: 11,
    borderRadius: 999,
    backgroundColor: '#D1C1E8',
  },
  segmentText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: '#6D5B85',
  },
  confirmButton: {
    marginTop: 16,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
