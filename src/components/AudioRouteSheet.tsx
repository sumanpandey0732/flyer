import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { darkTheme } from '@/src/theme/theme';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { routeLabel, type AudioRoute } from '@/src/services/AudioRoute';

/**
 * Output picker for an in-progress call.
 *
 * Rendered against the dark call palette rather than the app theme, because it
 * is presented over a live video feed like the rest of the call chrome.
 *
 * Only shown when there is a genuine choice to make: with no headset connected
 * the speaker button already covers both routes, and a picker containing two
 * items is a worse version of the toggle it replaced.
 */

/**
 * Shared with the call screen's route button so the icon on the button always
 * matches the icon of the row it opens.
 */
export const ROUTE_ICON: Record<AudioRoute, IconName> = {
  EARPIECE: 'earpiece',
  SPEAKER_PHONE: 'speaker',
  BLUETOOTH: 'bluetooth',
  WIRED_HEADSET: 'headset',
};

const surface = darkTheme.colors;

interface Props {
  visible: boolean;
  routes: AudioRoute[];
  selected: AudioRoute | null;
  onSelect: (route: AudioRoute) => void;
  onClose: () => void;
}

export function AudioRouteSheet({ visible, routes, selected, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows presses so tapping the sheet body does not dismiss it. */}
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}
          onPress={() => {}}
        >
          <View style={styles.grabber} />
          <Text style={styles.title}>Audio output</Text>

          {routes.map((route) => {
            const active = route === selected;
            return (
              <Pressable
                key={route}
                onPress={() => {
                  onSelect(route);
                  onClose();
                }}
                haptic
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={routeLabel(route)}
                style={styles.row}
              >
                <Icon
                  name={ROUTE_ICON[route]}
                  size={22}
                  color={active ? darkTheme.colors.accent : surface.text}
                />
                <Text
                  style={[
                    styles.label,
                    { color: active ? darkTheme.colors.accent : surface.text },
                  ]}
                >
                  {routeLabel(route)}
                </Text>
                {active ? (
                  <Icon name="check" size={20} color={darkTheme.colors.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: surface.bgElevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: surface.border,
    marginBottom: 12,
  },
  title: {
    color: surface.textMuted,
    fontSize: darkTheme.font.small,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    height: 54,
  },
  label: { flex: 1, fontSize: darkTheme.font.body },
});
