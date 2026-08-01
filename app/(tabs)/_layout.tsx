import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { selectTotalUnread, useAppStore } from '@/src/services/StateManager';
import { Icon, type IconName } from '@/src/components/Icon';
import { Pressable } from '@/src/components/Pressable';

const TAB_ICONS: Record<string, IconName> = {
  index: 'people',
  calls: 'phone',
  status: 'camera',
};

const TAB_LABELS: Record<string, string> = {
  index: 'Chats',
  calls: 'Calls',
  status: 'Status',
};

/**
 * Custom tab bar rather than the stock one: it is the only way to paint the
 * badge with our own token and to keep the bar's chrome identical to the
 * headers the screens draw themselves.
 */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const totalUnread = useAppStore(selectTotalUnread);

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.bgElevated,
          borderTopColor: theme.colors.border,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const label = TAB_LABELS[route.name] ?? route.name;
        const icon = TAB_ICONS[route.name] ?? 'chevron';
        const badge = route.name === 'index' ? totalUnread : 0;
        const color = focused ? theme.colors.accent : theme.colors.textMuted;

        return (
          <Pressable
            key={route.key}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={
              badge > 0 ? `${label}, ${badge} unread messages` : label
            }
            style={styles.tab}
          >
            <View
              style={[
                styles.iconPill,
                focused ? { backgroundColor: theme.colors.accentDim } : null,
              ]}
            >
              <Icon name={icon} size={20} color={color} />

              {badge > 0 ? (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: theme.colors.unreadBadge,
                      borderColor: theme.colors.bgElevated,
                    },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: theme.colors.accentText }]}>
                    {badge > 99 ? '99+' : badge}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text
              style={[styles.label, { color }, focused ? styles.labelFocused : null]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Chats' }} />
      <Tabs.Screen name="calls" options={{ title: 'Calls' }} />
      <Tabs.Screen name="status" options={{ title: 'Status' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 7,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  iconPill: {
    minWidth: 58,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
  label: { fontSize: 11 },
  labelFocused: { fontWeight: '600' },
});
