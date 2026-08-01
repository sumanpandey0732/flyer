import React, { useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  value: string;
  onChangeText: (value: string) => void;
  onClose: () => void;
  placeholder?: string;
}

/**
 * Inline search field. The trailing button clears the term while there is one to
 * clear and dismisses search once the field is empty, so a single thumb position
 * covers both intents.
 */
export function SearchBar({ value, onChangeText, onClose, placeholder = 'Search' }: Props) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);

  const hasText = value.length > 0;

  return (
    <View style={[styles.pill, { backgroundColor: theme.colors.bgElevated }]}>
      <Icon name="search" size={20} color={theme.colors.textMuted} style={styles.leading} />

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textFaint}
        style={[styles.input, { color: theme.colors.text }]}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />

      <Pressable
        onPress={() => {
          if (hasText) {
            onChangeText('');
            inputRef.current?.focus();
          } else {
            onClose();
          }
        }}
        round={36}
        accessibilityLabel={hasText ? 'Clear search' : 'Close search'}
      >
        <Icon name="close" size={16} color={theme.colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    paddingLeft: 12,
    paddingRight: 2,
    minHeight: 44,
  },
  leading: { marginRight: 8 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
});
