import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_MODULES } from '@/config/modules';
import { useSettingsStore } from '@/store/settingsStore';

interface ModulePlaceholderScreenProps {
  moduleId: string;
}

export default function ModulePlaceholderScreen({
  moduleId,
}: ModulePlaceholderScreenProps) {
  const toggleModule = useSettingsStore((s) => s.toggleModule);
  const module = useMemo(
    () => APP_MODULES.find((item) => item.id === moduleId),
    [moduleId],
  );

  if (!module) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View
          style={[
            styles.iconBubble,
            { backgroundColor: module.background, borderColor: module.border },
          ]}
        >
          <Ionicons
            name={module.icon as React.ComponentProps<typeof Ionicons>['name']}
            size={30}
            color={module.accent}
          />
        </View>

        <Text style={styles.title}>{module.title}</Text>
        <Text style={styles.description}>{module.description}</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => toggleModule(module.id, false)}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: module.background, borderColor: module.border },
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={[styles.buttonText, { color: module.accent }]}>
            关闭这个功能
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBubble: {
    width: 82,
    height: 82,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#3D3D4E',
    letterSpacing: 0,
  },
  description: {
    maxWidth: 300,
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: '#8F8FA1',
    textAlign: 'center',
    fontWeight: '600',
  },
  button: {
    marginTop: 28,
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
