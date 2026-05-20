import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTaskStore, type FlatRow } from '@/store/taskStore';
import TaskItem from '@/components/tasks/TaskItem';

const EMPTY_HEIGHT = 200;

// ── 马卡龙色调 ──
const COLORS = {
  bg: '#F5F3FA',
  title: '#3D3D4E',
  sub: '#B0B0BE',
  accent: '#C1B3F0',
};

const TaskListScreen: React.FC = () => {
  const insets = useSafeAreaInsets();

  const flatList = useTaskStore((s) => s.flatList);
  const isInitialLoading = useTaskStore((s) => s.isInitialLoading);
  const loadRootTasks = useTaskStore((s) => s.loadRootTasks);
  const toggleExpand = useTaskStore((s) => s.toggleExpand);
  const toggleStatus = useTaskStore((s) => s.toggleStatus);

  useEffect(() => {
    loadRootTasks();
  }, [loadRootTasks]);

  const renderItem = useCallback(
    ({ item }: { item: FlatRow }) => (
      <TaskItem
        row={item}
        onToggleExpand={toggleExpand}
        onToggleStatus={toggleStatus}
      />
    ),
    [toggleExpand, toggleStatus],
  );

  const keyExtractor = useCallback((item: FlatRow) => item.id, []);

  if (isInitialLoading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 页面标题 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>任务</Text>
        <Text style={styles.headerCount}>{flatList.length} 项</Text>
      </View>

      <FlashList
        data={flatList}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={62}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>暂无任务</Text>
            <Text style={styles.emptySub}>点击右下角 ＋ 创建第一个任务</Text>
          </View>
        }
      />
    </View>
  );
};

export default TaskListScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.title,
    letterSpacing: -0.5,
  },
  headerCount: {
    fontSize: 13,
    color: COLORS.sub,
  },
  listContent: {
    paddingHorizontal: 4,
    paddingBottom: 100,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    height: EMPTY_HEIGHT,
    paddingTop: 40,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.title,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.sub,
    marginTop: 6,
  },
});
