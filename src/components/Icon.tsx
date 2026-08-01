import React from 'react';
import { Text, type TextStyle } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

/**
 * Glyph set.
 *
 * Deliberately text-based rather than an icon font: it keeps the dependency
 * list minimal (no @expo/vector-icons asset pipeline), renders identically on
 * both platforms, and every glyph here is in the standard system font on
 * Android 9+ and iOS 13+.
 */
export const GLYPHS = {
  back: '‹',
  close: '✕',
  search: '⌕',
  send: '➤',
  attach: '＋',
  camera: '⧉',
  mic: '🎙',
  emoji: '☺',
  phone: '📞',
  video: '🎥',
  videoOff: '🚫',
  micOff: '🔇',
  speaker: '🔊',
  switchCamera: '⟲',
  endCall: '✕',
  more: '⋮',
  check: '✓',
  doubleCheck: '✓✓',
  clock: '🕐',
  star: '★',
  starOutline: '☆',
  reply: '↩',
  forward: '↪',
  copy: '⧉',
  trash: '🗑',
  edit: '✎',
  mute: '🔕',
  unmute: '🔔',
  block: '⊘',
  report: '⚑',
  logout: '⇥',
  chevron: '›',
  plus: '＋',
  people: '👥',
  moon: '🌙',
  sun: '☀',
  pause: '❚❚',
  play: '▶',
  download: '⤓',
  retry: '↻',
  warning: '⚠',
  missedCall: '↙',
  outgoingCall: '↗',
  incomingCall: '↘',
  pip: '⧉',
  settings: '⚙',
  privacy: '🔒',
  info: 'ⓘ',
} as const;

export type IconName = keyof typeof GLYPHS;

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  style?: TextStyle;
}

export function Icon({ name, size = 22, color, style }: Props) {
  const theme = useTheme();
  return (
    <Text
      allowFontScaling={false}
      style={[
        { fontSize: size, color: color ?? theme.colors.text, lineHeight: size * 1.2 },
        style,
      ]}
    >
      {GLYPHS[name]}
    </Text>
  );
}
