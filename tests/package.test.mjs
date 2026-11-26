// The itch.io package: npm run package writes dist/gpuwars-itch.zip with index.html at the root, the bundle and the one song, nothing external, no sourcemaps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { buildZip, readZip, crc32 } from '../tools/zip.mjs';
import { checkFiles, collectFiles, ITCH } from '../tools/package.mjs';

const root = new URL('../', import.meta.url);
test('the zip writer round-trips files (deflated and stored) with their crc', () => {
  const files = [{ name: 'a/b.txt', data: Buffer.from('hello hello hello hello hello') }, { name: 'c.bin', data: Buffer.from([1, 2, 3]) }, { name: 'empty', data: Buffer.alloc(0) }];
  const back = readZip(buildZip(files)); assert.deepEqual(back.map(f => f.name), ['a/b.txt', 'c.bin', 'empty']); assert.deepEqual(back.map(f => f.data.toString('hex')), files.map(f => f.data.toString('hex')));
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926); assert.deepEqual(buildZip(files), buildZip(files), 'the same files give the same zip');
});
test('npm run package builds dist/gpuwars-itch.zip that passes the itch.io checks', () => {
  execFileSync(process.execPath, ['tools/package.mjs'], { cwd: root, stdio: 'pipe' });
  const zipPath = new URL('../dist/' + ITCH.zipName, import.meta.url); assert.ok(existsSync(zipPath));
  const entries = readZip(readFileSync(zipPath)), names = entries.map(e => e.name);
  assert.ok(names.includes('index.html'), 'index.html is at the root'); assert.ok(names.includes('dist/gpuwars.js'));
  assert.deepEqual(names.filter(n => n.startsWith('assets/music/')), ['assets/music/simulation-theory.ogg'], 'the only song is Simulation Theory (the beat data is inside the bundle)');
  for (const f of ['idle', 'throttle', 'tree-1', 'tree-2', 'tree-3', 'tree-4']) assert.ok(names.includes(`assets/sfx/${f}.ogg`), `${f} sound effect is packaged`);
  assert.ok(!names.some(n => n.endsWith('.map') || n.startsWith('/') || n.endsWith('/') || n.includes('node_modules') || n.startsWith('tests/') || n.startsWith('src/')), 'no maps, folders or sources');
  assert.deepEqual(checkFiles(entries.map(e => ({ name: e.name, data: e.data }))), []);
  const js = entries.find(e => e.name === 'dist/gpuwars.js').data.toString('utf8'); assert.ok(!/sourceMappingURL/.test(js), 'no pointer to a sourcemap that is not in the zip');
  assert.ok(entries.length < ITCH.maxFiles && statSync(zipPath).size < 50 * 1024 * 1024, 'a sensible size');
  const html = entries.find(e => e.name === 'index.html').data.toString('utf8'); assert.match(html, /id="fs"/, 'a fullscreen button'); assert.match(html, /viewport/);
});
test('the checker catches what itch.io would reject', () => {
  const ok = [{ name: 'index.html', data: Buffer.from('<script src="dist/gpuwars.js"></script>') }, { name: 'dist/gpuwars.js', data: Buffer.from('x') }];
  assert.deepEqual(checkFiles(ok), []);
  assert.ok(checkFiles([{ name: 'index.html', data: Buffer.from('<script src="https://cdn.example/x.js"></script>') }]).length);
  assert.ok(checkFiles([{ name: 'index.html', data: Buffer.from('<script src="/dist/x.js"></script>') }]).length);
  assert.ok(checkFiles([{ name: 'index.html', data: Buffer.from('<script src="missing.js"></script>') }]).some(p => /not in the zip/.test(p)));
  assert.ok(checkFiles([...ok, { name: 'dist/gpuwars.js.map', data: Buffer.from('{}') }]).some(p => /sourcemap/.test(p)));
  assert.ok(checkFiles([{ name: 'a.txt', data: Buffer.from('') }]).some(p => /no index.html/.test(p)));
  assert.equal(collectFiles().every(f => !f.name.endsWith('.map')), true);
});
