import React from 'react';
import type { TextStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '@/src/theme/ThemeProvider';

/**
 * Icon set.
 *
 * Real vector icons from @expo/vector-icons rather than text glyphs. Emoji
 * render as full-colour bitmaps that ignore the `color` prop, differ wildly
 * between Android and iOS, and never look like a chat app's chrome. These are
 * the Material and Ionicons families — the same single-colour, tintable
 * iconography WhatsApp's own UI is built from.
 *
 * `IconName` is the key set below and every screen depends on it, so add names
 * here rather than importing a family directly at a call site.
 */

type Family = 'ion' | 'material' | 'community';

const ICONS = {
  // navigation / chrome
  back: ['material', 'arrow-back'],
  close: ['material', 'close'],
  search: ['material', 'search'],
  more: ['material', 'more-vert'],
  chevron: ['material', 'chevron-right'],
  plus: ['material', 'add'],
  settings: ['material', 'settings'],
  info: ['material', 'info-outline'],
  privacy: ['material', 'lock-outline'],
  logout: ['material', 'logout'],
  people: ['material', 'people'],
  warning: ['material', 'error-outline'],

  // composer
  send: ['ion', 'send'],
  attach: ['material', 'attach-file'],
  camera: ['material', 'photo-camera'],
  mic: ['material', 'mic'],
  emoji: ['material', 'sentiment-satisfied-alt'],

  // calls
  phone: ['material', 'call'],
  video: ['material', 'videocam'],
  videoOff: ['material', 'videocam-off'],
  micOff: ['material', 'mic-off'],
  speaker: ['material', 'volume-up'],
  switchCamera: ['material', 'flip-camera-ios'],
  endCall: ['material', 'call-end'],
  missedCall: ['material', 'call-missed'],
  outgoingCall: ['material', 'call-made'],
  incomingCall: ['material', 'call-received'],
  pip: ['material', 'picture-in-picture-alt'],

  // delivery state
  check: ['material', 'check'],
  doubleCheck: ['material', 'done-all'],
  clock: ['material', 'access-time'],

  // message actions
  star: ['material', 'star'],
  starOutline: ['material', 'star-border'],
  reply: ['material', 'reply'],
  forward: ['material', 'shortcut'],
  copy: ['material', 'content-copy'],
  trash: ['material', 'delete-outline'],
  edit: ['material', 'edit'],
  mute: ['material', 'notifications-off'],
  unmute: ['material', 'notifications-none'],
  block: ['material', 'block'],
  report: ['material', 'flag'],

  // media playback
  play: ['material', 'play-arrow'],
  pause: ['material', 'pause'],
  download: ['material', 'file-download'],
  retry: ['material', 'refresh'],

  // theme
  moon: ['community', 'weather-night'],
  sun: ['material', 'wb-sunny'],
} satisfies Record<string, readonly [Family, string]>;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  style?: TextStyle;
}

export function Icon({ name, size = 22, color, style }: Props) {
  const theme = useTheme();
  const [family, glyph] = ICONS[name] as readonly [Family, string];
  const tint = color ?? theme.colors.text;

  // Each family is a separate component with its own disjoint name union, so a
  // cast is what lets one lookup table drive all three.
  if (family === 'ion') {
    return (
      <Ionicons
        name={glyph as React.ComponentProps<typeof Ionicons>['name']}
        size={size}
        color={tint}
        style={style}
      />
    );
  }

  if (family === 'community') {
    return (
      <MaterialCommunityIcons
        name={glyph as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
        size={size}
        color={tint}
        style={style}
      />
    );
  }

  return (
    <MaterialIcons
      name={glyph as React.ComponentProps<typeof MaterialIcons>['name']}
      size={size}
      color={tint}
      style={style}
    />
  );
}
