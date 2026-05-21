import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
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
import {
  isAIConfigured,
  streamTaskBreakdown,
  type ScheduledSubTask,
} from '@/ai/ByokConnector';
import { createTask } from '@/db';
import { useGridStore } from '@/store/gridStore';
import { useTaskStore } from '@/store/taskStore';

const COLORS = {
  bg: '#FAFAFA',
  card: '#FFFFFF',
  title: '#3D3D4E',
  sub: '#9E9EB0',
  accent: '#C1B3F0',
  accentStrong: '#8F73C8',
  userBubble: '#EDE8FD',
  aiBubble: '#F1F1F4',
  border: '#ECECF0',
  input: '#FFFDFE',
  placeholder: '#B8A9C8',
  danger: '#D96363',
};

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  suggestions?: ScheduledSubTask[];
  isLoading?: boolean;
  applied?: boolean;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: '你好，我在。把想安排、拆解或调整的事发给我就好。',
};

function makeMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildTaskDescription(subTask: ScheduledSubTask): string {
  const details: string[] = ['AI Copilot 建议'];

  if (subTask.target_date) {
    details.push(subTask.target_date);
  }

  if (typeof subTask.start_period === 'number') {
    details.push(`第${subTask.start_period}节`);
  }

  details.push(`${subTask.duration_minutes}min`);
  return details.join(' · ');
}

function formatSuggestionLine(subTask: ScheduledSubTask, index: number): string {
  const parts = [`${index + 1}. ${subTask.title}`];

  if (subTask.target_date) {
    parts.push(subTask.target_date);
  }

  if (typeof subTask.start_period === 'number') {
    parts.push(`第${subTask.start_period}节`);
  }

  parts.push(`${subTask.duration_minutes}min`);
  return parts.join(' · ');
}

function buildAssistantText(suggestions: ScheduledSubTask[]): string {
  if (suggestions.length === 0) {
    return '我暂时没有拆出可直接应用的待办，可以换一种说法再试一次。';
  }

  return ['我整理出这些建议：', ...suggestions.map(formatSuggestionLine)].join('\n');
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    if (error.message.includes('No AI API key') || error.message.includes('API key')) {
      return '还没有配置 AI 密钥。去设置页保存 BYOK 配置后，我就可以开始处理。';
    }
    return error.message;
  }

  return 'AI 暂时没有响应，请稍后再试。';
}

function TypingDots() {
  const dot1 = useRef(new Animated.Value(0.32)).current;
  const dot2 = useRef(new Animated.Value(0.32)).current;
  const dot3 = useRef(new Animated.Value(0.32)).current;

  useEffect(() => {
    const createDotAnimation = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.32,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.delay(260),
        ]),
      );

    const animations = [
      createDotAnimation(dot1, 0),
      createDotAnimation(dot2, 120),
      createDotAnimation(dot3, 240),
    ];

    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.typingDots}>
      {[dot1, dot2, dot3].map((opacity, index) => (
        <Animated.View
          key={index}
          style={[
            styles.typingDot,
            {
              opacity,
              transform: [
                {
                  translateY: opacity.interpolate({
                    inputRange: [0.32, 1],
                    outputRange: [0, -3],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function CopilotScreen() {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);

  const canSend = input.trim().length > 0 && !isSending;

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [messages, scrollToEnd]);

  const applySuggestions = useCallback(async (message: ChatMessage) => {
    const suggestions = message.suggestions ?? [];
    if (suggestions.length === 0 || applyingMessageId) return;

    setApplyingMessageId(message.id);
    try {
      for (const subTask of suggestions) {
        const title = subTask.title.trim();
        if (!title) continue;

        await createTask({
          title,
          description: buildTaskDescription(subTask),
          due_date: subTask.target_date ?? null,
          priority: 1,
          status: 'pending',
        });
      }

      await useTaskStore.getState().loadRootTasks();
      useGridStore.getState().forceRefreshGrid();

      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                applied: true,
                text: `${item.text}\n\n已应用到我的待办。`,
              }
            : item,
        ),
      );
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeMessageId('assistant-error'),
          role: 'assistant',
          text: `应用失败：${getErrorMessage(error)}`,
        },
      ]);
    } finally {
      setApplyingMessageId(null);
    }
  }, [applyingMessageId]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = {
      id: makeMessageId('user'),
      role: 'user',
      text: trimmed,
    };
    const loadingMessageId = makeMessageId('assistant-loading');

    setInput('');
    setIsSending(true);
    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: loadingMessageId,
        role: 'assistant',
        text: '正在思考',
        isLoading: true,
      },
    ]);

    try {
      if (!isAIConfigured()) {
        throw new Error('No AI API key found.');
      }

      const result = await streamTaskBreakdown(trimmed);
      const suggestions = Array.isArray(result.sub_tasks) ? result.sub_tasks : [];

      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessageId
            ? {
                id: makeMessageId('assistant'),
                role: 'assistant',
                text: buildAssistantText(suggestions),
                suggestions,
              }
            : message,
        ),
      );
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessageId
            ? {
                id: makeMessageId('assistant-error'),
                role: 'assistant',
                text: getErrorMessage(error),
              }
            : message,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }, [input, isSending]);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isUser = item.role === 'user';
      const canApply =
        !isUser &&
        !item.isLoading &&
        !item.applied &&
        Array.isArray(item.suggestions) &&
        item.suggestions.length > 0;
      const isApplying = applyingMessageId === item.id;

      return (
        <View
          style={[
            styles.messageRow,
            isUser ? styles.messageRowUser : styles.messageRowAssistant,
          ]}
        >
          {!isUser ? (
            <View style={styles.avatar}>
              <Ionicons name="sparkles-outline" size={16} color={COLORS.accentStrong} />
            </View>
          ) : null}

          <View
            style={[
              styles.bubble,
              isUser ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text style={styles.messageText}>{item.text}</Text>
            {item.isLoading ? <TypingDots /> : null}

            {canApply ? (
              <Pressable
                onPress={() => applySuggestions(item)}
                disabled={isApplying}
                style={({ pressed }) => [
                  styles.applyButton,
                  pressed && !isApplying ? styles.applyButtonPressed : null,
                  isApplying ? styles.applyButtonDisabled : null,
                ]}
                accessibilityRole="button"
                accessibilityState={{ busy: isApplying, disabled: isApplying }}
              >
                {isApplying ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="checkmark-done-outline" size={16} color="#FFFFFF" />
                )}
                <Text style={styles.applyButtonText}>
                  {isApplying ? '应用中' : '一键应用到我的日程/待办'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    },
    [applyingMessageId, applySuggestions],
  );

  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      {
        paddingBottom: 24,
      },
    ],
    [],
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 12}
        style={styles.container}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="sparkles-outline" size={20} color={COLORS.accentStrong} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>MyBrain 智能助理</Text>
            <Text style={styles.headerSub}>AI Copilot</Text>
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          style={styles.list}
          contentContainerStyle={listContentStyle}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToEnd}
        />

        <View style={[styles.inputDock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.composer}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="向助理发消息..."
              placeholderTextColor={COLORS.placeholder}
              style={styles.input}
              multiline
              maxLength={500}
              returnKeyType="send"
              blurOnSubmit
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSending}
              onSubmitEditing={handleSend}
            />

            <Pressable
              onPress={handleSend}
              disabled={!canSend}
              style={({ pressed }) => [
                styles.sendButton,
                !canSend ? styles.sendButtonDisabled : null,
                pressed && canSend ? styles.sendButtonPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityState={{ busy: isSending, disabled: !canSend }}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="send" size={18} color="#FFFFFF" />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.userBubble,
    borderWidth: 1,
    borderColor: '#E0D6F7',
  },
  headerCopy: {
    marginLeft: 12,
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.title,
    letterSpacing: 0,
  },
  headerSub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.sub,
    letterSpacing: 0,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  messageRow: {
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowAssistant: {
    justifyContent: 'flex-start',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: COLORS.userBubble,
    borderColor: '#E0D6F7',
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    backgroundColor: COLORS.aiBubble,
    borderColor: COLORS.border,
    borderBottomLeftRadius: 6,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.title,
    fontWeight: '500',
    letterSpacing: 0,
  },
  typingDots: {
    height: 18,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
    backgroundColor: COLORS.accentStrong,
  },
  applyButton: {
    marginTop: 12,
    minHeight: 38,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentStrong,
  },
  applyButtonPressed: {
    opacity: 0.84,
    transform: [{ translateY: 1 }],
  },
  applyButtonDisabled: {
    opacity: 0.72,
  },
  applyButtonText: {
    marginLeft: 6,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  inputDock: {
    paddingHorizontal: 14,
    paddingTop: 12,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: '#F0EEF5',
  },
  composer: {
    minHeight: 56,
    maxHeight: 122,
    borderRadius: 18,
    paddingLeft: 15,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: '#E7DDF4',
    ...Platform.select({
      ios: {
        shadowColor: '#8E7AA6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 108,
    paddingTop: Platform.OS === 'ios' ? 14 : 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 8,
    paddingRight: 12,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: COLORS.title,
    letterSpacing: 0,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    marginBottom: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentStrong,
  },
  sendButtonPressed: {
    opacity: 0.86,
    transform: [{ translateY: 1 }],
  },
  sendButtonDisabled: {
    backgroundColor: '#D8D0E7',
  },
});
