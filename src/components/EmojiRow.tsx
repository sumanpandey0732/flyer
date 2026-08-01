import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Pressable } from './Pressable';

/**
 * Lightweight emoji picker.
 *
 * A full picker means bundling a several-hundred-KB emoji dataset plus a search
 * index. The system keyboard already has one, so this is a quick-access strip of
 * the emoji people actually use in chat, which is what the button is for.
 */

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

const PALETTE = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
  '🙂', '😉', '😍', '🥰', '😘', '😗', '😋', '😛', '🤪', '🤨',
  '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞', '😔', '😟', '😕',
  '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
  '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥',
  '🤗', '🤔', '🤭', '🤫', '😬', '🙄', '😯', '😴', '🤤', '😪',
  '👍', '👎', '👌', '✌️', '🤞', '🤝', '👏', '🙌', '🙏', '💪',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💯', '🔥',
  '✨', '🎉', '🎊', '🎁', '🥂', '☕', '🍕', '🍔', '⚽', '🏆',
];

export function EmojiRow({ onPick }: { onPick: (emoji: string) => void }) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bgElevated }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.grid}
      >
        {PALETTE.map((emoji, i) => (
          <Pressable
            key={`${emoji}-${i}`}
            onPress={() => onPick(emoji)}
            style={styles.cell}
            accessibilityLabel={`Insert ${emoji}`}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 190, borderRadius: 12, marginHorizontal: 2, marginBottom: 5 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 6,
  },
  cell: { width: '10%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 24 },
});
