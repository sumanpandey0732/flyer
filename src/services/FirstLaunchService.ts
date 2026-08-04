import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether this install has been opened before.
 *
 * Used to decide what the login screen shows first: someone opening Flyer for
 * the very first time has no account, so landing them on "Create account" saves
 * a tap and, more importantly, answers the question they actually have. Every
 * launch after that goes to the landing screen, because a returning user who
 * signed out is far more likely to be signing back in.
 *
 * Keyed on the install, not the account — reinstalling legitimately resets it,
 * and there is nothing sensitive here to protect.
 */

const STORAGE_KEY = 'flyer.hasLaunched';

/**
 * True the first time this is called on a fresh install, false forever after.
 *
 * Records the launch as a side effect, so this is not idempotent by design: the
 * caller is the login screen deciding its initial mode, and a second caller
 * would silently get `false` and the wrong screen. There is exactly one call
 * site for that reason.
 *
 * A storage failure resolves to `false` rather than throwing. Being wrong here
 * costs one extra tap; blocking the login screen on a failed read would cost
 * the whole session.
 */
export async function consumeFirstLaunch(): Promise<boolean> {
  try {
    const seen = await AsyncStorage.getItem(STORAGE_KEY);
    if (seen === '1') return false;
    await AsyncStorage.setItem(STORAGE_KEY, '1');
    return true;
  } catch (e) {
    console.warn('[Flyer/first-launch] could not read launch flag', e);
    return false;
  }
}
