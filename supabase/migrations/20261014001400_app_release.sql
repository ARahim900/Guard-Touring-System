-- =============================================================================
-- Guard app release notice (Android)
-- =============================================================================
-- Most guard app changes reach the phones automatically through EAS Update.
-- Changes to the app's native code cannot, and Android phones install the app
-- from an APK file (no Google Play), so nothing tells them a new APK exists.
--
-- After each new APK build, an administrator fills in these two settings
-- (Supabase Table Editor -> app_settings -> row 1). Android phones running an
-- older version then show "A new version of MB Patrol is available" on the
-- Work tab, with a button that opens the download link. Leave both empty to
-- show nothing (NULL or an empty value both work). iPhones are updated through TestFlight and ignore them.
--
-- Guards can already read app_settings ("settings: everyone signed in can
-- read"); only admins can change it ("settings: admins update").
-- =============================================================================

alter table public.app_settings
  add column android_latest_version text
    constraint app_settings_android_latest_version_format
    check (android_latest_version = '' or android_latest_version ~ '^[0-9]+(\.[0-9]+){0,3}$'),
  add column android_download_url text
    constraint app_settings_android_download_url_https
    check (android_download_url = '' or android_download_url ~ '^https://');

comment on column public.app_settings.android_latest_version is
  'Newest guard app version available as an APK, e.g. 1.1.0 (the "version" in apps/guard/app.config.ts). '
  'Set by an administrator after each Android APK build. Android phones with an older version show an '
  'update notice. Empty = no notice.';
comment on column public.app_settings.android_download_url is
  'https link to the newest guard app APK (Expo build page or a Supabase Storage file). '
  'Set by an administrator after each Android APK build, together with android_latest_version. '
  'Opened by the "Download" button of the update notice.';
