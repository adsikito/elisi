import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { injectMockData } from '@/db/mockData';
import { APP_MODULES } from '@/config/modules';
import {
  DEFAULT_BYOK_BASE_URL,
  DEEPSEEK_BYOK_BASE_URL,
  DEEPSEEK_BYOK_MODEL,
  type ByokProvider,
  useSettingsStore,
} from '@/store/settingsStore';
import { useGridStore } from '@/store/gridStore';
import { useTaskStore } from '@/store/taskStore';

// ── 马卡龙色调 ──
const COLORS = {
  bg: '#FAFAFA',
  card: '#FFFFFF',
  title: '#3D3D4E',
  sub: '#B0B0BE',
  accent: '#C1B3F0',
  accentLight: '#EDE8FD',
  border: '#ECECF0',
  borderFocus: '#C1B3F0',
  warning: '#FF9F43',
  warningLight: '#FFF3E6',
  warningText: '#B85C00',
  danger: '#FF6B6B',
  dangerLight: '#FFF0F0',
  dangerText: '#D63031',
  inputText: '#3D3D4E',
  placeholder: '#C4C4CE',
};

const PROVIDER_OPTIONS: Array<{ label: string; value: ByokProvider }> = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Claude', value: 'claude' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: '自定义', value: 'custom' },
];

const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();

  const semesterStartDate = useSettingsStore((s) => s.semesterStartDate);
  const byokApiKey = useSettingsStore((s) => s.byokApiKey);
  const byokModel = useSettingsStore((s) => s.byokModel);
  const byokBaseUrl = useSettingsStore((s) => s.byokBaseUrl);
  const byokProvider = useSettingsStore((s) => s.byokProvider);
  const activeModules = useSettingsStore((s) => s.activeModules);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const toggleModule = useSettingsStore((s) => s.toggleModule);
  const clearAllData = useSettingsStore((s) => s.clearAllData);

  // ── 本地编辑态（脱离 store 高频写入） ──
  const [dateText, setDateText] = useState(semesterStartDate);
  const [apiKeyText, setApiKeyText] = useState(byokApiKey);
  const [modelText, setModelText] = useState(byokModel);
  const [baseUrlText, setBaseUrlText] = useState(byokBaseUrl);
  const [providerText, setProviderText] = useState<ByokProvider>(byokProvider);

  // ── Focus 状态（边框高亮） ──
  const [dateFocused, setDateFocused] = useState(false);
  const [keyFocused, setKeyFocused] = useState(false);
  const [modelFocused, setModelFocused] = useState(false);
  const [baseUrlFocused, setBaseUrlFocused] = useState(false);
  const [isInjectingMockData, setIsInjectingMockData] = useState(false);

  // ── 保存学期日期 ──
  const saveDate = () => {
    const trimmed = dateText.trim();
    // 基础校验 YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      Alert.alert('日期格式错误', '请输入 YYYY-MM-DD 格式的日期');
      return;
    }
    updateSettings({ semesterStartDate: trimmed });
    Alert.alert('已保存', '更改开学日期将重新计算课表周次');
  };

  // ── 保存 BYOK 配置 ──
  const saveByok = () => {
    updateSettings({
      byokApiKey: apiKeyText.trim(),
      byokModel: modelText.trim(),
      byokBaseUrl: baseUrlText.trim(),
      byokProvider: providerText,
    });
    Alert.alert('已保存', 'AI 引擎配置已更新');
  };

  const selectProvider = (provider: ByokProvider) => {
    setProviderText(provider);
    if (provider === 'deepseek') {
      setBaseUrlText(DEEPSEEK_BYOK_BASE_URL);
      setModelText(DEEPSEEK_BYOK_MODEL);
    }
    if (provider === 'openai' && baseUrlText.trim() === DEEPSEEK_BYOK_BASE_URL) {
      setBaseUrlText(DEFAULT_BYOK_BASE_URL);
    }
  };

  const openApiKeyUrl = useCallback(() => {
    const url =
      providerText === 'deepseek'
        ? 'https://platform.deepseek.com/'
        : 'https://platform.openai.com/api-keys';

    Linking.openURL(url).catch(() => {
      Alert.alert('打开失败', '请稍后重试');
    });
  }, [providerText]);

  const apiKeyLinkText =
    providerText === 'deepseek'
      ? '(https://platform.deepseek.com/)'
      : providerText === 'openai'
        ? '点击这里去 OpenAI 官网申请'
        : '';

  // ── 清空所有数据 ──
  const handleClear = () => {
    Alert.alert(
      '清空所有本地数据',
      '此操作不可撤销，将删除所有课程、任务和个人设置。确定继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认清空',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllData();
              // 同步本地编辑态
              setDateText(useSettingsStore.getState().semesterStartDate);
              setApiKeyText('');
              setModelText('');
              setBaseUrlText(useSettingsStore.getState().byokBaseUrl);
              setProviderText(useSettingsStore.getState().byokProvider);
              Alert.alert('完成', '所有数据已清空');
            } catch {
              Alert.alert('错误', '清空数据时出错，请重试');
            }
          },
        },
      ],
    );
  };

  const handleInjectMockData = useCallback(async () => {
    if (isInjectingMockData) return;

    setIsInjectingMockData(true);
    try {
      await injectMockData();
      await useTaskStore.getState().loadRootTasks();
      useGridStore.getState().forceRefreshGrid();
      Alert.alert('完成', '已注入 100 课 / 300 任务压力测试数据');
    } catch (error) {
      console.error('[SettingsScreen] injectMockData failed:', error);
      Alert.alert(
        '错误',
        error instanceof Error ? error.message : '注入压力测试数据失败，请重试',
      );
    } finally {
      setIsInjectingMockData(false);
    }
  }, [isInjectingMockData]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Modal
        transparent
        animationType="fade"
        visible={isInjectingMockData}
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={COLORS.warning} />
            <Text style={styles.loadingTitle}>正在注入压力测试数据</Text>
            <Text style={styles.loadingSubtext}>100 课 / 300 任务，请稍候。</Text>
          </View>
        </View>
      </Modal>

      {/* 页头 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>设置</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 学期设置 ── */}
        <Text style={styles.sectionLabel}>学期设置</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>开学第一周周一</Text>
          <TextInput
            style={[
              styles.input,
              dateFocused && styles.inputFocused,
            ]}
            value={dateText}
            onChangeText={setDateText}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={COLORS.placeholder}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            onFocus={() => setDateFocused(true)}
            onBlur={() => setDateFocused(false)}
          />
          <Pressable style={styles.saveBtn} onPress={saveDate}>
            <Text style={styles.saveBtnText}>保存</Text>
          </Pressable>
        </View>

        {/* ── 功能实验室 ── */}
        <Text style={styles.sectionLabel}>功能实验室</Text>
        <View style={styles.labCard}>
          {APP_MODULES.map((module, index) => {
            const enabled = activeModules.includes(module.id);
            const isLast = index === APP_MODULES.length - 1;

            return (
              <Pressable
                key={module.id}
                accessibilityRole="switch"
                accessibilityState={{ checked: enabled }}
                onPress={() => toggleModule(module.id)}
                style={[
                  styles.labRow,
                  !isLast ? styles.labRowBorder : null,
                ]}
              >
                <View
                  style={[
                    styles.labIconBubble,
                    {
                      backgroundColor: module.background,
                      borderColor: module.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={module.icon as React.ComponentProps<typeof Ionicons>['name']}
                    size={20}
                    color={module.accent}
                  />
                </View>

                <View style={styles.labCopy}>
                  <Text style={styles.labTitle}>{module.title}</Text>
                  <Text style={styles.labDescription} numberOfLines={2}>
                    {module.description}
                  </Text>
                </View>

                <View onStartShouldSetResponder={() => true}>
                  <Switch
                    value={enabled}
                    onValueChange={(value) => toggleModule(module.id, value)}
                    trackColor={{ false: '#ECECF0', true: module.background }}
                    thumbColor={enabled ? module.accent : '#FFFFFF'}
                    ios_backgroundColor="#ECECF0"
                  />
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* ── AI 引擎配置 ── */}
        <Text style={styles.sectionLabel}>AI 引擎配置 (BYOK)</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>API 服务商</Text>
          <View style={styles.segmented}>
            {PROVIDER_OPTIONS.map((option) => {
              const selected = providerText === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[
                    styles.segmentItem,
                    selected && styles.segmentItemSelected,
                  ]}
                  onPress={() => selectProvider(option.value)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      selected && styles.segmentTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>API Key</Text>
          <TextInput
            style={[
              styles.input,
              keyFocused && styles.inputFocused,
            ]}
            value={apiKeyText}
            onChangeText={setApiKeyText}
            placeholder="sk-..."
            placeholderTextColor={COLORS.placeholder}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setKeyFocused(true)}
            onBlur={() => setKeyFocused(false)}
          />
          {apiKeyLinkText ? (
            <Text
              style={styles.apiKeyLink}
              onPress={openApiKeyUrl}
              accessibilityRole="link"
            >
              {apiKeyLinkText}
            </Text>
          ) : null}

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>API 代理 Base URL</Text>
          <TextInput
            style={[
              styles.input,
              baseUrlFocused && styles.inputFocused,
            ]}
            value={baseUrlText}
            onChangeText={setBaseUrlText}
            placeholder="https://api.openai.com"
            placeholderTextColor={COLORS.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onFocus={() => setBaseUrlFocused(true)}
            onBlur={() => setBaseUrlFocused(false)}
          />

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>模型</Text>
          <TextInput
            style={[
              styles.input,
              modelFocused && styles.inputFocused,
            ]}
            value={modelText}
            onChangeText={setModelText}
            placeholder="gpt-4o-mini / deepseek-chat"
            placeholderTextColor={COLORS.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setModelFocused(true)}
            onBlur={() => setModelFocused(false)}
          />

          <Pressable style={styles.saveBtn} onPress={saveByok}>
            <Text style={styles.saveBtnText}>保存</Text>
          </Pressable>
        </View>

        {/* ── 危险区域 ── */}
        <Text style={[styles.sectionLabel, { marginTop: 40 }]}>危险区域</Text>
        <View style={styles.dangerCard}>
          <Pressable
            style={({ pressed }) => [
              styles.mockBtn,
              pressed && !isInjectingMockData && styles.mockBtnPressed,
              isInjectingMockData && styles.mockBtnDisabled,
            ]}
            onPress={handleInjectMockData}
            disabled={isInjectingMockData}
            accessibilityRole="button"
            accessibilityState={{
              busy: isInjectingMockData,
              disabled: isInjectingMockData,
            }}
          >
            <Text style={styles.mockBtnText}>💥 注入压力测试数据 (100课/300任务)</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.dangerBtn,
              pressed && styles.dangerBtnPressed,
            ]}
            onPress={handleClear}
          >
            <Text style={styles.dangerBtnText}>清空所有本地数据</Text>
          </Pressable>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
};

export default SettingsScreen;

// ── Styles ──

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },

  // ── Section ──
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.sub,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 10,
    marginLeft: 4,
  },

  // ── Card ──
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    // 卡片阴影
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  labCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#6D5B85',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.07,
        shadowRadius: 14,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  labRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  labRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0EEF5',
  },
  labIconBubble: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labCopy: {
    flex: 1,
    minWidth: 0,
  },
  labTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.title,
    letterSpacing: 0,
  },
  labDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: '#9692A3',
  },

  // ── Field ──
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.title,
    marginBottom: 8,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: COLORS.bg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    padding: 3,
    marginBottom: 16,
  },
  segmentItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentItemSelected: {
    backgroundColor: COLORS.accent,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.sub,
  },
  segmentTextSelected: {
    color: '#FFFFFF',
  },
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 15,
    color: COLORS.inputText,
  },
  inputFocused: {
    borderColor: COLORS.borderFocus,
    backgroundColor: COLORS.accentLight,
  },
  apiKeyLink: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.accent,
    lineHeight: 18,
  },

  // ── Save button ──
  saveBtn: {
    marginTop: 16,
    alignSelf: 'flex-end',
    backgroundColor: COLORS.accent,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 20,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // ── Stress inject button ──
  mockBtn: {
    backgroundColor: COLORS.warningLight,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.warning,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  mockBtnPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  mockBtnDisabled: {
    opacity: 0.6,
  },
  mockBtnText: {
    color: COLORS.warningText,
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Danger zone ──
  dangerCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  dangerBtn: {
    backgroundColor: COLORS.dangerLight,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerBtnPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  dangerBtnText: {
    color: COLORS.dangerText,
    fontSize: 15,
    fontWeight: '700',
  },
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(28, 22, 40, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingCard: {
    width: '100%',
    maxWidth: 280,
    borderRadius: 18,
    paddingVertical: 24,
    paddingHorizontal: 20,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  loadingTitle: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.title,
    textAlign: 'center',
  },
  loadingSubtext: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.sub,
    textAlign: 'center',
    lineHeight: 18,
  },
});
