import { StatusBar } from 'expo-status-bar';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewMessageEvent } from 'react-native-webview/lib/WebViewTypes';

/**
 * MB Patrol — iPhone shell around the live supervisor portal.
 *
 * The app IS the website: it loads the Netlify portal full-screen, so every
 * deploy of main reaches the phone with no rebuild. The portal does not paint
 * under the notch, so the shell fills the top inset with the purple top-bar
 * colour and the bottom inset with the bottom-bar white.
 */

const APP_URL = 'https://securitymbpatrolling.netlify.app';

// Hosts that stay inside the app. The Supabase host serves password-reset hops.
const IN_APP_HOSTS = new Set(['securitymbpatrolling.netlify.app', 'zdezuylsruzbddqcdhog.supabase.co']);

const PURPLE = '#4E4456';
const PAGE = '#F7F8F9';
const CARD = '#FFFFFF';

// Hide the splash even if the first load never reports back.
const SPLASH_TIMEOUT_MS = 10_000;

// Exports (report PDF/CSV, scan CSV, label images) are made in the page as
// blob: or data: links with a download name. A web view cannot save those, so
// this script hands the file to the app, which opens the iPhone share sheet
// (Save to Files, Mail, AirDrop). Blobs are remembered when created because
// the page may revoke the link straight after clicking it.
const DOWNLOAD_MESSAGE = 'mb-download';
const INJECT_DOWNLOADS = `(function () {
  if (window.__mbDownloads) return;
  window.__mbDownloads = true;
  var blobs = {};
  var create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    var url = create(obj);
    if (obj instanceof Blob) blobs[url] = obj;
    return url;
  };
  var revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = function (url) {
    setTimeout(function () { delete blobs[url]; revoke(url); }, 60000);
  };
  function post(name, mime, data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${DOWNLOAD_MESSAGE}', name: name, mime: mime, data: data }));
  }
  function send(a) {
    var href = a.getAttribute('href') || '';
    var name = a.getAttribute('download') || 'download';
    var match = /^data:([^;,]*)(;base64)?,(.*)$/.exec(href);
    if (match) {
      post(name, match[1] || 'application/octet-stream', match[2] ? match[3] : btoa(unescape(decodeURIComponent(match[3]))));
      return true;
    }
    var blob = blobs[href];
    if (!blob) return false;
    var reader = new FileReader();
    reader.onload = function () { post(name, blob.type || 'application/octet-stream', String(reader.result).split(',')[1] || ''); };
    reader.readAsDataURL(blob);
    return true;
  }
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && send(this)) return;
    return click.apply(this, arguments);
  };
  HTMLAnchorElement.prototype.dispatchEvent = function (event) {
    if (event && event.type === 'click' && this.hasAttribute('download') && send(this)) return false;
    return EventTarget.prototype.dispatchEvent.call(this, event);
  };
  document.addEventListener('click', function (event) {
    var a = event.target && event.target.closest ? event.target.closest('a[download]') : null;
    if (a && send(a)) event.preventDefault();
  }, true);
})();
true;`;

const UTI: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'text/csv': 'public.comma-separated-values-text',
  'image/png': 'public.png',
};

interface DownloadMessage {
  type: typeof DOWNLOAD_MESSAGE;
  name: string;
  mime: string;
  data: string;
}

function isDownloadMessage(value: unknown): value is DownloadMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.type === DOWNLOAD_MESSAGE && typeof m.name === 'string' && typeof m.mime === 'string' && typeof m.data === 'string';
}

async function shareFile({ name, mime, data }: DownloadMessage): Promise<void> {
  // Keep only safe characters: the name comes from the page.
  const safeName = name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'download';
  const file = new File(Paths.cache, safeName);
  file.write(data, { encoding: 'base64' });
  const type = mime.split(';')[0].trim().toLowerCase();
  await Sharing.shareAsync(file.uri, { mimeType: type, UTI: UTI[type], dialogTitle: safeName });
}

void SplashScreen.preventAutoHideAsync();

// React Native's URL polyfill does not implement `hostname`, so parse by hand.
function hostOf(url: string): string | null {
  const match = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return match ? match[1].toLowerCase() : null;
}

function openOutside(url: string): void {
  if (/^https?:/i.test(url)) {
    WebBrowser.openBrowserAsync(url).catch(() => {
      void Linking.openURL(url);
    });
    return;
  }
  Linking.openURL(url).catch(() => {
    Alert.alert('Cannot open link', 'No app on this iPhone can open this link.');
  });
}

function Portal() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const splashHidden = useRef(false);
  const [offline, setOffline] = useState(false);
  // The sign-in page is purple to the bottom edge; staff pages end in the white bottom bar.
  const [onSignIn, setOnSignIn] = useState(false);

  const hideSplash = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    void SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    const timer = setTimeout(hideSplash, SPLASH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [hideSplash]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const host = hostOf(event.nativeEvent.url);
    if (!host || !IN_APP_HOSTS.has(host)) return;
    let message: unknown;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!isDownloadMessage(message)) return;
    shareFile(message).catch(() => {
      Alert.alert('Could not save the file', 'Please try the export again.');
    });
  }, []);

  const handleNavigation = useCallback((request: ShouldStartLoadRequest): boolean => {
    const { url, isTopFrame } = request;
    if (!isTopFrame || /^(about|blob|data):/i.test(url)) return true;

    const host = hostOf(url);
    if (!host) {
      openOutside(url); // tel:, mailto:, maps: …
      return false;
    }
    if (IN_APP_HOSTS.has(host)) return true;

    openOutside(url);
    return false;
  }, []);

  const handleOpenWindow = useCallback((targetUrl: string) => {
    const host = hostOf(targetUrl);
    if (host && IN_APP_HOSTS.has(host)) {
      webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(targetUrl)}; true;`);
      return;
    }
    openOutside(targetUrl);
  }, []);

  const retry = useCallback(() => {
    setOffline(false);
    webViewRef.current?.reload();
  }, []);

  return (
    <View style={[styles.fill, { backgroundColor: CARD }]}>
      <StatusBar style="light" />
      <View style={{ height: insets.top, backgroundColor: PURPLE }} />
      <WebView
        ref={webViewRef}
        source={{ uri: APP_URL }}
        style={[styles.fill, { backgroundColor: PAGE }]}
        originWhitelist={['http://*', 'https://*', 'about:*']}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        sharedCookiesEnabled
        allowsInlineMediaPlayback
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        applicationNameForUserAgent="MBPatrolApp/1.0"
        webviewDebuggingEnabled={__DEV__}
        injectedJavaScriptBeforeContentLoaded={INJECT_DOWNLOADS}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={handleNavigation}
        onOpenWindow={(event) => handleOpenWindow(event.nativeEvent.targetUrl)}
        onNavigationStateChange={(state) => setOnSignIn(/^https?:\/\/[^/]+\/login(?:[/?#]|$)/i.test(state.url))}
        onLoadEnd={hideSplash}
        onLoad={() => setOffline(false)}
        onError={() => {
          setOffline(true);
          hideSplash();
        }}
        // iOS can kill the web process under memory pressure, leaving a blank page.
        onContentProcessDidTerminate={() => webViewRef.current?.reload()}
      />
      <View style={{ height: insets.bottom, backgroundColor: onSignIn ? PURPLE : CARD }} />
      {offline && (
        <View style={[StyleSheet.absoluteFill, styles.centre, { backgroundColor: PAGE }]}>
          <Text style={styles.title}>Cannot reach MB Patrol</Text>
          <Text style={styles.body}>Check your connection, then try again.</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Portal />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  title: { color: PURPLE, fontFamily: 'Georgia', fontSize: 22, fontWeight: '600', letterSpacing: -0.2, textAlign: 'center' },
  body: { color: '#454545', fontSize: 16, textAlign: 'center' },
  button: { backgroundColor: PURPLE, borderRadius: 5, paddingHorizontal: 24, paddingVertical: 12 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
