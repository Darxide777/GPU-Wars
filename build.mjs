// Bundles the game (src/drag/page.ts) into dist/gpuwars.js, a plain script that also works from file:// and from an itch.io iframe (index.html loads it by a relative path).
import { build } from 'esbuild';
import fs from 'node:fs';
import { buildLibrary } from './tools/music-tags.mjs';
// the song list: every audio file in assets/music (only the two Simulation Theory songs ship) with its title and artist, so the game needs no list written by hand
const library = JSON.stringify(buildLibrary('assets/music', () => true)) + '\n';
if (!fs.existsSync('assets/music/library.json') || fs.readFileSync('assets/music/library.json', 'utf8') !== library) fs.writeFileSync('assets/music/library.json', library);
await build({ entryPoints: { gpuwars: 'src/drag/page.ts' }, bundle: true, format: 'iife', target: 'es2022', outdir: 'dist', sourcemap: true, logLevel: 'warning' });
