import type { Note } from "./types";

/** Open-string pitches, lowest string first, in standard tuning. */
export const TUNINGS = {
  guitar: [40, 45, 50, 55, 59, 64],
  bass: [28, 33, 38, 43],
} as const;
const MAX_FRET = 22;

export interface Fretting {
  /** 0 = lowest string. */
  string: number;
  fret: number;
}

/**
 * A string and fret for each note (by index into `notes`, which are in
 * reading order). Notes sounding together get different strings; the hand
 * stays near where it was. Unplayable notes are left out.
 */
export function assignFrets(notes: Note[], tuning: readonly number[]): Map<number, Fretting> {
  const out = new Map<number, Fretting>();
  let hand = 0;
  let i = 0;
  while (i < notes.length) {
    let j = i;
    while (j < notes.length && notes[j]!.s === notes[i]!.s) j++;
    const chord = [] as number[];
    for (let k = i; k < j; k++) chord.push(k);
    chord.sort((a, b) => notes[b]!.p - notes[a]!.p);
    const used = new Set<number>();
    const frets: number[] = [];
    for (const k of chord) {
      const p = notes[k]!.p;
      let best: Fretting | null = null;
      let bestCost = Infinity;
      for (let s = tuning.length - 1; s >= 0; s--) {
        if (used.has(s)) continue;
        const fret = p - tuning[s]!;
        if (fret < 0 || fret > MAX_FRET) continue;
        const cost = fret === 0 ? 0.5 : Math.abs(fret - hand) + fret * 0.05;
        if (cost < bestCost) {
          bestCost = cost;
          best = { string: s, fret };
        }
      }
      if (best) {
        used.add(best.string);
        out.set(k, best);
        if (best.fret > 0) frets.push(best.fret);
      }
    }
    if (frets.length) hand = frets.reduce((a, b) => a + b, 0) / frets.length;
    i = j;
  }
  return out;
}
