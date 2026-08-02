const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

/**
 * withFlyerNotificationIcon
 *
 * Gives FCM notifications a real icon and accent colour on Android.
 *
 * Without this, a data-and-notification message shows the app icon downscaled
 * and flattened to a grey square, because Android tints the small icon by its
 * alpha channel and throws the colours away. The fix is a white-on-transparent
 * silhouette plus a `meta-data` pointer so Firebase's own display path picks it
 * up — including for messages that arrive while the app is killed, which never
 * reach JS and so can't be styled from there.
 *
 * `expo-notifications` would do this, but it is not a dependency: the project
 * uses @react-native-firebase/messaging directly, and adding a second
 * notification stack to set one icon is not a trade worth making.
 */

const ICON_NAME = 'ic_notification';
const ACCENT_NAME = 'flyer_notification_accent';
const ACCENT_VALUE = '#FF25D366';

// mdpi through xxxhdpi. The source is 256px square, so each bucket is a plain
// downscale of it; 24dp is the size Android actually renders in the status bar.
const DENSITIES = {
  mdpi: 24,
  hdpi: 36,
  xhdpi: 48,
  xxhdpi: 72,
  xxxhdpi: 96,
};

const SOURCE = 'assets/notification-icon.png';

/** Copy the silhouette into every drawable-*dpi bucket. */
function withIconAsset(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, SOURCE);
      if (!fs.existsSync(src)) {
        throw new Error(
          `withFlyerNotificationIcon: ${SOURCE} is missing. Run \`python3 tools/gen-assets.py\`.`
        );
      }

      // Resizing needs a native image lib. sharp ships with the Expo CLI, so
      // require it lazily and fall back to copying the full-size asset rather
      // than failing the build over icon crispness.
      let sharp = null;
      try {
        sharp = require('sharp');
      } catch {
        sharp = null;
      }

      const res = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res');

      await Promise.all(
        Object.entries(DENSITIES).map(async ([density, size]) => {
          const dir = path.join(res, `drawable-${density}`);
          fs.mkdirSync(dir, { recursive: true });
          const dest = path.join(dir, `${ICON_NAME}.png`);

          if (sharp) await sharp(src).resize(size, size).png().toFile(dest);
          else fs.copyFileSync(src, dest);
        })
      );

      return cfg;
    },
  ]);
}

/** Point Firebase at the icon and accent colour. */
function withManifestMetaData(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('withFlyerNotificationIcon: no <application> in the manifest.');

    app['meta-data'] = app['meta-data'] ?? [];

    const set = (name, attr, value) => {
      const existing = app['meta-data'].find((m) => m.$['android:name'] === name);
      const entry = existing ?? { $: { 'android:name': name } };
      // Strip the other value attribute so a re-run cannot leave both set.
      delete entry.$['android:value'];
      delete entry.$['android:resource'];
      entry.$[attr] = value;
      if (!existing) app['meta-data'].push(entry);
    };

    set(
      'com.google.firebase.messaging.default_notification_icon',
      'android:resource',
      `@drawable/${ICON_NAME}`
    );
    set(
      'com.google.firebase.messaging.default_notification_color',
      'android:resource',
      `@color/${ACCENT_NAME}`
    );

    return cfg;
  });
}

/**
 * Declare the accent colour. Written straight to colors.xml rather than via
 * withAndroidColors so it cannot collide with the colours Expo manages there.
 */
function withAccentColour(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/res/values'
      );
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'colors.xml');

      const entry = `    <color name="${ACCENT_NAME}">${ACCENT_VALUE}</color>`;
      let xml = fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8')
        : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';

      if (xml.includes(`name="${ACCENT_NAME}"`)) {
        xml = xml.replace(
          new RegExp(`\\s*<color name="${ACCENT_NAME}">[^<]*</color>`),
          `\n${entry}`
        );
      } else {
        xml = xml.replace('</resources>', `${entry}\n</resources>`);
      }

      fs.writeFileSync(file, xml);
      return cfg;
    },
  ]);
}

module.exports = function withFlyerNotificationIcon(config) {
  return withAccentColour(withManifestMetaData(withIconAsset(config)));
};
