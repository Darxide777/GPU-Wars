// `npm run package`: builds the game and writes dist/gpuwars-itch.zip, ready to upload to itch.io as an HTML5 game (index.html at the zip's root, relative paths, no sourcemaps).
// dist/ is not committed, so neither is the zip.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildZip } from './zip.mjs';

export const ITCH = { zipName: 'gpuwars-itch.zip', maxFiles: 1000, maxPathLength: 240, maxTotalBytes: 500 * 1024 * 1024, warnTotalBytes: 40 * 1024 * 1024 };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** the files that go in the zip, as [{ name, data }]: the page, the bundle and the one song (never sourcemaps; the beat data is inside the bundle) */
export function collectFiles(dir = root) {
  const files = [{ name: 'index.html', data: fs.readFileSync(path.join(dir, 'index.html')) }, { name: 'dist/gpuwars.js', data: Buffer.from(fs.readFileSync(path.join(dir, 'dist/gpuwars.js'), 'utf8').replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '\n')) }];
  for (const f of fs.readdirSync(path.join(dir, 'assets/music')).sort()) if (/\.ogg$/i.test(f)) files.push({ name: 'assets/music/' + f, data: fs.readFileSync(path.join(dir, 'assets/music', f)) });
  return files;
}
/** problems that would make itch.io reject or break the upload; an empty list means ready */
export function checkFiles(files) {
  const problems = [], html = files.find(f => f.name === 'index.html')?.data.toString('utf8') ?? '';
  if (!html) problems.push('no index.html at the zip root');
  if (/(?:src|href)\s*=\s*["']https?:\/\//i.test(html) || /url\(\s*["']?https?:/i.test(html)) problems.push('index.html loads something from the web');
  if (/(?:src|href)\s*=\s*["']\//.test(html)) problems.push('index.html has an absolute path');
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"'#]+)["']/g)) if (!files.some(f => f.name === m[1])) problems.push(`index.html points at ${m[1]}, which is not in the zip`);
  if (files.length > ITCH.maxFiles) problems.push('more than 1000 files');
  for (const f of files) { if (f.name.length > ITCH.maxPathLength) problems.push('path too long: ' + f.name); if (f.name.endsWith('/') || f.name.startsWith('/')) problems.push('bad path: ' + f.name); if (f.name.endsWith('.map')) problems.push('sourcemap in the zip: ' + f.name); }
  if (files.reduce((n, f) => n + f.data.length, 0) > ITCH.maxTotalBytes) problems.push('over 500 MB');
  return problems;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit' });
  const files = collectFiles(), problems = checkFiles(files);
  if (problems.length) { console.error('NOT READY FOR ITCH.IO:\n- ' + problems.join('\n- ')); process.exit(1); }
  const zip = buildZip(files), out = path.join(root, 'dist', ITCH.zipName); fs.writeFileSync(out, zip);
  const total = files.reduce((n, f) => n + f.data.length, 0), mb = n => (n / 1048576).toFixed(1) + ' MB';
  console.log(`wrote ${path.relative(root, out)}: ${files.length} files, ${mb(total)} extracted, ${mb(zip.length)} zipped`);
  if (total > ITCH.warnTotalBytes) console.warn(`note: ${mb(total)} is a big download for a browser game; the song is most of it`);
}
