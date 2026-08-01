import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { Message, ReplyRef } from '@/src/config/types';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Limits } from '@/src/config/env';
import {
  VoiceRecorder,
  formatDuration,
  type PickedMedia,
} from '@/src/services/MediaManager';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { RecordingDot, RecordingWaveform } from './RecordingWaveform';
import { AttachSheet } from './AttachSheet';
import { EmojiRow } from './EmojiRow';

interface Props {
  onSendText: (text: string) => void;
  onSendMedia: (media: PickedMedia[]) => void;
  onSendVoice: (uri: string, durationMs: number) => void;
  onTyping: () => void;
  replyTo: ReplyRef | null;
  onClearReply: () => void;
  editing: Message | null;
  onCommitEdit: (text: string) => void;
  onCancelEdit: () => void;
  /** Rendered instead of the input when the peer has blocked us / we blocked them. */
  disabledReason?: string | null;
}

/**
 * The message composer.
 *
 * Voice notes use tap-to-start / tap-to-stop rather than press-and-hold. Hold
 * gestures fight the keyboard and the scroll view on Android and drop
 * recordings when the finger slips; an explicit recording bar with cancel and
 * send is unambiguous and survives interruption.
 */
export function Composer({
  onSendText,
  onSendMedia,
  onSendVoice,
  onTyping,
  replyTo,
  onClearReply,
  editing,
  onCommitEdit,
  onCancelEdit,
  disabledReason,
}: Props) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const recorder = useRef(new VoiceRecorder()).current;
  const inputRef = useRef<TextInput>(null);

  // Entering edit mode preloads the existing text and focuses the field.
  useEffect(() => {
    if (editing) {
      setText(editing.text ?? '');
      inputRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // Releasing the mic if the composer unmounts mid-recording, otherwise the
  // audio session stays claimed and the next call has no microphone.
  useEffect(() => {
    return () => {
      if (recorder.isRecording) void recorder.cancel();
    };
  }, [recorder]);

  const handleChange = useCallback(
    (value: string) => {
      setText(value);
      if (value.length > 0) onTyping();
    },
    [onTyping]
  );

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (editing) {
      onCommitEdit(trimmed);
    } else {
      onSendText(trimmed);
    }
    setText('');
    setEmojiOpen(false);
  };

  const startRecording = async () => {
    setEmojiOpen(false);
    const ok = await recorder.start(
      (sample) => {
        setLevel(sample.level);
        setElapsed(sample.durationMs);
      },
      () => {
        // Hit the 2-minute ceiling; send what we have rather than discarding it.
        void stopRecording(true);
      }
    );
    if (ok) {
      setRecording(true);
      setElapsed(0);
    }
  };

  const stopRecording = async (send: boolean) => {
    const result = await recorder.stop();
    setRecording(false);
    setLevel(0);
    setElapsed(0);

    if (!result) return;
    // Sub-second taps are almost always accidental.
    if (send && result.durationMs > 700) {
      onSendVoice(result.uri, result.durationMs);
    }
  };

  const cancelRecording = async () => {
    await recorder.cancel();
    setRecording(false);
    setLevel(0);
    setElapsed(0);
  };

  if (disabledReason) {
    return (
      <View style={[styles.blocked, { backgroundColor: theme.colors.surfaceAlt }]}>
        <Icon name="block" size={14} color={theme.colors.textMuted} />
        <Text style={[styles.blockedText, { color: theme.colors.textMuted }]}>
          {disabledReason}
        </Text>
      </View>
    );
  }

  // --- recording bar ------------------------------------------------------
  if (recording) {
    const nearLimit = elapsed > Limits.voiceNoteMaxMs - 15_000;

    return (
      <View style={[styles.wrapper, { backgroundColor: theme.colors.surface }]}>
        <View style={[styles.recordBar, { backgroundColor: theme.colors.bgElevated }]}>
          <Pressable onPress={cancelRecording} round={40} haptic>
            <Icon name="trash" size={19} color={theme.colors.danger} />
          </Pressable>

          <RecordingDot />
          <Text
            style={[
              styles.recordTime,
              { color: nearLimit ? theme.colors.danger : theme.colors.text },
            ]}
          >
            {formatDuration(elapsed)}
          </Text>

          <RecordingWaveform level={level} color={theme.colors.accent} />

          <Pressable
            onPress={() => stopRecording(true)}
            round={44}
            haptic
            style={{ backgroundColor: theme.colors.accent, borderRadius: 22 }}
          >
            <Icon name="send" size={18} color={theme.colors.accentText} />
          </Pressable>
        </View>
      </View>
    );
  }

  const canSend = text.trim().length > 0;

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.colors.surface }]}>
      {/* reply / edit context bar */}
      {replyTo || editing ? (
        <View
          style={[
            styles.contextBar,
            { backgroundColor: theme.colors.bgElevated, borderLeftColor: theme.colors.accent },
          ]}
        >
          <View style={styles.contextText}>
            <Text style={[styles.contextTitle, { color: theme.colors.accent }]}>
              {editing ? 'Editing message' : 'Replying'}
            </Text>
            <Text
              style={[styles.contextPreview, { color: theme.colors.textMuted }]}
              numberOfLines={1}
            >
              {editing ? (editing.text ?? '') : (replyTo?.preview ?? '')}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              if (editing) {
                onCancelEdit();
                setText('');
              } else {
                onClearReply();
              }
            }}
            round={34}
          >
            <Icon name="close" size={16} color={theme.colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {emojiOpen ? (
        <EmojiRow
          onPick={(emoji) => {
            setText((prev) => prev + emoji);
            onTyping();
          }}
        />
      ) : null}

      <View style={styles.inputRow}>
        <View style={[styles.inputPill, { backgroundColor: theme.colors.bgElevated }]}>
          <Pressable onPress={() => setEmojiOpen((v) => !v)} round={36}>
            <Icon
              name="emoji"
              size={21}
              color={emojiOpen ? theme.colors.accent : theme.colors.textMuted}
            />
          </Pressable>

          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={handleChange}
            placeholder={editing ? 'Edit message' : 'Message'}
            placeholderTextColor={theme.colors.textFaint}
            style={[styles.input, { color: theme.colors.text }]}
            multiline
            maxLength={4096}
            onFocus={() => setEmojiOpen(false)}
            accessibilityLabel="Message input"
          />

          {!editing ? (
            <Pressable onPress={() => setAttachOpen(true)} round={36}>
              <Icon name="attach" size={22} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={canSend ? submit : startRecording}
          round={46}
          haptic
          style={[styles.sendButton, { backgroundColor: theme.colors.accent }]}
          accessibilityLabel={canSend ? 'Send message' : 'Record voice note'}
        >
          <Icon
            name={canSend ? 'send' : 'mic'}
            size={canSend ? 18 : 20}
            color={theme.colors.accentText}
          />
        </Pressable>
      </View>

      <AttachSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPicked={(media) => {
          setAttachOpen(false);
          if (media.length > 0) onSendMedia(media);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: 6, paddingTop: 4, paddingBottom: 6 },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 24,
    paddingHorizontal: 2,
    minHeight: 46,
    maxHeight: 130,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 2,
    maxHeight: 120,
  },
  sendButton: { borderRadius: 23, marginBottom: 0 },

  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderRadius: 6,
    paddingLeft: 8,
    paddingRight: 2,
    paddingVertical: 5,
    marginBottom: 5,
    marginHorizontal: 2,
  },
  contextText: { flex: 1 },
  contextTitle: { fontSize: 12, fontWeight: '600' },
  contextPreview: { fontSize: 13, marginTop: 1 },

  recordBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 26,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  recordTime: { fontSize: 14, fontVariant: ['tabular-nums'], minWidth: 42 },

  blocked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  blockedText: { fontSize: 13, textAlign: 'center' },
});
