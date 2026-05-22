import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import TaskItem from '@/components/tasks/TaskItem';
import { useTaskStore, type FlatRow } from '@/store/taskStore';

const COLORS = {
  bg: '#F8F5FB',
  card: '#FFFFFF',
  title: '#343044',
  sub: '#9C95AA',
  accent: '#C1B3F0',
  accentSoft: '#EEE8FF',
  accentStrong: '#8F73C8',
  border: '#E9DFF5',
  input: '#FFFDFE',
};

interface QuickAddInputProps {
  bottomInset: number;
}

const QuickAddInput: React.FC<QuickAddInputProps> = ({ bottomInset }) => {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = text.trim().length > 0 && !isSubmitting;

  const handleSubmitTask = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await useTaskStore.getState().createTask({ title: trimmed });
      setText('');
    } catch (error) {
      console.warn('[TaskListScreen] quick create failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, text]);

  return (
    <View style={[styles.inputDock, { paddingBottom: Math.max(bottomInset, 10) }]}>
      <View pointerEvents="none" style={styles.inputDockGlow}>
        <View style={styles.inputDockGlowFaint} />
        <View style={styles.inputDockGlowMid} />
        <View style={styles.inputDockGlowStrong} />
      </View>

      <View style={styles.composerBar}>
        <View style={styles.leadingIcon}>
          <Ionicons name="flash-outline" size={17} color={COLORS.accentStrong} />
        </View>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="极速录入新任务..."
          placeholderTextColor="#B8A9C8"
          style={styles.composerInput}
          returnKeyType="send"
          enablesReturnKeyAutomatically
          autoCorrect={false}
          autoCapitalize="none"
          editable={!isSubmitting}
          onSubmitEditing={handleSubmitTask}
        />

        <Pressable
          onPress={handleSubmitTask}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ busy: isSubmitting, disabled: !canSubmit }}
          style={({ pressed }) => [
            styles.sendButton,
            !canSubmit ? styles.sendButtonDisabled : null,
            pressed && canSubmit ? styles.sendButtonPressed : null,
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFDFE" />
          ) : (
            <Text style={styles.sendButtonText}>➔</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
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
    ({ item }: ListRenderItemInfo<FlatRow>) => (
      <TaskItem
        row={item}
        drag={() => {}}
        isActive={false}
        onToggleExpand={toggleExpand}
        onToggleStatus={toggleStatus}
      />
    ),
    [toggleExpand, toggleStatus],
  );

  const keyExtractor = useCallback((item: FlatRow) => item.id, []);

  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      { paddingBottom: 112 + insets.bottom },
      flatData.length === 0 ? styles.listContentEmpty : null,
    ],
    [flatData.length, insets.bottom],
  );

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

        <FlashList
          data={flatData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={styles.list}
          contentContainerStyle={listContentStyle}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="checkbox-outline" size={36} color={COLORS.accentStrong} />
              </View>
              <Text
                style={styles.emptyText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
              >
                还没有任务，写下第一件事。
              </Text>
            </View>
          }
        />

        <QuickAddInput bottomInset={insets.bottom} />
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
    letterSpacing: 0,
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
    paddingTop: 4,
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
    width: 70,
    height: 70,
    borderRadius: 22,
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.sub,
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 0,
  },
  inputDock: {
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: 'rgba(248,245,251,0.98)',
  },
  inputDockGlow: {
    position: 'absolute',
    top: -36,
    left: 0,
    right: 0,
    height: 54,
    overflow: 'hidden',
  },
  inputDockGlowFaint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 54,
    backgroundColor: 'rgba(193,179,240,0.05)',
  },
  inputDockGlowMid: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 36,
    backgroundColor: 'rgba(207,195,237,0.12)',
  },
  inputDockGlowStrong: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 22,
    backgroundColor: 'rgba(248,245,251,0.94)',
  },
  composerBar: {
    minHeight: 58,
    borderRadius: 18,
    paddingLeft: 10,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#8E7AA6',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  leadingIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentSoft,
  },
  composerInput: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.title,
    letterSpacing: 0,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentStrong,
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
