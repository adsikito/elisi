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
  streamCopilotCommand,
  type CopilotAction,
  type CopilotPlanResult,
} from '@/ai/ByokConnector';
import { createTask, moveTasksByDate } from '@/db';
import { useGridStore } from '@/store/gridStore';
import { useTaskStore } from '@/store/taskStore';

const COLORS = {
  bg: '#FFF9FB',
  panel: '#FFFFFF',
  title: '#333042',
  sub: '#928A9E',
  border: '#EFE4EE',
  lavender: '#EEE8FF',
  lavenderInk: '#8065B8',
  mint: '#DFF8F0',
  mintInk: '#2E8E72',
  peach: '#FFE9DC',
  peachInk: '#B86144',
  sky: '#DDF4FF',
  skyInk: '#2B7EA7',
  rose: '#FFE7EF',
  roseInk: '#C35C7B',
  input: '#FFFDFE',
  disabled: '#D8D0E7',
};

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  plan?: CopilotPlanResult;
  isLoading?: boolean;
  applied?: boolean;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: '你好，我在。',
};

function makeMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildTaskDescription(action: Extract<CopilotAction, { type: 'create_task' }>): string | undefined {
  const parts = [action.description?.trim()].filter(Boolean) as string[];

  if (typeof action.start_period === 'number') {
    parts.push(`第${action.start_period}节`);
  }

  if (typeof action.duration_minutes === 'number') {
    parts.push(`${action.duration_minutes}min`);
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function describeAction(action: CopilotAction): string {
  if (action.type === 'move_tasks_by_date') {
    return `将 ${action.from_date} 的任务推迟到 ${action.to_date}`;
  }

  const parts = [`新增：${action.title}`];
  if (action.due_date) {
    parts.push(action.due_date);
  }
  if (typeof action.start_period === 'number') {
    parts.push(`第${action.start_period}节`);
  }
  return parts.join(' · ');
}

function buildAssistantText(plan: CopilotPlanResult): string {
  if (plan.actions.length === 0) {
    return plan.summary || '我还没有形成可应用的建议。';
  }

  return plan.summary || '我整理好了建议。';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    if (error.message.includes('No ') || error.message.includes('API key')) {
      return '还没有配置 AI 密钥。去设置页保存 BYOK 配置后，我就可以开始处理。';
    }
    return error.message;
  }

  return 'AI 暂时没有响应，请稍后再试。';
}

function TypingDots() {
  const dot1 = useRef(new Animated.Value(0.35)).current;
  const dot2 = useRef(new Animated.Value(0.35)).current;
  const dot3 = useRef(new Animated.Value(0.35)).current;

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
            toValue: 0.35,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.delay(240),
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
                    inputRange: [0.35, 1],
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
  const currentWeek = useGridStore((s) => s.currentWeek);

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

  const applyPlan = useCallback(async (message: ChatMessage) => {
    const actions = message.plan?.actions ?? [];
    if (actions.length === 0 || applyingMessageId) return;

    setApplyingMessageId(message.id);
    try {
      let createdCount = 0;
      let movedCount = 0;

      for (const action of actions) {
        if (action.type === 'create_task') {
          const title = action.title.trim();
          if (!title) continue;

          await createTask({
            title,
            description: buildTaskDescription(action),
            due_date: action.due_date ?? null,
            priority: action.priority ?? 1,
            status: 'pending',
          });
          createdCount += 1;
          continue;
        }

        movedCount += await moveTasksByDate(action.from_date, action.to_date);
      }

      await useTaskStore.getState().loadRootTasks();
      useGridStore.getState().forceRefreshGrid();

      const resultText = [
        createdCount > 0 ? `新增 ${createdCount} 个任务` : null,
        movedCount > 0 ? `移动 ${movedCount} 个任务` : null,
      ]
        .filter(Boolean)
        .join('，');

      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                applied: true,
                text: `${item.text}\n\n已应用${resultText ? `：${resultText}` : '。'}`,
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

    const today = new Date();
    const context = {
      today: formatLocalDate(today),
      tomorrow: formatLocalDate(addDays(today, 1)),
      current_week: currentWeek,
    };
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

      const plan = await streamCopilotCommand(trimmed, context, () => {
        setMessages((current) =>
          current.map((message) =>
            message.id === loadingMessageId
              ? {
                  ...message,
                  text: '正在整理建议',
                }
              : message,
          ),
        );
      });

      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessageId
            ? {
                id: makeMessageId('assistant'),
                role: 'assistant',
                text: buildAssistantText(plan),
                plan,
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
  }, [currentWeek, input, isSending]);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isUser = item.role === 'user';
      const actions = item.plan?.actions ?? [];
      const canApply = !isUser && !item.isLoading && !item.applied && actions.length > 0;
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
              <Ionicons name="sparkles-outline" size={16} color={COLORS.skyInk} />
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

            {actions.length > 0 ? (
              <View style={styles.actionList}>
                {actions.map((action, index) => (
                  <View key={`${item.id}-${index}`} style={styles.actionPill}>
                    <Ionicons
                      name={action.type === 'move_tasks_by_date' ? 'calendar-outline' : 'add-circle-outline'}
                      size={15}
                      color={action.type === 'move_tasks_by_date' ? COLORS.skyInk : COLORS.mintInk}
                    />
                    <Text style={styles.actionText}>{describeAction(action)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {canApply ? (
              <Pressable
                onPress={() => applyPlan(item)}
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
                  {isApplying ? '应用中' : '应用建议'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    },
    [applyingMessageId, applyPlan],
  );

  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: 22 }],
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
            <Ionicons name="sparkles-outline" size={21} color={COLORS.skyInk} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>助手</Text>
            <Text style={styles.headerSub}>MyBrain Copilot</Text>
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>BYOK</Text>
          </View>
        </View>

        <View style={styles.paletteStrip}>
          <View style={[styles.paletteCell, { backgroundColor: COLORS.mint }]} />
          <View style={[styles.paletteCell, { backgroundColor: COLORS.sky }]} />
          <View style={[styles.paletteCell, { backgroundColor: COLORS.peach }]} />
          <View style={[styles.paletteCell, { backgroundColor: COLORS.rose }]} />
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
              placeholder="输入指令..."
              placeholderTextColor="#B8A9C8"
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
    minHeight: 74,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.sky,
    borderWidth: 1,
    borderColor: '#BFE7F7',
  },
  headerCopy: {
    marginLeft: 12,
    flex: 1,
  },
  headerTitle: {
    fontSize: 25,
    fontWeight: '800',
    color: COLORS.title,
    letterSpacing: 0,
  },
  headerSub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.sub,
    letterSpacing: 0,
  },
  statusPill: {
    minHeight: 32,
    borderRadius: 14,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
    backgroundColor: COLORS.mintInk,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.sub,
    letterSpacing: 0,
  },
  paletteStrip: {
    height: 8,
    marginHorizontal: 18,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  paletteCell: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 18,
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
    width: 30,
    height: 30,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  bubble: {
    maxWidth: '84%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: COLORS.lavender,
    borderColor: '#DDD2FB',
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.border,
    borderBottomLeftRadius: 6,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.title,
    fontWeight: '600',
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
    backgroundColor: COLORS.skyInk,
  },
  actionList: {
    marginTop: 12,
  },
  actionPill: {
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.sky,
    borderWidth: 1,
    borderColor: '#BFE7F7',
  },
  actionText: {
    flex: 1,
    marginLeft: 7,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: COLORS.title,
    letterSpacing: 0,
  },
  applyButton: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.skyInk,
  },
  applyButtonPressed: {
    opacity: 0.86,
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
    borderTopColor: '#F1E7F0',
  },
  composer: {
    minHeight: 58,
    maxHeight: 126,
    borderRadius: 18,
    paddingLeft: 15,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: '#8E7AA6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
      },
      android: {
        elevation: 7,
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
    backgroundColor: COLORS.skyInk,
  },
  sendButtonPressed: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.disabled,
  },
});
