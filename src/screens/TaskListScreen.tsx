import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TaskItem from '@/components/tasks/TaskItem';
import { useTaskStore, type FlatRow } from '@/store/taskStore';

const COLORS = {
  bg: '#F5F3FA',
  title: '#3D3D4E',
  sub: '#B0B0BE',
  accent: '#C1B3F0',
};

const TaskListScreen: React.FC = () => {
  const insets = useSafeAreaInsets();

  const flatData = useTaskStore((s) => s.flatList);
  const isInitialLoading = useTaskStore((s) => s.isInitialLoading);
  const loadRootTasks = useTaskStore((s) => s.loadRootTasks);
  const toggleExpand = useTaskStore((s) => s.toggleExpand);
  const toggleStatus = useTaskStore((s) => s.toggleStatus);

  useEffect(() => {
    loadRootTasks();
  }, [loadRootTasks]);

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<FlatRow>) => (
      <TaskItem
        row={item}
        drag={drag}
        isActive={isActive}
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>任务</Text>
        <Text style={styles.headerCount}>{flatData.length} 项</Text>
      </View>

      <DraggableFlatList
        data={flatData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          flatData.length === 0 ? styles.listContentEmpty : null,
        ]}
        showsVerticalScrollIndicator={false}
        onDragEnd={({ data, from, to }) => {
          if (from === to) return;
          const draggedTaskId = data[from]?.id;
          if (!draggedTaskId) return;
          void useTaskStore.getState().reorderTasks(draggedTaskId, to, data);
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🚀</Text>
            <Text
              style={styles.emptyText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              太棒了！今天没有任何任务。点击下方极速创建...
            </Text>
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
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 4,
    paddingBottom: 100,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 48,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.sub,
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 0,
  },
});
