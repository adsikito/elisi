import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const [text, setText] = useState('');

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

  const handleSubmitTask = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await useTaskStore.getState().createTask({
      title: trimmed,
      parent_id: null,
      priority: 1,
      status: 'pending',
    });
    setText('');
  }, [text]);

  if (isInitialLoading) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
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
            { paddingBottom: 116 + insets.bottom },
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

        <View style={[styles.inputDock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View pointerEvents="none" style={styles.inputDockGlow}>
            <View style={styles.inputDockGlowFaint} />
            <View style={styles.inputDockGlowMid} />
            <View style={styles.inputDockGlowStrong} />
          </View>

          <View style={styles.composerBar}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="写下一个新任务..."
              placeholderTextColor="#B8A9C8"
              style={styles.composerInput}
              returnKeyType="send"
              enablesReturnKeyAutomatically
              autoCorrect={false}
              autoCapitalize="none"
              onSubmitEditing={handleSubmitTask}
            />

            <Pressable
              onPress={handleSubmitTask}
              disabled={!text.trim()}
              style={({ pressed }) => [
                styles.sendButton,
                !text.trim() ? styles.sendButtonDisabled : null,
                pressed && text.trim() ? styles.sendButtonPressed : null,
              ]}
            >
              <Text style={styles.sendButtonText}>➔</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default TaskListScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
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
  inputDock: {
    paddingHorizontal: 16,
    paddingTop: 18,
    backgroundColor: 'rgba(245,243,250,0.96)',
  },
  inputDockGlow: {
    position: 'absolute',
    top: -40,
    left: 0,
    right: 0,
    height: 58,
    overflow: 'hidden',
  },
  inputDockGlowFaint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 58,
    backgroundColor: 'rgba(193,179,240,0.04)',
  },
  inputDockGlowMid: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 38,
    backgroundColor: 'rgba(207,195,237,0.10)',
  },
  inputDockGlowStrong: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 18,
    backgroundColor: 'rgba(245,243,250,0.92)',
  },
  composerBar: {
    minHeight: 56,
    borderRadius: 18,
    paddingLeft: 16,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFDFE',
    borderWidth: 1,
    borderColor: '#E7DDF4',
    shadowColor: '#8E7AA6',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  composerInput: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
    paddingRight: 12,
    fontSize: 15,
    fontWeight: '600',
    color: '#3D3D4E',
    letterSpacing: 0,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B8A7DB',
    shadowColor: '#8A73B4',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  sendButtonPressed: {
    transform: [{ translateY: 1 }],
    opacity: 0.9,
  },
  sendButtonDisabled: {
    backgroundColor: '#D8D0E7',
    shadowOpacity: 0.08,
  },
  sendButtonText: {
    color: '#FFFDFE',
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '800',
  },
});
