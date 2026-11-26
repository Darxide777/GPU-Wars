// Bundles the game (src/drag/page.ts) into dist/gpuwars.js, a plain script that also works from file:// and from an itch.io iframe (index.html loads it by a relative path).
import { build } from 'esbuild';
await build({ entryPoints: { gpuwars: 'src/drag/page.ts' }, bundle: true, format: 'iife', target: 'es2022', outdir: 'dist', sourcemap: true, logLevel: 'warning' });
