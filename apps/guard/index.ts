// =============================================================================
// App entry point.
// =============================================================================
// The background location task must be registered before anything else.
// When Android restarts the app in the background mid-shift (to deliver GPS
// points), it runs ONLY this file, not the screens, so registering the task
// inside a screen file would be too late and the points would be lost.
// =============================================================================
import './src/tasks/locationTask';
import 'expo-router/entry';
