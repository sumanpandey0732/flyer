// `expo/config-plugins` rather than `@expo/config-plugins`: the sub-export is
// guaranteed to be the same copy the installed expo CLI uses to run this plugin.
// Depending on the standalone package directly risks resolving a second, version-
// skewed copy, which is why expo-doctor flags it.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

/**
 * withFlyerCallKeep
 *
 * react-native-callkeep ships no Expo config plugin, so this adds the native
 * Android wiring it needs:
 *
 *   1. Telecom permissions (MANAGE_OWN_CALLS is what lets a non-dialer app
 *      register a self-managed ConnectionService).
 *   2. Android 14 foreground-service-type permissions — without these the OS
 *      throws SecurityException the moment a call service starts.
 *   3. USE_FULL_SCREEN_INTENT — the permission that lets an incoming call take
 *      over the lock screen instead of appearing as a heads-up banner.
 *   4. The VoiceConnectionService declaration itself.
 *   5. MainActivity flags so the activity can be shown over the keyguard and
 *      turn the screen on when a call arrives, plus PiP support for video.
 *
 * iOS needs nothing here: CallKit + PushKit background modes are declared in
 * app.config.ts and the pod is autolinked.
 */

const PERMISSIONS = [
  'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
  'android.permission.MANAGE_OWN_CALLS',
  'android.permission.READ_PHONE_STATE',
  'android.permission.CALL_PHONE',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
  'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
  'android.permission.VIBRATE',
  'android.permission.DISABLE_KEYGUARD',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  // Android 12 split the legacy BLUETOOTH permission. app.config.ts declares
  // MODIFY_AUDIO_SETTINGS, but routing call audio to a headset also needs this
  // one on API 31+: react-native-incall-manager enumerates BT devices to offer
  // the headset as an audio route, and without it that enumeration returns
  // nothing, so the route silently never appears. Lives here rather than in
  // app.config.ts because it is only needed for calls.
  'android.permission.BLUETOOTH_CONNECT',
];

const CONNECTION_SERVICE = 'io.wazo.callkeep.VoiceConnectionService';

/** @param {any} manifest */
function addPermissions(manifest) {
  manifest['uses-permission'] = manifest['uses-permission'] ?? [];
  const existing = new Set(
    manifest['uses-permission'].map((p) => p?.$?.['android:name']).filter(Boolean)
  );
  for (const name of PERMISSIONS) {
    if (!existing.has(name)) {
      manifest['uses-permission'].push({ $: { 'android:name': name } });
      existing.add(name);
    }
  }
}

/** @param {any} application */
function addConnectionService(application) {
  application.service = application.service ?? [];

  const already = application.service.findIndex(
    (s) => s?.$?.['android:name'] === CONNECTION_SERVICE
  );
  if (already !== -1) application.service.splice(already, 1);

  application.service.push({
    $: {
      'android:name': CONNECTION_SERVICE,
      'android:label': 'Flyer calls',
      'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
      'android:foregroundServiceType': 'camera|microphone|phoneCall',
      'android:exported': 'true',
    },
    'intent-filter': [
      {
        action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }],
      },
    ],
  });
}

/** @param {any} activity */
function configureMainActivity(activity) {
  activity.$ = activity.$ ?? {};

  // Show the call screen over the keyguard and wake the display.
  activity.$['android:showWhenLocked'] = 'true';
  activity.$['android:turnScreenOn'] = 'true';
  activity.$['android:launchMode'] = 'singleTask';
  activity.$['android:excludeFromRecents'] = 'false';

  // Picture-in-picture for video calls.
  activity.$['android:supportsPictureInPicture'] = 'true';
  activity.$['android:resizeableActivity'] = 'true';

  // PiP and rotation both resize the activity; without these the activity is
  // recreated mid-call and the RTCPeerConnection is torn down with it.
  const required = [
    'keyboard',
    'keyboardHidden',
    'orientation',
    'screenSize',
    'smallestScreenSize',
    'screenLayout',
    'uiMode',
    'navigation',
  ];
  const current = new Set((activity.$['android:configChanges'] ?? '').split('|').filter(Boolean));
  for (const c of required) current.add(c);
  activity.$['android:configChanges'] = [...current].join('|');
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withFlyerCallKeep = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    addPermissions(manifest);

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    addConnectionService(application);

    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    configureMainActivity(activity);

    return cfg;
  });

module.exports = withFlyerCallKeep;
