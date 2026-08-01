import 'react-native-gesture-handler';

// Order matters. The FCM background handler and the CallKeep headless task must
// be registered during the very first JS tick, before the router mounts —
// otherwise Android drops the data message that woke the process and the
// incoming call never rings.
import './src/services/BackgroundTaskManager';

import 'expo-router/entry';
