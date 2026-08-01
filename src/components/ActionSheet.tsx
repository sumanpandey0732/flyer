import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';

export interface SheetAction {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  /** May be async; the sheet closes immediately and the work continues. */
  onPress: () => void | Promise<void>;
}

interface Props {
  visible: boolean;
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
}

/**
 * Generic bottom sheet for overflow and long-press menus.
 *
 * Alert.alert() is the usual shortcut for this, but it caps at three buttons on
 * iOS and cannot show icons, so menus built on it diverge between platforms.
 * This renders identically on both.
 *
 * The sheet closes before awaiting the action: several handlers here open a
 * confirm() dialog, and on Android a second modal presented while this one is
 * still mounted is silently dropped.
 */
export function ActionSheet({ visible, title, actions, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        onPress={onClose}
      >
        {/* Swallows presses so tapping the sheet body does not dismiss it. */}
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.bgElevated,
              paddingBottom: Math.max(insets.bottom, 18),
            },
          ]}
          onPress={() => {}}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.border }]} />

          {title ? (
            <Text
              style={[styles.title, { color: theme.colors.textMuted }]}
              numberOfLines={1}
            >
              {title}
            </Text>
          ) : null}

          <ScrollView bounces={false}>
            {actions.map((action) => (
              <Pressable
                key={action.key}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => {
                  onClose();
                  void action.onPress();
                }}
              >
                <Icon
                  name={action.icon}
                  size={20}
                  color={action.destructive ? theme.colors.danger : theme.colors.textMuted}
                />
                <Text
                  style={[
                    styles.actionLabel,
                    { color: action.destructive ? theme.colors.danger : theme.colors.text },
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    maxHeight: '72%',
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 22,
    paddingBottom: 8,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 15,
    paddingHorizontal: 22,
  },
  actionLabel: { fontSize: 16 },
});
