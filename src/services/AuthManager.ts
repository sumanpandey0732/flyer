import auth from '@react-native-firebase/auth';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Env } from '@/src/config/env';
import { DEFAULT_PRIVACY, type UserProfile } from '@/src/config/types';
import { Paths, fanOut, readOnce, serverTimestamp, update } from './FirebaseService';

/**
 * AuthManager — Google Sign-In only.
 *
 * Note on the deviation from "Expo AuthSession": we use the native Google
 * Sign-In module rather than AuthSession because the rest of the app depends on
 * @react-native-firebase (required for the FCM background handler that rings
 * incoming calls on a killed app). Mixing the Firebase JS SDK's auth state with
 * RNFirebase's native auth state produces two independent sessions, and the
 * native listeners would not see the JS SDK's user. AuthSession would still work
 * for obtaining an idToken, but the native module additionally gives us silent
 * re-auth on cold start, which is what makes "auto login persistence" reliable.
 */

let configured = false;

export function configureGoogleSignIn() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: Env.googleWebClientId,
    iosClientId: Env.googleIosClientId || undefined,
    offlineAccess: false,
    scopes: ['profile', 'email'],
  });
  configured = true;
}

export class GoogleSignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'GoogleSignInCancelled';
  }
}

/** Interactive sign-in. Throws GoogleSignInCancelled if the user backs out. */
export async function signInWithGoogle(): Promise<FirebaseAuthTypes.User> {
  configureGoogleSignIn();

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  let idToken: string | null = null;
  try {
    const result = await GoogleSignin.signIn();
    // v13 returns { type, data }, older returns the user object directly.
    // Handle both so a minor bump doesn't silently break login.
    const anyResult = result as unknown as {
      type?: string;
      data?: { idToken?: string | null };
      idToken?: string | null;
    };
    if (anyResult.type === 'cancelled') throw new GoogleSignInCancelled();
    idToken = anyResult.data?.idToken ?? anyResult.idToken ?? null;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === statusCodes.SIGN_IN_CANCELLED) throw new GoogleSignInCancelled();
    throw e;
  }

  if (!idToken) {
    // Almost always a webClientId/SHA-1 mismatch rather than a transient error.
    throw new Error(
      'Google returned no idToken. Check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and that ' +
        'your release/debug SHA-1 fingerprints are registered in the Firebase console.'
    );
  }

  const credential = auth.GoogleAuthProvider.credential(idToken);
  const { user } = await auth().signInWithCredential(credential);
  await upsertProfile(user);
  return user;
}

/**
 * Create the profile on first login; on subsequent logins refresh only the
 * fields Google owns. Name/photo/about are deliberately NOT overwritten if the
 * user has edited them locally — otherwise every login would revert their edits.
 */
export async function upsertProfile(user: FirebaseAuthTypes.User): Promise<void> {
  const existing = await readOnce<UserProfile>(Paths.user(user.uid));

  if (!existing) {
    await update(Paths.user(user.uid), {
      uid: user.uid,
      name: user.displayName ?? user.email?.split('@')[0] ?? 'Flyer user',
      email: user.email ?? '',
      photoURL: user.photoURL ?? null,
      about: 'Available',
      online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
      privacy: DEFAULT_PRIVACY,
    });
    return;
  }

  await update(Paths.user(user.uid), {
    email: user.email ?? existing.email,
    online: true,
    lastSeen: serverTimestamp(),
    // Backfill for profiles created before these fields existed.
    privacy: existing.privacy ?? DEFAULT_PRIVACY,
    about: existing.about ?? 'Available',
  });
}

/** Restores a session silently on cold start. Returns null when signed out. */
export function currentUser(): FirebaseAuthTypes.User | null {
  return auth().currentUser;
}

export function onAuthChanged(
  cb: (user: FirebaseAuthTypes.User | null) => void
): () => void {
  return auth().onAuthStateChanged(cb);
}

/**
 * Full sign-out. Order matters: clear presence and the push token while we
 * still have write permission, then drop the Firebase session.
 */
export async function signOut(uid: string, token: string | null): Promise<void> {
  const updates: Record<string, unknown> = {
    [`${Paths.userPresence(uid)}`]: false,
    [`${Paths.userLastSeen(uid)}`]: serverTimestamp(),
  };
  // Stripping the token stops this device receiving pushes for an account it is
  // no longer signed into.
  if (token) updates[Paths.userToken(uid, token)] = null;

  try {
    await fanOut(updates);
  } catch (e) {
    console.warn('[Flyer/auth] failed to clear presence on sign-out', e);
  }

  try {
    configureGoogleSignIn();
    await GoogleSignin.signOut();
  } catch {
    // Non-fatal: the Firebase sign-out below is what actually ends the session.
  }

  await auth().signOut();
}

export async function deleteAccount(uid: string): Promise<void> {
  await fanOut({
    [Paths.user(uid)]: null,
    [Paths.userTokens(uid)]: null,
    [Paths.starred(uid)]: null,
    [Paths.blocks(uid)]: null,
    [Paths.callHistory(uid)]: null,
    [Paths.contacts(uid)]: null,
    [Paths.requests(uid)]: null,
    [Paths.sentRequests(uid)]: null,
  });
  await auth().currentUser?.delete();
}
