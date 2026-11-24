import { instrumentOf, type ScoreData } from "./types";

const PPQ = 480;

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

/** A Standard MIDI File (format 0) of the score. */
export function toMidi(score: ScoreData): Uint8Array<ArrayBuffer> {
  const program = instrumentOf(score.instrument).program;
  const events: { tick: number; order: number; data: number[] }[] = [];
  const usPerQuarter = Math.round(60_000_000 / score.tempo);
  events.push({ tick: 0, order: 0, data: [0xff, 0x51, 3, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255] });
  events.push({ tick: 0, order: 0, data: [0xff, 0x58, 4, score.timeNum, Math.log2(score.timeDen), 24, 8] });
  events.push({ tick: 0, order: 0, data: [0xff, 0x59, 2, score.keyFifths & 255, score.keyMode === "minor" ? 1 : 0] });
  events.push({ tick: 0, order: 0, data: [0xc0, program] });
  for (const n of score.notes) {
    const on = Math.round(n.s * PPQ);
    const off = Math.round((n.s + n.d) * PPQ);
    events.push({ tick: on, order: 2, data: [0x90, n.p, 80] });
    events.push({ tick: off, order: 1, data: [0x80, n.p, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
  const len = track.length;
  return new Uint8Array([...header, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...track]);
}
