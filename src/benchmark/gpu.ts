// Which graphics card is this, and so which CLASS does it race in? The class is NEVER picked by the player: it is worked out here from what the browser says about the card.
// Sources (all of them are read, none is trusted alone): WebGL's debug renderer info (the card the benchmark really runs on) and WebGPU's adapter info (vendor, architecture, device, description, isFallbackAdapter).
//
// SAFE DEFAULTS when the text is unclear (a masked name, "Mesa", a browser that hides the card):
//   integrated or discrete unknown  -> INTEGRATED   (a strong iGPU must never be raced as a discrete card; only plain evidence of a separate card makes it discrete)
//   discrete, vendor unknown        -> 'other'
//   discrete, generation unknown    -> 'retro'      (the SLOWEST discrete era, never a faster one)
// When WebGL and WebGPU both name the card but disagree, the one with the plainer evidence wins; on a tie WebGL wins (the benchmark runs on WebGL).
import { classLabel, type ClassId, type Era, type Vendor } from '../classes.ts';

/** what WebGPU's adapter says (every field is optional: browsers fill in different ones) */
export interface AdapterInfo { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean }
/** the raw readings, as the page collects them */
export interface GpuReadings { webglVendor: string; webglRenderer: string; adapter: AdapterInfo | null }

export interface GpuIdentity {
  /** a stable text for this card (what the browser says it is), never empty */
  gpuId: string;
  /** where the id came from */
  source: 'webgpu' | 'webgl' | 'none';
  /** the class this card races in. Always a real class: see the safe defaults above */
  gpuClass: ClassId;
  /** why that class (plain words, for the result screen) */
  why: string;
  /** a software renderer (no real graphics card): scores from it are not graphics card scores */
  software: boolean;
  /** false until the browser has been asked (the page starts with a placeholder) */
  ready: boolean;
}

/** how sure one reading is: 'plain' when it names the card or a known part, 'guess' when it only falls back to the default */
type Strength = 'plain' | 'guess';
interface Verdict { integrated: boolean; vendor: Vendor | null; era: Era | null; software: boolean; strength: Strength; why: string }
const NOTHING: Verdict = { integrated: true, vendor: null, era: null, software: false, strength: 'guess', why: 'THE BROWSER DID NOT SAY WHAT THE GRAPHICS CARD IS' };

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic render|\bwarp\b|mesa offscreen|virgl|vmware svga|virtualbox|\bparallels\b|\bgdi generic\b/i;
/** phones, tablets, Apple chips and small boards: always built into the chip */
const MOBILE = /adreno|\bmali\b|mali-|immortalis|powervr|\bapple\b|videocore|xclipse|tegra|qualcomm|snapdragon|\bbroadcom\b|vivante|zhaoxin|\bmediatek\b|\bexynos\b/i;
/** separate cards from makers outside the big three */
const OTHER_DISCRETE = /moore threads|\bmtt\b|innosilicon|matrox|lisuan|biren|\bs3 graphics\b/i;

/** the generation of a GeForce / Quadro by its name: the number's first digits, or the architecture word */
function nvidiaEra(t: string): Era | null {
  if (/blackwell|lovelace|\bada\b|\bh100\b|\bh200\b/.test(t)) return 'current';
  if (/ampere|turing|volta|\ba100\b|\bt4\b|\bquadro rtx\b|\brtx a\d{3,4}\b|\btitan v\b|\btitan rtx\b/.test(t)) return 'modern';
  if (/pascal|maxwell|\btitan x/.test(t)) return 'classic';
  if (/kepler|fermi/.test(t)) return 'retro';
  const quadro = t.match(/quadro\s+([a-z])\d{3,4}\b/);
  if (quadro) return quadro[1] === 'p' || quadro[1] === 'm' ? 'classic' : 'retro';
  const m = t.match(/(?:rtx|gtx|gts|gt|geforce|titan)\s*(?:pro\s*)?(\d{3,4})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 100 && n < 900) return 'retro';       // GTX 4xx to 7xx: before 2014
  if (n >= 900 && n < 1600) return 'classic';    // 9xx (2014-2015) and 10xx (2016-2017)
  if (n >= 1600 && n < 4000) return 'modern';    // 16xx (2019), 20xx (2018), 30xx (2020-2021)
  if (n >= 4000 && n < 6000) return 'current';   // 40xx (2022), 50xx (2025)
  return null;                                   // 8800, 9800 and older: not in the table, so the caller falls back to 'retro'
}
/** the generation of a Radeon RX / Pro / Vega by its name */
function amdEra(t: string): Era | null {
  if (/rdna[\s-]?[34]|rdna4/.test(t)) return 'current';
  if (/rdna[\s-]?[12]\b|rdna[\s-]?1|rdna[\s-]?2/.test(t)) return 'modern';
  if (/radeon vii|vega\s*20/.test(t)) return 'modern';
  if (/vega\s*(?:56|64|frontier|10)|fury|\bnano\b|polaris|gcn[\s-]?[45]/.test(t)) return 'classic';
  if (/\br[579]\s*\d{3}x?\b|\bhd\s*\d{4}|hawaii|gcn[\s-]?[123]/.test(t)) return 'retro';
  const pro = t.match(/radeon pro\s+(?:w)?(\d{3,4})/);
  if (pro) { const n = Number(pro[1]); return n >= 7000 ? 'current' : n >= 5000 ? 'modern' : n >= 500 ? 'classic' : null; }
  const rx = t.match(/\brx\s*(\d{3,4})/);
  if (!rx) return null;
  const n = Number(rx[1]);
  if (n >= 400 && n < 1000) return 'classic';    // RX 4xx and 5xx (Polaris, 2016-2017)
  if (n >= 5000 && n < 7000) return 'modern';    // RX 5000 and 6000 (2019-2020)
  if (n >= 7000 && n < 10000) return 'current';  // RX 7000 (2022), 9000 (2025)
  return null;
}
/** AMD GPU ids that Mesa prints (gfx1151) and the codenames it prints (navi31). Built into the processor: */
const AMD_INTEGRATED_GFX = new Set(['gfx801', 'gfx902', 'gfx909', 'gfx90c', 'gfx1013', 'gfx1033', 'gfx1035', 'gfx1036', 'gfx1037', 'gfx1103', 'gfx1150', 'gfx1151', 'gfx1152', 'gfx1153']);
const AMD_INTEGRATED_NAMES = /\b(?:raven|picasso|renoir|cezanne|lucienne|barcelo|rembrandt|mendocino|phoenix|hawk ?point|strix|kraken|krackan|sarlak|vangogh|van gogh|raphael|granite ?ridge|kaveri|carrizo|stoney|mullins|beema|kabini)\b/;
/** separate cards by gfx id, with their generation */
const AMD_DISCRETE_GFX: Record<string, Era> = { gfx803: 'classic', gfx900: 'classic', gfx906: 'modern', gfx908: 'modern', gfx90a: 'modern', gfx1010: 'modern', gfx1011: 'modern', gfx1012: 'modern', gfx1030: 'modern', gfx1031: 'modern', gfx1032: 'modern', gfx1034: 'modern', gfx1100: 'current', gfx1101: 'current', gfx1102: 'current', gfx1200: 'current', gfx1201: 'current', gfx700: 'retro', gfx701: 'retro', gfx702: 'retro', gfx703: 'retro', gfx704: 'retro', gfx705: 'retro', gfx802: 'classic' };
const AMD_DISCRETE_NAMES: [RegExp, Era][] = [[/\bnavi\s?4\d\b/, 'current'], [/\bnavi\s?3\d\b/, 'current'], [/\bnavi\s?[12]\d\b/, 'modern'], [/\bpolaris\s?\d+\b|\bellesmere\b|\bbaffin\b|\blexa\b/, 'classic'], [/\bvega\s?10\b|\bfiji\b|\btonga\b/, 'classic'], [/\bvega\s?20\b/, 'modern'], [/\bhawaii\b|\bbonaire\b|\bpitcairn\b|\btahiti\b|\boland\b|\bcape verde\b|\bverde\b/, 'retro']];

/** worked out from ONE text (all lower case): is it built in, who makes it, which generation */
function verdictOf(raw: string): Verdict {
  const t = raw.toLowerCase().replace(/\(tm\)|\(r\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t === 'unknown') return NOTHING;
  if (SOFTWARE.test(t)) return { integrated: true, vendor: null, era: null, software: true, strength: 'plain', why: 'A SOFTWARE RENDERER, NOT A GRAPHICS CARD' };
  if (MOBILE.test(t)) return { integrated: true, vendor: null, era: null, software: false, strength: 'plain', why: 'A PHONE, APPLE OR SMALL-BOARD CHIP, BUILT INTO THE PROCESSOR' };
  const gfx = t.match(/\bgfx\s?([0-9a-f]{3,4})\b/), gfxId = gfx ? `gfx${gfx[1]}` : '';
  const discrete = (vendor: Vendor, era: Era | null, why: string): Verdict => ({ integrated: false, vendor, era, software: false, strength: 'plain', why });
  const built = (vendor: Vendor | null, why: string, strength: Strength = 'plain'): Verdict => ({ integrated: true, vendor, era: null, software: false, strength, why });

  // NVIDIA: every GeForce, Quadro, RTX and Tesla is a separate card (Tegra was handled above)
  if (/nvidia|geforce|quadro|\brtx\b|\bgtx\b|\btitan\b/.test(t)) return discrete('nvidia', nvidiaEra(t), 'AN NVIDIA GEFORCE / RTX / QUADRO CARD IS A SEPARATE CARD');

  // Intel: Arc A/B-series, Iris Xe MAX and Xe-HPG are separate cards; UHD, HD, Iris, Xe, "Arc Graphics" (Core Ultra) and Gen-N are built in
  if (/intel|\barc\b|\biris\b|\buhd\b|\bxe\b|xe-?\d?-?[lh]pg?\b|\bgen-?\d+/.test(t) && !/amd|radeon|nvidia/.test(t)) {
    if (/\barc\s*(?:pro\s*)?[ab]\d{3}/.test(t) || /xe-?\d?-?hpg?\b/.test(t) || /\b0x56[0-9a-f]{2}\b|\b0xe2[0-9a-f]{2}\b/.test(t) || /\bdg[12]\b|data center gpu/.test(t)) return discrete('intel', /iris xe max|\bdg1\b/.test(t) ? 'modern' : 'current', 'INTEL ARC (A/B-SERIES) IS A SEPARATE CARD');
    if (/uhd|hd graphics|\biris\b|\bxe\b|\barc\b|xe-?\d?-?lpg?|\bgen-?\d+|intel/.test(t)) return built('intel', 'INTEL UHD / HD / IRIS / XE / ARC GRAPHICS IS BUILT INTO THE PROCESSOR');
  }

  // AMD
  if (/\bamd\b|radeon|\bati\b|radeonsi|\bgfx\d|\bnavi\s?\d|\bvega\b|polaris|rdna|\bgcn\b|\brx\s?\d/.test(t)) {
    // 1. a model name that says "RX" / "Radeon VII" / "Pro" / "Fury" / R9 is a separate card, even from "Radeon RX Vega 11" (the exception: that one is the Ryzen 2400G's)
    const vegaBuilt = /\bvega\s*(?:3|5|6|7|8|9|10|11)\b/.test(t) && !/vega\s*(?:56|64)/.test(t);
    if (vegaBuilt) return built('amd', 'RADEON VEGA (3 TO 11) GRAPHICS IS BUILT INTO THE RYZEN PROCESSOR');
    if (/\brx\s*\d{3,4}|radeon vii|radeon pro|firepro|\bfury\b|\bnano\b|vega\s*(?:56|64|frontier)|\br[579]\s*\d{3}|\bhd\s*\d{4}(?!d)/.test(t)) {
      return discrete('amd', amdEra(t), 'A RADEON RX / PRO / VII CARD IS A SEPARATE AMD CARD');
    }
    // 2. the part named by its marketing number: Radeon 610M to 890M, 8040S to 8060S (Strix Halo) are built in
    if (/radeon\s*(?:\d{3}m|\d{4}[ms])\b/.test(t) || /\b(?:610m|660m|680m|740m|760m|780m|880m|890m|8040s|8050s|8060s)\b/.test(t)) return built('amd', 'RADEON 610M TO 890M AND 8040S TO 8060S (STRIX HALO) ARE BUILT INTO THE RYZEN PROCESSOR');
    // 3. the GPU id or codename Mesa prints (it often names no model: "AMD Radeon Graphics (radeonsi, gfx1151 ...)")
    if (gfxId && AMD_INTEGRATED_GFX.has(gfxId)) return built('amd', `AMD ${gfxId.toUpperCase()} IS A GRAPHICS CHIP BUILT INTO THE PROCESSOR`);
    if (gfxId && AMD_DISCRETE_GFX[gfxId]) return discrete('amd', AMD_DISCRETE_GFX[gfxId] as Era, `AMD ${gfxId.toUpperCase()} IS A SEPARATE CARD`);
    if (AMD_INTEGRATED_NAMES.test(t)) return built('amd', 'AN AMD PROCESSOR CODENAME: GRAPHICS BUILT INTO THE PROCESSOR');
    for (const [pattern, era] of AMD_DISCRETE_NAMES) if (pattern.test(t)) return discrete('amd', era, 'AN AMD SEPARATE-CARD CODENAME');
    // 4. architecture alone: RDNA 3.5 only exists in processors; anything else is not enough
    if (/rdna[\s-]?3\.?5|rdna35/.test(t) || /\br[2-7]\s+graphics\b|\bradeon\s+graphics\b|vega\s*\d+\s+graphics|\bhd\s*\d{4}d\b/.test(t)) return built('amd', 'RADEON GRAPHICS WITHOUT A CARD MODEL IS BUILT INTO THE PROCESSOR');
    return built('amd', 'AN AMD CHIP THAT DOES NOT SAY IT IS A SEPARATE CARD: TREATED AS BUILT IN', 'guess');
  }

  const other = t.match(OTHER_DISCRETE);
  if (other) return discrete('other', null, 'A SEPARATE CARD FROM A SMALLER MAKER');
  if (/\bintegrated\b/.test(t)) return built(null, 'THE BROWSER CALLS IT INTEGRATED');
  if (/\bdiscrete\b/.test(t)) return discrete('other', null, 'THE BROWSER CALLS IT A SEPARATE CARD');
  return { ...NOTHING, why: 'THE NAME DOES NOT SAY IF IT IS A SEPARATE CARD: TREATED AS BUILT IN' };
}

/** one verdict for the WebGPU adapter: its fields joined, and a fallback adapter is software */
function adapterVerdict(a: AdapterInfo | null): Verdict {
  if (!a) return NOTHING;
  const text = [a.vendor, a.architecture, a.device, a.description].filter(s => !!s).join(' ');
  const v = verdictOf(text);
  if (a.isFallbackAdapter) return { ...v, integrated: true, software: true, strength: 'plain', why: 'WEBGPU SAYS THIS IS A FALLBACK (SOFTWARE) ADAPTER' };
  // a bare vendor name ("nvidia", "amd") with nothing else is not evidence of a separate card
  return v;
}

/** the class from one or two verdicts (pure; see the rules in the header) */
export function combineVerdicts(web: Verdict, gpu: Verdict): { cls: ClassId; why: string; software: boolean } {
  // software in WebGL is final (that is what the benchmark runs on); a WebGPU fallback adapter only counts when WebGL says nothing plainer
  const webReal = web.strength === 'plain' && !web.software;
  const software = web.software || (gpu.software && !webReal);
  if (software) return { cls: 'integrated', why: 'A SOFTWARE RENDERER, NOT A GRAPHICS CARD: RACED AS INTEGRATED', software: true };
  const first = web.strength === 'plain' || gpu.strength !== 'plain' ? web : gpu, second = first === web ? gpu : web;
  if (first.integrated) return { cls: 'integrated', why: first.why, software: false };
  // discrete: the vendor and the era come from the winner, then the other reading if it names the same maker, else the safe defaults
  const sameMaker = (second.vendor === first.vendor || !first.vendor) && !second.integrated;
  const vendor: Vendor = first.vendor ?? (sameMaker ? second.vendor : null) ?? 'other';
  const era: Era = first.era ?? (second.vendor === vendor && !second.integrated ? second.era : null) ?? 'retro';
  return { cls: `discrete-${vendor}-${era}` as ClassId, why: first.why + (first.era ? '' : ' (GENERATION NOT NAMED: SLOWEST DISCRETE ERA)'), software: false };
}

/** the identity from the raw readings (pure: the tests feed it real strings) */
export function identify(r: GpuReadings, ready = true): GpuIdentity {
  const webText = normalizeGpuText(`${r.webglVendor} ${r.webglRenderer}`), a = r.adapter;
  const adapterText = normalizeGpuText(a ? [a.vendor, a.architecture, a.device, a.description].filter(s => !!s).join(' ') : '');
  const web = verdictOf(webText), gpu = adapterVerdict(a), pick = combineVerdicts(web, gpu);
  const gpuId = webText || adapterText || 'unknown', source: GpuIdentity['source'] = webText ? 'webgl' : adapterText ? 'webgpu' : 'none';
  return { gpuId, source, gpuClass: pick.cls, why: pick.why, software: pick.software, ready };
}
/** the same from two plain strings (the old call shape; WebGPU's text is read as a single description) */
export function identityFromText(webglText: string, webgpuText: string): GpuIdentity { return identify({ webglVendor: '', webglRenderer: webglText, adapter: webgpuText ? { description: webgpuText } : null }); }
/** the class for one text, nothing else (for tests and the console) */
export function classifyGpu(text: string): ClassId { return identityFromText(text, '').gpuClass; }

/** the text made safe to keep: plain characters, one space between words, at most 200 long */
export function normalizeGpuText(raw: string): string {
  return raw.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** what the result screen and the console say the game saw */
export function gpuLine(g: GpuIdentity): string { return `GPU SEEN: ${g.gpuId.slice(0, 90)} | CLASS: ${classLabel(g.gpuClass)} (${g.why.toLowerCase()})`; }

/** ask the browser what the card is: WebGL's debug renderer info and WebGPU's adapter info */
export async function readGpuIdentity(): Promise<GpuIdentity> {
  let adapter: AdapterInfo | null = null, webglVendor = '', webglRenderer = '';
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: AdapterInfo; isFallbackAdapter?: boolean; requestAdapterInfo?: () => Promise<AdapterInfo> } | null> } }).gpu;
    const found = gpu ? await gpu.requestAdapter() : null;
    const info = found ? (found.info ?? (found.requestAdapterInfo ? await found.requestAdapterInfo() : undefined)) : undefined;
    if (found) adapter = { vendor: info?.vendor, architecture: info?.architecture, device: info?.device, description: info?.description, isFallbackAdapter: found.isFallbackAdapter === true || info?.isFallbackAdapter === true };
  } catch (e) { /* no WebGPU: WebGL is asked next */ }
  try {
    // the same context options as the benchmark's own canvas (src/benchmark/workload.ts), so a two-card laptop answers for the card that will be timed
    const c = document.createElement('canvas'), options = { antialias: false, alpha: false }, gl = (c.getContext('webgl2', options) ?? c.getContext('webgl', options)) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      // (without the extension the browser hides the card: the plain RENDERER is usually just "WebKit WebGL", which says nothing, and the class falls back to the safe default)
      if (ext) { webglVendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)); webglRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)); }
    }
  } catch (e) { /* no WebGL */ }
  return identify({ webglVendor, webglRenderer, adapter });
}
/** the placeholder the page holds until the browser has answered */
export const PENDING_GPU: GpuIdentity = { gpuId: 'unknown', source: 'none', gpuClass: 'integrated', why: 'CHECKING THE GRAPHICS CARD', software: false, ready: false };
