import type { ScoreData } from "./types";

const MAJOR_TONICS: Record<number, string> = {
  [-7]: "C♭", [-6]: "G♭", [-5]: "D♭", [-4]: "A♭", [-3]: "E♭", [-2]: "B♭", [-1]: "F",
  0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F♯", 7: "C♯",
};
const MINOR_TONICS: Record<number, string> = {
  [-7]: "A♭", [-6]: "E♭", [-5]: "B♭", [-4]: "F", [-3]: "C", [-2]: "G", [-1]: "D",
  0: "A", 1: "E", 2: "B", 3: "F♯", 4: "C♯", 5: "G♯", 6: "D♯", 7: "A♯",
};

export function keyName(fifths: number, mode: "major" | "minor"): string {
  return `${(mode === "major" ? MAJOR_TONICS : MINOR_TONICS)[fifths]} ${mode}`;
}

export const KEY_OPTIONS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].flatMap((f) => [
  { value: `${f}:major`, label: keyName(f, "major") },
  { value: `${f}:minor`, label: keyName(f, "minor") },
]);

/** Pitch class of the major tonic for a key signature. */
export function tonicPc(fifths: number, mode: "major" | "minor"): number {
  const major = (((fifths * 7) % 12) + 12) % 12;
  return mode === "major" ? major : (major + 9) % 12;
}

/** The key signature with this major tonic pitch class, preferring fewer accidentals. */
export function fifthsForTonic(pc: number, mode: "major" | "minor"): number {
  const majorPc = mode === "major" ? pc : (pc + 3) % 12;
  for (const f of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
    if ((((f * 7) % 12) + 12) % 12 === majorPc) return f;
  }
  return 0;
}

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
// Order sharps and flats are added to a key signature, as letter indexes.
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/** Each letter's alteration (-1, 0, 1) in a key signature. */
export function keyAlterations(fifths: number): number[] {
  const alt = [0, 0, 0, 0, 0, 0, 0];
  if (fifths > 0) for (let i = 0; i < fifths; i++) alt[SHARP_ORDER[i]!] = 1;
  if (fifths < 0) for (let i = 0; i < -fifths; i++) alt[FLAT_ORDER[i]!] = -1;
  return alt;
}

export interface Spelling {
  /** Letter index 0..6 (C..B). */
  letter: number;
  octave: number;
  /** -1 flat, 0 natural, 1 sharp. */
  alter: number;
  /** Diatonic step counted from C0 (letter + 7 * octave). */
  step: number;
}

/** How a MIDI pitch is written in a key: diatonic in key when possible. */
export function spell(pitch: number, fifths: number): Spelling {
  const alt = keyAlterations(fifths);
  const pc = ((pitch % 12) + 12) % 12;
  let octave = Math.floor(pitch / 12) - 1;
  // In-key spelling first.
  for (let l = 0; l < 7; l++) {
    if ((LETTER_PC[l]! + alt[l]! + 12) % 12 === pc) {
      const oct = LETTER_PC[l]! + alt[l]! < 0 ? octave + 1 : LETTER_PC[l]! + alt[l]! > 11 ? octave - 1 : octave;
      return { letter: l, octave: oct, alter: alt[l]!, step: l + 7 * oct };
    }
  }
  const useFlats = fifths < 0;
  for (let l = 0; l < 7; l++) {
    const a = useFlats ? -1 : 1;
    if ((LETTER_PC[l]! + a + 12) % 12 === pc) {
      const raw = LETTER_PC[l]! + a;
      const oct = raw < 0 ? octave + 1 : raw > 11 ? octave - 1 : octave;
      return { letter: l, octave: oct, alter: a, step: l + 7 * oct };
    }
  }
  for (let l = 0; l < 7; l++) {
    if (LETTER_PC[l] === pc) return { letter: l, octave, alter: 0, step: l + 7 * octave };
  }
  octave = 4;
  return { letter: 0, octave, alter: 0, step: 7 * octave };
}

export function letterName(letter: number) {
  return LETTERS[letter]!;
}

export function pitchName(pitch: number, fifths = 0): string {
  const s = spell(pitch, fifths);
  return `${LETTERS[s.letter]}${s.alter === 1 ? "♯" : s.alter === -1 ? "♭" : ""}${s.octave}`;
}

const DURATION_NAMES: Record<string, string> = {
  "0.25": "sixteenth",
  "0.5": "eighth",
  "0.75": "dotted eighth",
  "1": "quarter",
  "1.5": "dotted quarter",
  "2": "half",
  "3": "dotted half",
  "4": "whole",
};

export function durationName(beats: number): string {
  return DURATION_NAMES[String(beats)] ?? `${beats} beats`;
}

/** Note lengths a member steps through when editing, in beats. */
export const EDIT_LENGTHS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** Lengths that one notehead can show, longest first. */
export const WRITABLE = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];

/** Splits a length into writable pieces, longest first (tied when drawn). */
export function splitLength(beats: number): number[] {
  const out: number[] = [];
  let left = Math.round(beats * 4) / 4;
  while (left > 0.001) {
    const piece = WRITABLE.find((w) => w <= left + 0.001) ?? 0.25;
    out.push(piece);
    left = Math.round((left - piece) * 4) / 4;
  }
  return out;
}

/** "bar.beat", 1-based, for a beat position. */
export function position(beat: number, score: Pick<ScoreData, "timeNum" | "timeDen">) {
  const bar = (score.timeNum * 4) / score.timeDen;
  const unit = 4 / score.timeDen;
  return `${Math.floor(beat / bar) + 1}.${Math.floor((beat % bar) / unit + 1e-6) + 1}`;
}

/** Shifts a key signature by semitones, keeping the mode. */
export function transposeKey(fifths: number, mode: "major" | "minor", semitones: number) {
  const pc = (tonicPc(fifths, mode) + semitones + 120) % 12;
  return fifthsForTonic(pc, mode);
}
