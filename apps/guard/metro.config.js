// Metro bundles the JavaScript. Sentry's wrapper adds "debug IDs" so crash
// reports point at your real TypeScript lines instead of minified code.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
