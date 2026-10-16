/**
 * Adopt the UIKit scene life cycle.
 *
 * Apps built with the iOS 27 SDK (Xcode 27) refuse to launch without it:
 * "UIScene life cycle is required for apps built with this SDK".
 * Expo SDK 57 ships the scene delegate (`EXExpoAppSceneDelegate`) but its
 * prebuild template does not wire it up yet, so this plugin does two things:
 *
 *  1. Info.plist — declare a single window scene handled by EXExpoAppSceneDelegate.
 *  2. AppDelegate.swift — conform to ExpoReactNativeFactoryProvider and stop
 *     creating the window itself; the scene delegate creates it and starts
 *     React Native into it.
 *
 * Both edits fail the build loudly if the template text changes, rather than
 * shipping an app that silently cannot launch. Remove this plugin once Expo's
 * template adopts scenes itself.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE_CLASS = 'EXExpoAppSceneDelegate';

const CLASS_DECLARATION = 'class AppDelegate: ExpoAppDelegate {';
const CLASS_DECLARATION_WITH_PROVIDER =
  'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';

// The template's window bootstrap inside didFinishLaunchingWithOptions.
const WINDOW_BOOTSTRAP =
  /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*factory\.startReactNative\([\s\S]*?\)\s*#endif\n?/;

function withSceneInfoPlist(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    };
    return mod;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('with-scene-lifecycle: expected a Swift AppDelegate.');
    }

    let contents = mod.modResults.contents;
    if (contents.includes(CLASS_DECLARATION_WITH_PROVIDER)) return mod; // already applied

    if (!contents.includes(CLASS_DECLARATION) || !WINDOW_BOOTSTRAP.test(contents)) {
      throw new Error(
        'with-scene-lifecycle: AppDelegate.swift no longer matches the Expo template. ' +
          'Check whether Expo now adopts the scene life cycle itself and remove this plugin.',
      );
    }

    contents = contents.replace(CLASS_DECLARATION, CLASS_DECLARATION_WITH_PROVIDER);
    contents = contents.replace(
      WINDOW_BOOTSTRAP,
      '    // The window is created by EXExpoAppSceneDelegate (plugins/with-scene-lifecycle.js).\n',
    );
    mod.modResults.contents = contents;
    return mod;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneAppDelegate(withSceneInfoPlist(config));
};
