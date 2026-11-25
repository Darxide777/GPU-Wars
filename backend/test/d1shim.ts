// Minimal D1Database shim over node:sqlite so tests run without a Cloudflare runtime.
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Vite strips the node: prefix from static imports of node:sqlite, so load it via require.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

class Stmt {
  private args: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...a: unknown[]) { this.args = a; return this; }
  async run() { this.db.prepare(this.sql).run(...(this.args as never[])); return { success: true }; }
  async first<T>() { return (this.db.prepare(this.sql).get(...(this.args as never[])) as T) ?? null; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[] }; }
}

export function makeDb(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  return { prepare: (sql: string) => new Stmt(db, sql) } as unknown as D1Database;
}
