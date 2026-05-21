import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
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
              title: '任务',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="checkbox-outline" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="copilot"
            options={{
              title: '助手',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="sparkles-outline" size={size} color={color} />
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
