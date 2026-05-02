import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { env } from '../env.js';
import { runMigrations } from './migrate.js';

let _db: DatabaseType | null = null;

function resolveDbPath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export function getDb(): DatabaseType {
  if (_db) return _db;

  const path = resolveDbPath(env.DB_PATH);
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
