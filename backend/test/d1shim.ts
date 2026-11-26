// Minimal D1Database shim over node:sqlite so tests run without a Cloudflare runtime.
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

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

/** the migration files in the order wrangler applies them (by name) */
export const MIGRATION_FILES: string[] = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
const readMigration = (file: string): string => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');

/** a fresh in-memory database with the first `count` migrations applied (all of them by default), plus a raw handle for tests that need to insert old rows or apply a later migration */
export function makeDbWithRaw(count: number = MIGRATION_FILES.length): { d1: D1Database; exec: (sql: string) => void; applyMigration: (file: string) => void } {
  const db = new DatabaseSync(':memory:');
  for (const file of MIGRATION_FILES.slice(0, count)) db.exec(readMigration(file));
  return { d1: { prepare: (sql: string) => new Stmt(db, sql) } as unknown as D1Database, exec: (sql) => db.exec(sql), applyMigration: (file) => db.exec(readMigration(file)) };
}

export function makeDb(): D1Database {
  return makeDbWithRaw().d1;
}
