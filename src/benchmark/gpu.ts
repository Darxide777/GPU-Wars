// Which graphics card is this? The browser's own words for it (WebGL's debug renderer info, WebGPU's adapter info) become the `gpuId`, and a class is named ONLY when the text says plainly what the card is.
// We never guess integrated versus discrete, or the maker or generation: when the text is masked or unclear the class is `null` and the player picks it by hand (and it is then locked, see rules.ts).
import type { ClassId, Era } from '../classes.ts';

export interface GpuIdentity {
  /** a stable text for this card (what the browser says it is), never empty */
  gpuId: string;
  /** where the text came from */
  source: 'webgpu' | 'webgl' | 'none';
  /** the class the text plainly states, or null when it does not (the player must pick) */
  detectedClass: ClassId | null;
  /** why the class was named, or why it was not */
  why: string;
  /** a software renderer (no real graphics card): scores from it are not graphics card scores */
  software: boolean;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|\bwarp\b|mesa offscreen/i;
/** GeForce series by the number's first digits: the generation bucket by release year (retro before 2014, classic 2014-2017, modern 2018-2021, current 2022 and later) */
function nvidiaEra(model: number): Era | null {
  if (model >= 100 && model < 1000) return model >= 900 ? 'classic' : 'retro';       // GTX 4xx to 7xx are before 2014, 9xx is 2014-2015
  if (model >= 1000 && model < 2000) return model >= 1600 ? 'modern' : 'classic';     // 10xx is 2016-2017, 16xx is 2019
  if (model >= 2000 && model < 4000) return 'modern';
  if (model >= 4000 && model < 6000) return 'current';
  return null;
}
/** Radeon RX by number: three digits (4xx, 5xx) are 2016-2017; four digits 5xxx and 6xxx are 2019-2020; 7xxx and above are 2022 on */
function amdEra(model: number): Era | null {
  if (model >= 400 && model < 1000) return 'classic';
  if (model >= 5000 && model < 7000) return 'modern';
  if (model >= 7000 && model < 10000) return 'current';
  return null;
}

/** name the class from what the browser says the card is, or say why it cannot (pure: the tests feed it strings) */
export function classifyGpu(text: string): { detectedClass: ClassId | null; why: string } {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t === 'unknown') return { detectedClass: null, why: 'THE BROWSER DID NOT SAY WHAT THE GRAPHICS CARD IS' };
  if (SOFTWARE.test(t)) return { detectedClass: null, why: 'A SOFTWARE RENDERER, NOT A GRAPHICS CARD' };
  const num = (m: RegExpMatchArray | null): number => (m ? Number(m[1]) : NaN);
  // NVIDIA: GeForce GTX / RTX / GT with a model number. (Quadro, Tesla and mobile "MX" names are not named plainly enough: pick by hand.)
  let m = t.match(/geforce\s+(?:rtx|gtx|gt)\s*(\d{3,4})/i);
  if (m) { const era = nvidiaEra(num(m)); return era ? { detectedClass: `discrete-nvidia-${era}`, why: `GEFORCE ${m[1]} IS A SEPARATE NVIDIA CARD` } : { detectedClass: null, why: 'AN NVIDIA MODEL THE GAME DOES NOT RECOGNISE' }; }
  // AMD: Radeon RX with a model number is a separate card. "Radeon Graphics", "Vega 8 Graphics" and the like are built into the processor.
  m = t.match(/radeon(?:\(tm\))?\s+rx\s*(\d{3,4})/i);
  if (m) { const era = amdEra(num(m)); return era ? { detectedClass: `discrete-amd-${era}`, why: `RADEON RX ${m[1]} IS A SEPARATE AMD CARD` } : { detectedClass: null, why: 'AN AMD MODEL THE GAME DOES NOT RECOGNISE' }; }
  if (/radeon(?:\(tm\))?\s+(?:vega\s*\d+\s+)?graphics\b/i.test(t) && !/\brx\b/i.test(t)) return { detectedClass: 'integrated', why: 'RADEON GRAPHICS WITHOUT AN RX MODEL IS BUILT INTO THE PROCESSOR' };
  // Intel: UHD, HD, Iris and Xe (without "Arc") are built in; Arc with an A-series model is a separate 2022 card. Plain "Arc Graphics" is built into newer processors, so it is NOT named: pick by hand.
  if (/intel.*?(?:uhd|hd graphics|iris)/i.test(t)) return { detectedClass: 'integrated', why: 'INTEL UHD / HD / IRIS GRAPHICS IS BUILT INTO THE PROCESSOR' };
  if (/intel.*?arc(?:\(tm\))?\s+a\d{3}/i.test(t)) return { detectedClass: 'discrete-intel-current', why: 'INTEL ARC A-SERIES IS A SEPARATE 2022 CARD' };
  // phones, tablets and Apple chips share memory with the processor
  if (/adreno|mali-|powervr|apple m\d|apple gpu|videocore/i.test(t)) return { detectedClass: 'integrated', why: 'A MOBILE OR APPLE CHIP, BUILT INTO THE PROCESSOR' };
  return { detectedClass: null, why: 'THE NAME DOES NOT SAY IF IT IS A SEPARATE CARD, OR WHICH GENERATION' };
}

/** the text made safe to keep: plain characters, one space between words, at most 200 long */
export function normalizeGpuText(raw: string): string {
  return raw.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

interface AdapterInfoLike { vendor?: string; architecture?: string; device?: string; description?: string }
/** ask the browser (WebGPU first when there is one, then WebGL's debug renderer info) what the card is */
export async function readGpuIdentity(): Promise<GpuIdentity> {
  let webgpuText = '', webglText = '';
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: AdapterInfoLike; requestAdapterInfo?: () => Promise<AdapterInfoLike> } | null> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    const info = adapter ? (adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : undefined)) : undefined;
    if (info) webgpuText = [info.vendor, info.architecture, info.device, info.description].filter(s => !!s).join(' ');
  } catch (e) { /* no WebGPU: WebGL is asked next */ }
  try {
    const c = document.createElement('canvas'), gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      // (without the extension the browser hides the card: the plain RENDERER is usually just "WebKit WebGL", which says nothing)
      if (ext) webglText = `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`;
    }
  } catch (e) { /* no WebGL */ }
  return identityFromText(webglText, webgpuText);
}

/** the identity from the two texts (pure; the page's `readGpuIdentity` fills them in). WebGL's text is the id when there is one (it names the exact model), else WebGPU's. */
export function identityFromText(webglText: string, webgpuText: string): GpuIdentity {
  const webgl = normalizeGpuText(webglText), webgpu = normalizeGpuText(webgpuText);
  const gpuId = webgl || webgpu || 'unknown', source: GpuIdentity['source'] = webgl ? 'webgl' : webgpu ? 'webgpu' : 'none';
  // when both exist, the class is named only if each text that says something agrees (a disagreement is not guessed through)
  const a = webgl ? classifyGpu(webgl) : null, b = webgpu ? classifyGpu(webgpu) : null;
  const named = [a, b].filter((v): v is NonNullable<typeof v> => !!v && v.detectedClass !== null);
  let detectedClass: ClassId | null = null, why = (a ?? b ?? classifyGpu('')).why;
  if (named.length && named.every(v => v.detectedClass === (named[0] as { detectedClass: ClassId | null }).detectedClass)) { detectedClass = (named[0] as { detectedClass: ClassId | null }).detectedClass; why = (named[0] as { why: string }).why; }
  else if (named.length) why = 'WEBGL AND WEBGPU DISAGREE ON THE CARD';
  return { gpuId, source, detectedClass, why, software: SOFTWARE.test(webgl) || SOFTWARE.test(webgpu) };
}
