// =============================================================================
// Local SQLite database on the phone: the "outbox".
// =============================================================================
// First principle: a guard often has no signal (basements, pump rooms,
// the far end of the marina). So nothing the guard does goes straight to the
// internet. It is first written here, on the phone, and a separate sync
// process uploads it later. If the app is closed or the phone restarts, the
// outbox survives because SQLite is a file on the phone's storage.
// =============================================================================
import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = openAndMigrate();
  return dbPromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('patrol-outbox.db');
  // WAL mode lets the background location task write while the UI reads.
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS outbox_scans (
      id              TEXT PRIMARY KEY NOT NULL,
      payload         TEXT NOT NULL,           -- JSON arguments for submit_scan
      checkpoint_name TEXT NOT NULL,
      device_time     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',  -- pending | synced | failed
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT,
      validation      TEXT,                    -- server verdict once synced
      flags           TEXT,                    -- JSON array once synced
      created_at      TEXT NOT NULL,
      synced_at       TEXT
    );

    CREATE TABLE IF NOT EXISTS outbox_attachments (
      id            TEXT PRIMARY KEY NOT NULL,
      scan_id       TEXT NOT NULL,
      type          TEXT NOT NULL,             -- photo | audio
      source        TEXT NOT NULL,             -- camera | gallery | microphone
      local_uri     TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      size_bytes    INTEGER,
      duration_sec  REAL,
      captured_at   TEXT NOT NULL,
      exif_taken_at TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT
    );
    CREATE INDEX IF NOT EXISTS outbox_attachments_scan ON outbox_attachments (scan_id);

    CREATE TABLE IF NOT EXISTS outbox_pings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id    TEXT NOT NULL,
      latitude    REAL NOT NULL,
      longitude   REAL NOT NULL,
      accuracy_m  REAL,
      speed_mps   REAL,
      is_mocked   INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox_sos (
      id         TEXT PRIMARY KEY NOT NULL,
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}
