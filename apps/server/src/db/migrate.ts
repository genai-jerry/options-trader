import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Database } from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

function loadMigrationFiles(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const match = /^(\d+)_(.+)\.sql$/.exec(f);
      if (!match) {
        throw new Error(`Migration filename does not match NNN_name.sql: ${f}`);
      }
      return {
        version: Number.parseInt(match[1]!, 10),
        name: match[2]!,
        path: join(MIGRATIONS_DIR, f),
      };
    })
    .sort((a, b) => a.version - b.version);
}

export interface MigrationResult {
  applied: { version: number; name: string }[];
  current: number;
}

export function runMigrations(db: Database): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const appliedVersions = new Set(
    db.prepare('SELECT version FROM schema_versions').all().map((r) => (r as { version: number }).version),
  );

  const applied: { version: number; name: string }[] = [];
  for (const m of loadMigrationFiles()) {
    if (appliedVersions.has(m.version)) continue;

    const sql = readFileSync(m.path, 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_versions (version, name) VALUES (?, ?)').run(m.version, m.name);
    });
    tx();
    applied.push({ version: m.version, name: m.name });
  }

  const current = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_versions')
    .get() as { v: number };

  return { applied, current: current.v };
}
