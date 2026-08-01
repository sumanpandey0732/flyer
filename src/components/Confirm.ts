import { Alert } from 'react-native';

/**
 * Promise wrappers around Alert so call sites can `await` a decision instead of
 * threading callbacks through their state machine.
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Android's onDismiss can fire after a button handler; latch so the promise
    // settles exactly once.
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    Alert.alert(
      opts.title,
      opts.message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => settle(false) },
        {
          text: opts.confirmLabel ?? 'OK',
          style: opts.destructive ? 'destructive' : 'default',
          onPress: () => settle(true),
        },
      ],
      { cancelable: true, onDismiss: () => settle(false) }
    );
  });
}

export function alertError(title: string, message?: string): void {
  Alert.alert(title, message, [{ text: 'OK', style: 'default' }]);
}
