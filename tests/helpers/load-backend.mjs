// Loads backend modules into a temp folder with .ts import extensions (the backend's own imports have none, as its tsconfig needs), so game tests can import them.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadBackend(names = ['classes', 'plausible', 'validate']) {
  const dir = mkdtempSync(join(tmpdir(), 'gpuwars-backend-'));
  for (const n of names) writeFileSync(join(dir, n + '.ts'), readFileSync(new URL(`../../backend/src/${n}.ts`, import.meta.url), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'"));
  const out = {};
  for (const n of names) out[n] = await import(pathToFileURL(join(dir, n + '.ts')).href);
  return out;
}
