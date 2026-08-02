import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Flyer — app config.
 *
 * Values that differ per-environment come from `.env` (see `.env.example`).
 * `EXPO_PUBLIC_*` vars are inlined into the JS bundle by Metro; everything the
 * client needs is public by definition (Cloudinary unsigned preset, OAuth client
 * IDs, Firebase web config). Nothing secret lives here — the FCM service account
 * stays in Cloud Functions.
 */

const PACKAGE = 'com.flyer.chat';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Flyer',
  slug: 'flyer',
  scheme: 'flyer',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  assetBundlePatterns: ['**/*'],
  // Regenerate with `python3 tools/gen-assets.py` if the mark ever changes.
  icon: './assets/icon.png',

  ios: {
    bundleIdentifier: PACKAGE,
    supportsTablet: false,
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist',
    infoPlist: {
      UIBackgroundModes: ['audio', 'voip', 'remote-notification', 'fetch'],
      NSCameraUsageDescription:
        'Flyer uses the camera for video calls and to capture photos and videos you send in chats.',
      NSMicrophoneUsageDescription:
        'Flyer uses the microphone for voice and video calls and to record voice notes.',
      NSPhotoLibraryUsageDescription:
        'Flyer needs access to your photos so you can send images and videos in chats.',
      NSPhotoLibraryAddUsageDescription: 'Flyer saves media you download from chats.',
      ITSAppUsesNonExemptEncryption: false,
    },
    entitlements: {
      'aps-environment': 'production',
    },
  },

  android: {
    package: PACKAGE,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0B141A',
    },
    // The remaining permissions (telecom, full-screen intent, foreground service
    // types) are injected by ./plugins/withFlyerCallKeep so they stay next to the
    // ConnectionService declaration that requires them.
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.VIBRATE',
      'android.permission.WAKE_LOCK',
    ],
  },

  plugins: [
    'expo-router',
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    './plugins/withFlyerNotificationIcon',
    '@config-plugins/react-native-webrtc',
    './plugins/withFlyerCallKeep',
    [
      '@react-native-google-signin/google-signin',
      {
        // Reversed iOS OAuth client ID, e.g. com.googleusercontent.apps.1234-abcd
        iosUrlScheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ?? 'com.googleusercontent.apps.REPLACE_ME',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // react-native-webrtc requires 24+; callkeep's ConnectionService requires 23+.
          minSdkVersion: 24,
          compileSdkVersion: 35,
          targetSdkVersion: 35,
        },
        ios: {
          // Required by @react-native-firebase when not using Swift Package Manager.
          useFrameworks: 'static',
          deploymentTarget: '15.1',
        },
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#0B141A',
        dark: { backgroundColor: '#0B141A' },
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Flyer needs access to your photos so you can send images and videos in chats.',
        cameraPermission: 'Flyer uses the camera to capture photos and videos you send in chats.',
      },
    ],
    [
      'expo-av',
      { microphonePermission: 'Flyer uses the microphone to record voice notes.' },
    ],
  ],

  experiments: {
    typedRoutes: true,
  },
 
  extra: {
    router: {},
    // No fallback id.  A placeholder here is worse than nothing: `eas init` reads
    // this field to decide whether the project is already linked, so a fake uuid
    // makes it skip linking and then fail looking the fake up.  Left undefined,
    // `eas init` creates the project and prints the real id, which goes in `.env`.
    eas: {
      projectId: 'bc34843e-825a-4f6d-a88c-0e185184792a',
    },
  },
});
