import { z } from "zod";

/** One note: MIDI pitch, start and length in quarter-note beats. */
export interface Note {
  p: number;
  s: number;
  d: number;
}

export const INSTRUMENTS = [
  { id: "piano", label: "Piano", low: 21, high: 108, poly: true, program: 0 },
  { id: "guitar", label: "Guitar", low: 40, high: 88, poly: true, program: 24 },
  { id: "bass", label: "Bass", low: 28, high: 67, poly: false, program: 33 },
  { id: "violin", label: "Violin", low: 55, high: 103, poly: false, program: 40 },
  { id: "flute", label: "Flute", low: 60, high: 98, poly: false, program: 73 },
  { id: "trumpet", label: "Trumpet", low: 54, high: 84, poly: false, program: 56 },
  { id: "saxophone", label: "Saxophone", low: 49, high: 81, poly: false, program: 65 },
  { id: "voice", label: "Voice", low: 40, high: 84, poly: false, program: 52 },
  { id: "all", label: "All instruments", low: 21, high: 108, poly: true, program: 0 },
] as const;

export type InstrumentId = (typeof INSTRUMENTS)[number]["id"];
export const INSTRUMENT_IDS = INSTRUMENTS.map((i) => i.id) as [
  InstrumentId,
  ...InstrumentId[],
];

export function instrumentOf(id: string) {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];
}

/** Recordings longer than this are refused. */
export const MAX_SECONDS = 15 * 60;
export const MAX_NOTES = 20000;
export const MAX_BEATS = 4 * 1200; // 15 minutes at up to 320 bpm

export const TIME_SIGNATURES = [
  [2, 4],
  [3, 4],
  [4, 4],
  [6, 8],
] as const;

export const noteSchema = z
  .object({
    p: z.number().int().min(0).max(127),
    s: z.number().min(0).max(MAX_BEATS),
    d: z.number().gt(0).max(64),
  })
  .strict();

export const scoreFieldsSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  tempo: z.number().int().min(20).max(320),
  keyFifths: z.number().int().min(-7).max(7),
  keyMode: z.enum(["major", "minor"]),
  timeNum: z.number().int().min(1).max(16),
  timeDen: z.union([z.literal(2), z.literal(4), z.literal(8)]),
  notes: z.array(noteSchema).max(MAX_NOTES),
});

export interface ScoreData {
  title: string;
  instrument: InstrumentId;
  tempo: number;
  keyFifths: number;
  keyMode: "major" | "minor";
  timeNum: number;
  timeDen: number;
  notes: Note[];
}

/** Notes in reading order: by start, then low to high. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.s - b.s || a.p - b.p);
}

export function measureBeats(score: Pick<ScoreData, "timeNum" | "timeDen">) {
  return (score.timeNum * 4) / score.timeDen;
}

export function totalBeats(score: Pick<ScoreData, "notes">) {
  return score.notes.reduce((m, n) => Math.max(m, n.s + n.d), 0);
}
