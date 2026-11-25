// Reads the song list for the game: every audio file in assets/music, with its title and artist from the file's own tags (Ogg Vorbis and Opus comments, FLAC comments,
// MP3 ID3 tags), or from the file name when the file has none ("Artist - Title.ogg", or just "the-in-between.ogg" for the title "The In Between"), and for the game's own songs the artist "Chromium Halo" when none is given anywhere.
// It is plain JavaScript with no dependencies, so the build (build.mjs) can run it anywhere the game builds. Run it by itself to see what it finds:
//   node tools/music-tags.mjs [folder]      (default: assets/music)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** the artist shown for a song of the game's own that has none in its tags or its name (a song someone adds themselves gets none) */
export const DEFAULT_ARTIST = 'Chromium Halo';
export const AUDIO_EXT = ['.ogg', '.opus', '.mp3', '.flac', '.wav', '.m4a'];

const u32le = (b, o) => b.readUInt32LE(o);
/** the first `want` packets of an Ogg file (a packet can run across several pages) */
function oggPackets(buf, want) {
  const packets = []; let cur = [], o = 0;
  while (o + 27 <= buf.length && buf.toString('latin1', o, o + 4) === 'OggS' && packets.length < want) {
    const n = buf[o + 26]; let p = o + 27 + n, q = o + 27;
    for (let i = 0; i < n; i++) { const len = buf[q + i]; cur.push(buf.subarray(p, p + len)); p += len; if (len < 255) { packets.push(Buffer.concat(cur)); cur = []; if (packets.length >= want) break; } }
    o = p;
  }
  return packets;
}
/** "KEY=value" comments of a Vorbis-style comment block, starting at `o` in `b` */
function vorbisComments(b, o) {
  const tags = {};
  if (o + 4 > b.length) return tags;
  o += 4 + u32le(b, o);
  if (o + 4 > b.length) return tags;
  let n = u32le(b, o); o += 4;
  while (n-- > 0 && o + 4 <= b.length) {
    const len = u32le(b, o); o += 4; if (o + len > b.length) break;
    const s = b.toString('utf8', o, o + len), i = s.indexOf('='); o += len;
    if (i > 0) { const k = s.slice(0, i).toUpperCase(); if (!(k in tags)) tags[k] = s.slice(i + 1).trim(); }
  }
  return tags;
}
function fromVorbis(t) { return { title: t.TITLE || '', artist: t.ARTIST || t.ALBUMARTIST || t.PERFORMER || '' }; }

function readOgg(buf) {
  const [, comments] = oggPackets(buf, 2); if (!comments) return null;
  if (comments.subarray(0, 7).toString('latin1') === '\x03vorbis') return fromVorbis(vorbisComments(comments, 7));
  if (comments.subarray(0, 8).toString('latin1') === 'OpusTags') return fromVorbis(vorbisComments(comments, 8));
  return null;
}
function readFlac(buf) {
  let o = 4;
  while (o + 4 <= buf.length) {
    const h = buf[o], type = h & 0x7f, len = (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
    if (type === 4) return fromVorbis(vorbisComments(buf.subarray(o + 4, o + 4 + len), 0));
    if (h & 0x80) break; o += 4 + len;
  }
  return null;
}
function id3Text(b) {
  if (!b.length) return '';
  const enc = b[0], d = b.subarray(1);
  const s = enc === 0 ? d.toString('latin1') : enc === 3 ? d.toString('utf8') : enc === 2 ? Buffer.from(d).swap16().toString('utf16le') : (d[0] === 0xfe && d[1] === 0xff ? Buffer.from(d.subarray(2)).swap16().toString('utf16le') : d.toString('utf16le').replace(/^﻿/, ''));
  return s.replace(/\0+$/, '').split('\0')[0].trim();
}
function readMp3(buf) {
  let title = '', artist = '';
  if (buf.toString('latin1', 0, 3) === 'ID3' && buf.length > 10) {
    const ver = buf[3], size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f), end = Math.min(buf.length, 10 + size);
    let o = 10;
    if (buf[5] & 0x40 && ver >= 3) { const ex = ver === 4 ? ((buf[10] & 0x7f) << 21) | ((buf[11] & 0x7f) << 14) | ((buf[12] & 0x7f) << 7) | (buf[13] & 0x7f) : buf.readUInt32BE(10) + 4; o += ex; }
    const idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
    while (o + hdr <= end) {
      const id = buf.toString('latin1', o, o + idLen); if (!/^[A-Z0-9]+$/.test(id)) break;
      const sz = ver === 2 ? (buf[o + 3] << 16) | (buf[o + 4] << 8) | buf[o + 5] : ver === 4 ? ((buf[o + 4] & 0x7f) << 21) | ((buf[o + 5] & 0x7f) << 14) | ((buf[o + 6] & 0x7f) << 7) | (buf[o + 7] & 0x7f) : buf.readUInt32BE(o + 4);
      if (sz <= 0 || o + hdr + sz > buf.length) break;
      const body = buf.subarray(o + hdr, o + hdr + sz);
      if (id === 'TIT2' || id === 'TT2') title = title || id3Text(body);
      else if (id === 'TPE1' || id === 'TP1') artist = artist || id3Text(body);
      else if ((id === 'TPE2' || id === 'TP2') && !artist) artist = id3Text(body);
      o += hdr + sz;
    }
  }
  if ((!title || !artist) && buf.length > 128 && buf.toString('latin1', buf.length - 128, buf.length - 125) === 'TAG') {
    const v1 = (a, b) => buf.toString('latin1', buf.length - 128 + a, buf.length - 128 + b).replace(/[\0 ]+$/, '').trim();
    title = title || v1(3, 33); artist = artist || v1(33, 63);
  }
  return { title, artist };
}

/** title and artist as written in the file's tags ('' for what it does not have) */
export function readTags(file) {
  let buf; try { buf = fs.readFileSync(file); } catch { return { title: '', artist: '' }; }
  try {
    const head = buf.toString('latin1', 0, 4), ext = path.extname(file).toLowerCase();
    const t = head === 'OggS' ? readOgg(buf) : head === 'fLaC' ? readFlac(buf) : ext === '.mp3' || buf.toString('latin1', 0, 3) === 'ID3' ? readMp3(buf) : null;
    return t || { title: '', artist: '' };
  } catch { return { title: '', artist: '' }; }      // a damaged file just has no tags
}
const prettify = s => s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/(^|[\s-])([a-z])/g, (m, a, c) => a + c.toUpperCase());
/** title and artist from a file name: "Artist - Title" or just a title ("the-in-between" is "The In Between") */
export function namesFromFile(file) {
  const base = path.basename(file, path.extname(file)), i = base.indexOf(' - ');
  if (i > 0) return { artist: prettify(base.slice(0, i)), title: prettify(base.slice(i + 3)) };
  return { artist: '', title: prettify(base.replace(/-/g, ' ')) };
}
/** every song in `dir`, sorted by file name (ignoring case, so the same everywhere): { file, id (the file name without its extension, the key of the analysis), title, artist } */
export function buildLibrary(dir, isBundled = () => false) {
  const tracks = [];
  for (const f of fs.readdirSync(dir).filter(f => AUDIO_EXT.includes(path.extname(f).toLowerCase())).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : a < b ? -1 : 1))) {
    const tags = readTags(path.join(dir, f)), names = namesFromFile(f);
    tracks.push({ file: f, id: path.basename(f, path.extname(f)), title: tags.title || names.title, artist: (tags.title ? tags.artist : tags.artist || names.artist) || (isBundled(f) ? DEFAULT_ARTIST : '') });
  }
  return { version: 1, tracks };
}
/**
 * Which songs are the game's own (the ones that get the default artist): those git tracks in the music folder (so a song someone drops in later, not committed, is not),
 * or, with no git (a zip download), those the committed song list (library.json) already gave the default artist.
 */
export function bundledSongs(dir, libraryFile = path.join(dir, 'library.json')) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', '.'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const tracked = new Set(out.split('\0').filter(Boolean).map(f => path.basename(f)));
    if (tracked.size) return f => tracked.has(f);
  } catch { /* no git, or not a repository */ }
  let prev = []; try { prev = JSON.parse(fs.readFileSync(libraryFile, 'utf8')).tracks; } catch { /* no list yet */ }
  const known = new Set(prev.filter(t => t.artist === DEFAULT_ARTIST).map(t => t.file));
  return f => known.has(f);
}
const here = new URL(import.meta.url).pathname;
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here)) {
  const dir = process.argv[2] || new URL('../assets/music/', import.meta.url).pathname;
  for (const t of buildLibrary(dir, bundledSongs(dir)).tracks) console.log(t.file.padEnd(34), (t.artist || '(no artist)').padEnd(24), t.title);
}
