// Reads the public settings from .env (see .env.example).
// Expo replaces process.env.EXPO_PUBLIC_* with the real values at build time.
// We fail loudly if a required value is missing, because a silent
// misconfiguration in the field is much harder to diagnose.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const env = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  // Muscat Bay security control room (landline 2485 7781). Can be overridden per build.
  controlRoomPhone: process.env.EXPO_PUBLIC_CONTROL_ROOM_PHONE || '+96824857781',
};
