// Turns a mono recording into notes in the browser: a short-time spectrum,
// a harmonic pitch-salience model that picks the notes sounding in each
// frame, note tracking, then tempo, key and beat quantization.
import { fifthsForTonic } from "./theory";
import { instrumentOf, sortNotes, type InstrumentId, type Note } from "./types";

export const ANALYSIS_RATE = 22050;
const FRAME = 4096;
const HOP = 512;
const LOW = 21;
const HIGH = 108;
// Semitone offsets of harmonics 2..6 and how much each counts.
const HARMONICS = [
  [12, 0.8, 0.6],
  [19, 0.6, 0.4],
  [24, 0.5, 0.3],
  [28, 0.4, 0.25],
  [31, 0.35, 0.2],
] as const;

export interface Transcription {
  tempo: number;
  keyFifths: number;
  keyMode: "major" | "minor";
  timeNum: number;
  timeDen: number;
  notes: Note[];
}

interface RawNote {
  p: number;
  start: number;
  end: number;
  level: number;
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Per frame, the strongest magnitude within each semitone band (MIDI LOW..HIGH). */
async function semitoneSpectra(
  samples: Float32Array,
  rate: number,
  progress: (f: number) => void,
): Promise<Float32Array[]> {
  const frames: Float32Array[] = [];
  const win = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  const bands: [number, number][] = [];
  for (let m = LOW; m <= HIGH; m++) {
    const f = 440 * 2 ** ((m - 69) / 12);
    const lo = Math.max(1, Math.round((f * 2 ** (-0.5 / 12) * FRAME) / rate));
    const hi = Math.max(lo, Math.round((f * 2 ** (0.5 / 12) * FRAME) / rate));
    bands.push([lo, Math.min(hi, FRAME / 2 - 1)]);
  }
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const count = Math.max(1, Math.floor((samples.length - FRAME) / HOP) + 1);
  for (let t = 0; t < count; t++) {
    const off = t * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = (samples[off + i] ?? 0) * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(FRAME / 2);
    for (let k = 0; k < FRAME / 2; k++) mag[k] = Math.hypot(re[k]!, im[k]!);
    const out = new Float32Array(HIGH - LOW + 1);
    for (let m = 0; m < bands.length; m++) {
      const [lo, hi] = bands[m]!;
      let best = 0;
      for (let k = lo; k <= hi; k++) {
        // Only a spectral peak counts as energy at this pitch.
        const v = mag[k]!;
        if (v > best && v >= (mag[k - 1] ?? 0) && v >= (mag[k + 1] ?? 0)) best = v;
      }
      out[m] = best;
    }
    frames.push(out);
    if (t % 256 === 255) {
      progress(t / count);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return frames;
}

/** Which pitches sound in one frame, picked strongest-first with their harmonics removed. */
function pickPitches(
  spectrum: Float32Array,
  floor: number,
  low: number,
  high: number,
  maxVoices: number,
): [number, number][] {
  const p = Float32Array.from(spectrum);
  let frameMax = 0;
  for (let i = 0; i < p.length; i++) frameMax = Math.max(frameMax, p[i]!);
  const thr = Math.max(floor, frameMax * 0.12);
  const picked: [number, number][] = [];
  for (let voice = 0; voice < maxVoices; voice++) {
    let best = -1;
    let bestS = 0;
    for (let m = low; m <= high; m++) {
      const i = m - LOW;
      if (p[i]! < thr) continue;
      let s = p[i]!;
      for (const [off, w] of HARMONICS) s += w * (p[i + off] ?? 0);
      if (s > bestS) {
        bestS = s;
        best = m;
      }
    }
    if (best < 0) break;
    const i = best - LOW;
    const level = p[i]!;
    picked.push([best, level]);
    p[i] = 0;
    if (i > 0) p[i - 1] = Math.min(p[i - 1]!, level * 0.3);
    if (i + 1 < p.length) p[i + 1] = Math.min(p[i + 1]!, level * 0.3);
    for (const [off, , remove] of HARMONICS) {
      const h = i + off;
      if (h < p.length) p[h] = Math.max(0, p[h]! - level * (remove + 0.3));
    }
  }
  return picked;
}

function trackNotes(active: Map<number, number>[], frameSec: number): RawNote[] {
  const notes: RawNote[] = [];
  const open = new Map<number, { start: number; last: number; level: number; peak: number }>();
  const close = (p: number, o: { start: number; last: number; level: number }) => {
    if (o.last - o.start + 1 >= 4) {
      notes.push({ p, start: o.start * frameSec, end: (o.last + 1) * frameSec, level: o.level });
    }
  };
  for (let t = 0; t < active.length; t++) {
    const now = active[t]!;
    for (const [p, level] of now) {
      const o = open.get(p);
      if (!o) {
        open.set(p, { start: t, last: t, level, peak: level });
        continue;
      }
      // A clear rise after a dip is the same pitch struck again.
      if (t - o.start >= 6 && level > o.level * 1.8 && level > o.peak * 0.6) {
        close(p, o);
        open.set(p, { start: t, last: t, level, peak: level });
        continue;
      }
      o.last = t;
      o.level = level;
      o.peak = Math.max(o.peak, level);
    }
    for (const [p, o] of open) {
      if (!now.has(p) && t - o.last > 2) {
        close(p, o);
        open.delete(p);
      }
    }
  }
  for (const [p, o] of open) close(p, o);
  return notes;
}

/** The tempo whose beat grid best fits the onsets, 60-180 bpm, and the grid's phase in seconds. */
export function estimateTempo(onsets: number[]): { bpm: number; phase: number } {
  if (onsets.length < 3) return { bpm: 120, phase: onsets[0] ?? 0 };
  const mag = (bpm: number) => {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * bpm) / 60;
    for (const t of onsets) {
      re += Math.cos(w * t);
      im += Math.sin(w * t);
    }
    return { m: Math.hypot(re, im), a: Math.atan2(im, re) };
  };
  let best = 120;
  let bestScore = -1;
  for (let bpm = 60; bpm <= 180; bpm += 0.25) {
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.8) ** 2);
    const score = (mag(bpm).m + mag(bpm * 2).m) * prior;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  const bpm = Math.round(best);
  const { a } = mag(bpm);
  const period = 60 / bpm;
  const phase = (((a / (2 * Math.PI)) * period) % period + period) % period;
  return { bpm, phase };
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / 12;
  const mb = b.reduce((x, y) => x + y, 0) / 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

/** The key whose profile best matches how long each pitch class sounds. */
export function estimateKey(notes: Note[]): { fifths: number; mode: "major" | "minor" } {
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[n.p % 12] += n.d;
  let best = { fifths: 0, mode: "major" as "major" | "minor", r: -2 };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ["major", "minor"] as const) {
      const profile = mode === "major" ? MAJOR_PROFILE : MINOR_PROFILE;
      const rotated = hist.map((_, i) => profile[(i - tonic + 12) % 12]!);
      const r = correlate(hist, rotated);
      if (r > best.r + 1e-9) best = { fifths: fifthsForTonic(tonic, mode), mode, r };
    }
  }
  return { fifths: best.fifths, mode: best.mode };
}

const NICE = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function nice(beats: number) {
  if (beats > 4) return Math.max(4, Math.round(beats));
  return NICE.reduce((a, b) => (Math.abs(b - beats) < Math.abs(a - beats) ? b : a));
}

/** Places notes on a 16th-note grid; legato overhangs are trimmed to the next onset. */
export function quantize(raw: RawNote[], bpm: number, phase: number, mono: boolean): Note[] {
  if (raw.length === 0) return [];
  const toBeat = (t: number) => ((t - phase) * bpm) / 60;
  const q = (b: number) => Math.round(b * 4) / 4;
  const sorted = [...raw].sort((a, b) => a.start - b.start);
  const shift = q(toBeat(sorted[0]!.start));
  let notes = sorted.map((n) => ({
    p: n.p,
    s: Math.max(0, q(toBeat(n.start)) - shift),
    d: Math.max(0.25, toBeat(n.end) - toBeat(n.start)),
  }));
  // One note per pitch per grid slot.
  const seen = new Set<string>();
  notes = notes.filter((n) => {
    const k = `${n.p}@${n.s}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (mono) {
    // One melodic line: of notes starting together keep the highest.
    const bySlot = new Map<number, Note>();
    for (const n of notes) {
      const o = bySlot.get(n.s);
      if (!o || n.p > o.p) bySlot.set(n.s, n);
    }
    notes = [...bySlot.values()];
  }
  notes = sortNotes(notes);
  const onsets = [...new Set(notes.map((n) => n.s))].sort((a, b) => a - b);
  for (const n of notes) {
    const next = onsets.find((s) => s > n.s);
    let d = n.d;
    if (next !== undefined && n.s + d > next && (mono || n.s + d - next < 0.75)) d = next - n.s;
    n.d = nice(Math.max(0.25, d));
    if (mono && next !== undefined && n.s + n.d > next) n.d = next - n.s;
  }
  return notes;
}

/** Notes, tempo and key of a mono recording at ANALYSIS_RATE. */
export async function transcribe(
  samples: Float32Array,
  instrument: InstrumentId,
  onProgress: (fraction: number) => void = () => {},
): Promise<Transcription> {
  const inst = instrumentOf(instrument);
  // Half a window of silence in front, so frame times are window centres.
  const padded = new Float32Array(samples.length + FRAME);
  padded.set(samples, FRAME / 2);
  const spectra = await semitoneSpectra(padded, ANALYSIS_RATE, (f) => onProgress(f * 0.9));
  let globalMax = 0;
  for (const s of spectra) for (let i = 0; i < s.length; i++) globalMax = Math.max(globalMax, s[i]!);
  const floor = globalMax * 0.03;
  const voices = inst.poly ? (instrument === "guitar" ? 6 : 8) : 1;
  const active = spectra.map((s) => new Map(pickPitches(s, floor, inst.low, inst.high, voices)));
  const frameSec = HOP / ANALYSIS_RATE;
  const raw = trackNotes(active, frameSec).map((n) => ({
    ...n,
    // The window smears each end of a note.
    start: n.start + (FRAME / ANALYSIS_RATE) * 0.15,
    end: Math.max(n.start + 0.05, n.end - (FRAME / ANALYSIS_RATE) * 0.15),
  }));
  onProgress(0.95);
  const onsetTimes: number[] = [];
  for (const t of raw.map((n) => n.start).sort((a, b) => a - b)) {
    if (onsetTimes.length === 0 || t - onsetTimes[onsetTimes.length - 1]! > 0.05) onsetTimes.push(t);
  }
  const { bpm, phase } = estimateTempo(onsetTimes);
  const notes = quantize(raw, bpm, phase, !inst.poly);
  const key = estimateKey(notes);
  onProgress(1);
  return { tempo: bpm, keyFifths: key.fifths, keyMode: key.mode, timeNum: 4, timeDen: 4, notes };
}
