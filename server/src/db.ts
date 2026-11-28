import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type Db = Database.Database

// Append-only from here on: never edit an existing entry, add a new one at the end.
const MIGRATIONS: string[] = [
  `CREATE TABLE tokens (hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
   CREATE TABLE songs (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
   CREATE TABLE files (
     song_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('track','cover')),
     path TEXT NOT NULL, hash TEXT, size INTEGER NOT NULL, mime TEXT,
     PRIMARY KEY (song_id, kind));
   CREATE TABLE recordings (
     id TEXT PRIMARY KEY, song_id TEXT NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL,
     file_name TEXT NOT NULL, size INTEGER NOT NULL, duration_sec REAL,
     status TEXT NOT NULL DEFAULT 'processing', mime TEXT, orig_path TEXT, out_path TEXT,
     song_title TEXT NOT NULL DEFAULT '', song_artist TEXT NOT NULL DEFAULT '',
     share_token TEXT UNIQUE);
   CREATE TABLE recording_tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);
   CREATE TABLE uploads (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, parts INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE login_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL);
   CREATE INDEX login_attempts_ip_at ON login_attempts (ip, at);`,
]

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, 'db.sqlite'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
