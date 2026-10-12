// =============================================================================
// Expo app configuration (replaces app.json so we can read environment values).
// =============================================================================
// Every text below that ends in "UsageDescription" or "Permission" is what
// iOS / Android shows when the app asks for access. Apple REJECTS apps whose
// descriptions are vague, so each one says exactly why the app needs it.
// =============================================================================
import type { ConfigContext, ExpoConfig } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';

// Paste the ID printed by "eas init" here (it is not a secret).
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || 'PASTE-EAS-PROJECT-ID-HERE';

const LOCATION_WHEN_IN_USE =
  'MB Patrol uses your location to confirm you are at each checkpoint when you scan it, and to send your position with an SOS alert.';
const LOCATION_ALWAYS =
  'During an active shift only, MB Patrol records your location in the background so supervisors can see patrol progress and respond to an SOS. Tracking stops when you end your shift.';
const CAMERA = 'MB Patrol uses the camera to scan checkpoint QR codes and barcodes, and to take photos of issues found on patrol.';
const PHOTOS = 'MB Patrol lets you attach an existing photo to a patrol report. Photos taken before your shift are marked for review.';
const MICROPHONE = 'MB Patrol records optional voice memos (up to 2 minutes) that you attach to a checkpoint report.';
const NFC = 'MB Patrol reads NFC checkpoint tags to record that you visited each checkpoint.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? 'MB Patrol (Dev)' : 'MB Patrol',
  slug: 'muscat-bay-patrol',
  owner: process.env.EXPO_OWNER || undefined,
  scheme: 'mbpatrol',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F7F8F9',
  ios: {
    bundleIdentifier: IS_DEV ? 'com.muscatbay.patrol.dev' : 'com.muscatbay.patrol',
    buildNumber: '1',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_WHEN_IN_USE,
      NSLocationAlwaysAndWhenInUseUsageDescription: LOCATION_ALWAYS,
      NSCameraUsageDescription: CAMERA,
      NSPhotoLibraryUsageDescription: PHOTOS,
      NSMicrophoneUsageDescription: MICROPHONE,
      NFCReaderUsageDescription: NFC,
      UIBackgroundModes: ['location'],
      ITSAppUsesNonExemptEncryption: false,
    },
    // Apple "privacy manifest": declares why low-level APIs are used.
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
      ],
    },
  },
  android: {
    package: IS_DEV ? 'com.muscatbay.patrol.dev' : 'com.muscatbay.patrol',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FFFFFF',
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.NFC',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.VIBRATE',
    ],
    // We never write to shared storage, so block the legacy permission.
    blockedPermissions: [
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    ],
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-font',
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', imageWidth: 220, backgroundColor: '#FFFFFF' },
    ],
    [
      'expo-camera',
      { cameraPermission: CAMERA, recordAudioAndroid: false },
    ],
    [
      'expo-image-picker',
      { photosPermission: PHOTOS, cameraPermission: CAMERA, microphonePermission: false },
    ],
    ['expo-audio', { microphonePermission: MICROPHONE, enableBackgroundPlayback: false, enableBackgroundRecording: false }],
    [
      'expo-location',
      {
        locationWhenInUsePermission: LOCATION_WHEN_IN_USE,
        locationAlwaysAndWhenInUsePermission: LOCATION_ALWAYS,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    ['react-native-nfc-manager', { nfcPermission: NFC, includeNdefEntitlement: true }],
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        url: 'https://sentry.io/',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: EAS_PROJECT_ID.startsWith('PASTE') ? {} : { projectId: EAS_PROJECT_ID },
  },
});
