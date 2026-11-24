import { describe, expect, it } from "vitest";
import { ANALYSIS_RATE, transcribe } from "./detect";

const MELODY: [number, number][] = [
  [60, 1], [64, 1], [67, 1], [72, 1], [71, 1], [67, 1], [69, 1], [65, 1],
  [64, 1], [62, 1], [60, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 2],
];

function synth(melody: [number, number][], bpm: number) {
  const sr = ANALYSIS_RATE;
  const beat = 60 / bpm;
  const total = melody.reduce((a, [, b]) => a + b, 0) * beat + 0.5;
  const out = new Float32Array(Math.ceil(total * sr));
  let t = 0;
  for (const [midi, beats] of melody) {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const len = beats * beat - 0.04;
    const start = Math.round(t * sr);
    for (let i = 0; i < len * sr; i++) {
      const x = i / sr;
      const env = Math.min(1, x / 0.005) * Math.exp(-x * 1.5) * Math.min(1, (len - x) / 0.01);
      out[start + i]! += 0.5 * env * (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(4 * Math.PI * f * x) + 0.15 * Math.sin(6 * Math.PI * f * x));
    }
    t += beats * beat;
  }
  return out;
}

describe("transcribe", () => {
  it("finds the melody, its tempo and key", async () => {
    const result = await transcribe(synth(MELODY, 120), "piano");
    expect(result.tempo).toBe(120);
    expect(result.keyFifths).toBe(0);
    expect(result.keyMode).toBe("major");
    expect(result.notes.map((n) => n.p)).toEqual(MELODY.map(([p]) => p));
    expect(result.notes[0]).toEqual({ p: 60, s: 0, d: 1 });
    expect(result.notes.map((n) => n.s)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("keeps one line inside a single-line instrument's range", async () => {
    const result = await transcribe(synth([[48, 1], [72, 1], [74, 1], [76, 2]], 100), "flute");
    expect(result.notes.every((n) => n.p >= 60 && n.p <= 98)).toBe(true);
    for (let i = 1; i < result.notes.length; i++) {
      expect(result.notes[i]!.s).toBeGreaterThanOrEqual(result.notes[i - 1]!.s + result.notes[i - 1]!.d);
    }
  });
});
