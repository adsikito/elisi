/**
 * ItemDetailModal — 点击已有卡片弹出的详情面板
 *
 * 支持硬日程 Course 和软待办 Task 两种类型。
 * 提供删除操作，删除后瞬间刷新课表。
 */

import React, { useCallback, useEffect } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useGridStore, type DetailItem } from '@/store/gridStore';
import { useTaskStore } from '@/store/taskStore';
import { deleteCourse, deleteTask } from '@/db';

// ============================================================
// 马卡龙色板（与 CourseBlock 对齐）
// ============================================================

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

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// ============================================================
// 主组件
// ============================================================

const ItemDetailModal: React.FC = () => {
  const isOpen = useGridStore((s) => s.isDetailModalOpen);
  const detailItem = useGridStore((s) => s.selectedDetailItem);
  const closeDetailModal = useGridStore((s) => s.closeDetailModal);
  const loadRootTasks = useTaskStore((s) => s.loadRootTasks);

  // ── 动画 ──
  const scale = useSharedValue(0.8);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (isOpen) {
      scale.value = withSpring(1, { damping: 18, stiffness: 300, mass: 0.8 });
      backdropOpacity.value = withTiming(1, { duration: 250 });
    }
  }, [isOpen, scale, backdropOpacity]);

  const handleClose = useCallback(() => {
    scale.value = withTiming(0.8, { duration: 200 });
    backdropOpacity.value = withTiming(0, { duration: 200 });
    setTimeout(() => {
      closeDetailModal();
    }, 220);
  }, [closeDetailModal, scale, backdropOpacity]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const modalStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: backdropOpacity.value,
  }));

  // ── 删除逻辑 ──
  const handleDelete = useCallback(async () => {
    if (!detailItem) return;

    const label = detailItem.type === 'course' ? '课程' : '任务';
    const itemName =
      detailItem.type === 'course'
        ? detailItem.item.name
        : detailItem.item.title;

    Alert.alert(`删除${label}`, `确定删除「${itemName}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            if (detailItem.type === 'course') {
              await deleteCourse(detailItem.item.courseId ?? detailItem.item.id);
            } else {
              await deleteTask(detailItem.item.id);
            }
            useGridStore.getState().forceRefreshGrid();
            await loadRootTasks();
            handleClose();
          } catch (error) {
            console.error(`[ItemDetail] 删除${label}失败:`, error);
            Alert.alert('删除失败', '请稍后重试。');
          }
        },
      },
    ]);
  }, [detailItem, loadRootTasks, handleClose]);

  // ── 空态守卫 ──
  if (!isOpen || !detailItem) return null;

  // ── 根据类型渲染 ──
  const isCourse = detailItem.type === 'course';
  const palette = isCourse
    ? MACARON_COLORS[detailItem.item.colorIndex % MACARON_COLORS.length]
    : { bg: '#D8D0E8', text: '#6B6080' };

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

      {/* 弹窗主体 */}
      <Animated.View style={[styles.modal, modalStyle]}>
        <View style={styles.dragHandle} />

        {/* 色块指示 */}
        <View style={[styles.colorBadge, { backgroundColor: palette.bg }]}>
          <Text style={[styles.colorBadgeText, { color: palette.text }]}>
            {isCourse ? '硬日程' : '软待办'}
          </Text>
        </View>

        {/* 标题 */}
        <Text style={styles.title}>
          {isCourse ? detailItem.item.name : detailItem.item.title}
        </Text>

        {/* 详情信息 */}
        {isCourse ? (
          <View style={styles.infoGroup}>
            <InfoRow label="时间" value={`${WEEKDAY_LABELS[detailItem.item.dayOfWeek - 1]} 第${detailItem.item.startPeriod}-${detailItem.item.endPeriod}节`} />
            {detailItem.item.classroom ? (
              <InfoRow label="教室" value={detailItem.item.classroom} />
            ) : null}
            {detailItem.item.teacher ? (
              <InfoRow label="教师" value={detailItem.item.teacher} />
            ) : null}
            {detailItem.item.weekRange ? (
              <InfoRow label="周次" value={detailItem.item.weekRange} />
            ) : null}
          </View>
        ) : (
          <View style={styles.infoGroup}>
            <InfoRow label="日期" value={detailItem.item.dateStr} />
            {detailItem.item.startPeriod ? (
              <InfoRow label="节次" value={`第${detailItem.item.startPeriod}节`} />
            ) : null}
            <InfoRow label="状态" value={detailItem.item.status === 'done' ? '已完成' : detailItem.item.status === 'in_progress' ? '进行中' : '待办'} />
            {detailItem.item.description ? (
              <InfoRow label="备注" value={detailItem.item.description} />
            ) : null}
          </View>
        )}

        {/* 删除按钮 */}
        <Pressable onPress={handleDelete} style={styles.deleteButton}>
          <Text style={styles.deleteText}>删除</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
};

// ── 信息行 ──
const InfoRow: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

export default React.memo(ItemDetailModal);

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
  modal: {
    width: '85%',
    maxWidth: 360,
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
  colorBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 12,
  },
  colorBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#3D3D4E',
    marginBottom: 16,
  },
  infoGroup: {
    gap: 10,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9E9EB0',
    width: 48,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3D3D4E',
    flex: 1,
  },
  deleteButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFE5E5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#D04040',
  },
});
