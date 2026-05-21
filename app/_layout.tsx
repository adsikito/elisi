import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { isModuleEnabled } from '@/config/modules';
import { useSettingsStore } from '@/store/settingsStore';

export default function RootLayout() {
  const activeModules = useSettingsStore((s) => s.activeModules);
  const tasksEnabled = isModuleEnabled(activeModules, 'Tasks');
  const copilotEnabled = isModuleEnabled(activeModules, 'Copilot');
  const habitsEnabled = isModuleEnabled(activeModules, 'Habits');
  const expensesEnabled = isModuleEnabled(activeModules, 'Expenses');

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: '#7B4F9D',
            tabBarInactiveTintColor: '#9E9EB0',
            tabBarStyle: {
              borderTopColor: '#ECECF0',
              backgroundColor: '#FFFFFF',
              height: 62,
              paddingTop: 8,
              paddingBottom: 8,
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: '首页',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="grid-outline" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="tasks"
            options={{
              href: tasksEnabled ? undefined : null,
              title: '任务',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="checkbox-outline" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="copilot"
            options={{
              href: copilotEnabled ? undefined : null,
              title: '助手',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="sparkles-outline" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="habits"
            options={{
              href: habitsEnabled ? undefined : null,
              title: '习惯',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="repeat-outline" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="expenses"
            options={{
              href: expensesEnabled ? undefined : null,
              title: '记账',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="wallet-outline" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: '设置',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="settings-outline" size={size} color={color} />
              ),
            }}
          />
        </Tabs>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
