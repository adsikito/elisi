import React, { useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsStore } from '@/store/settingsStore';

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
  danger: '#FF6B6B',
  dangerLight: '#FFF0F0',
  dangerText: '#D63031',
  inputText: '#3D3D4E',
  placeholder: '#C4C4CE',
};

const SettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();

  const semesterStartDate = useSettingsStore((s) => s.semesterStartDate);
  const byokApiKey = useSettingsStore((s) => s.byokApiKey);
  const byokModel = useSettingsStore((s) => s.byokModel);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const clearAllData = useSettingsStore((s) => s.clearAllData);

  // ── 本地编辑态（脱离 store 高频写入） ──
  const [dateText, setDateText] = useState(semesterStartDate);
  const [apiKeyText, setApiKeyText] = useState(byokApiKey);
  const [modelText, setModelText] = useState(byokModel);

  // ── Focus 状态（边框高亮） ──
  const [dateFocused, setDateFocused] = useState(false);
  const [keyFocused, setKeyFocused] = useState(false);
  const [modelFocused, setModelFocused] = useState(false);

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
    });
    Alert.alert('已保存', 'AI 引擎配置已更新');
  };

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
              setDateText(semesterStartDate);
              setApiKeyText('');
              setModelText('');
              Alert.alert('完成', '所有数据已清空');
            } catch {
              Alert.alert('错误', '清空数据时出错，请重试');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
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

        {/* ── AI 引擎配置 ── */}
        <Text style={styles.sectionLabel}>AI 引擎配置 (BYOK)</Text>
        <View style={styles.card}>
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
    letterSpacing: -0.5,
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

  // ── Field ──
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.title,
    marginBottom: 8,
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
});
