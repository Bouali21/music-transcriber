// Lays a score out as drawing operations, shared by the on-screen SVG and the PDF.
import { assignFrets, TUNINGS } from "./tab";
import { keyAlterations, splitLength, spell } from "./theory";
import { measureBeats, totalBeats, type ScoreData } from "./types";

export type Op =
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; w: number; note?: number }
  | { t: "head"; x: number; y: number; rx: number; ry: number; filled: boolean; note: number }
  | { t: "path"; d: string; fill: boolean; w: number; note?: number }
  | { t: "text"; x: number; y: number; s: string; size: number; bold?: boolean; anchor?: "start" | "middle" | "end"; note?: number; fret?: boolean }
  | { t: "mask"; x: number; y: number; w: number; h: number }
  | { t: "dot"; x: number; y: number; r: number; note?: number };

export interface Layout {
  width: number;
  height: number;
  ops: Op[];
  /** Vertical extent of each system, for page breaks. */
  systems: { top: number; bottom: number }[];
  /** Measure x ranges per system, for the playhead. */
  measures: { system: number; start: number; beats: number; x0: number; x1: number; map: [number, number][] }[];
  unplayable: number;
}

type Clef = "treble" | "bass";
interface Staff { clef: Clef; filter: (p: number) => boolean }

const fmt = (n: number) => Math.round(n * 100) / 100;

function stavesFor(instrument: string): Staff[] {
  if (instrument === "piano" || instrument === "all") {
    return [
      { clef: "treble", filter: (p) => p >= 60 },
      { clef: "bass", filter: (p) => p < 60 },
    ];
  }
  if (instrument === "bass") return [{ clef: "bass", filter: () => true }];
  return [{ clef: "treble", filter: () => true }];
}

/** Guitar and bass are written an octave above how they sound. */
export function writtenOffset(instrument: string) {
  return instrument === "guitar" || instrument === "bass" ? 12 : 0;
}

const BOTTOM_STEP: Record<Clef, number> = { treble: 30, bass: 18 };
const SHARP_STEPS: Record<Clef, number[]> = { treble: [38, 35, 39, 36, 33, 37, 34], bass: [24, 21, 25, 22, 19, 23, 20] };
const FLAT_STEPS: Record<Clef, number[]> = { treble: [34, 37, 33, 36, 32, 35, 31], bass: [20, 23, 19, 22, 18, 21, 17] };

interface Piece { note: number; p: number; start: number; len: number; tieNext: boolean }

export function layoutScore(
  score: ScoreData,
  opts: { width: number; staff?: boolean; tab?: boolean; sp?: number },
): Layout {
  const sp = opts.sp ?? 8;
  const showStaff = opts.staff ?? true;
  const tuning = opts.tab && (score.instrument === "guitar" || score.instrument === "bass") ? TUNINGS[score.instrument] : null;
  const notes = score.notes;
  const frets = tuning ? assignFrets(notes, tuning) : new Map();
  const staves = showStaff ? stavesFor(score.instrument) : [];
  const offset = writtenOffset(score.instrument);
  const mb = measureBeats(score);
  const measureCount = Math.max(1, Math.ceil((totalBeats(score) - 1e-6) / mb));
  const ops: Op[] = [];

  // Pieces per staff per measure: notes cut at bar lines and into writable lengths.
  const pieces: Piece[][][] = staves.map(() => Array.from({ length: measureCount }, () => []));
  const tabPieces: Piece[][] = Array.from({ length: measureCount }, () => []);
  notes.forEach((n, idx) => {
    const sIdx = staves.findIndex((st) => st.filter(n.p));
    let start = n.s;
    const end = n.s + n.d;
    let first = true;
    while (start < end - 1e-6) {
      const m = Math.floor(start / mb + 1e-9);
      const mEnd = Math.min(end, (m + 1) * mb);
      const parts = splitLength(mEnd - start);
      let at = start;
      parts.forEach((len, k) => {
        const piece = { note: idx, p: n.p + offset, start: at - m * mb, len, tieNext: at + len < end - 1e-6 };
        if (sIdx >= 0 && m < measureCount) pieces[sIdx]![m]!.push(piece);
        if (first && k === 0 && m < measureCount) tabPieces[m]!.push(piece);
        at += len;
      });
      first = false;
      start = mEnd;
    }
  });

  // Rests fill the gaps of each staff's measure.
  const rests: { start: number; len: number }[][][] = staves.map((_, s) =>
    pieces[s]!.map((list) => {
      const out: { start: number; len: number }[] = [];
      if (list.length === 0) return [{ start: 0, len: mb }];
      const covered = [...list].sort((a, b) => a.start - b.start);
      let at = 0;
      for (const pc of covered) {
        if (pc.start > at + 1e-6) for (const len of splitLength(pc.start - at)) { out.push({ start: at, len }); at += len; }
        at = Math.max(at, pc.start + pc.len);
      }
      if (at < mb - 1e-6) for (const len of splitLength(mb - at)) { out.push({ start: at, len }); at += len; }
      return out;
    }),
  );

  // Horizontal positions of every event in each measure.
  const events: number[][] = Array.from({ length: measureCount }, (_, m) => {
    const set = new Set<number>([0]);
    staves.forEach((_, s) => {
      for (const pc of pieces[s]![m]!) set.add(fmt(pc.start));
      for (const r of rests[s]![m]!) set.add(fmt(r.start));
    });
    for (const pc of tabPieces[m]!) set.add(fmt(pc.start));
    return [...set].sort((a, b) => a - b);
  });
  const weights = events.map((ev) =>
    ev.map((b, i) => 1.4 + Math.log2(1 + 4 * ((ev[i + 1] ?? mb) - b))),
  );
  const unit = sp * 1.9;
  const minWidth = weights.map((w) => w.reduce((a, b) => a + b, 0) * unit + sp * 2);

  const keyWidth = Math.abs(score.keyFifths) * sp * 1.1;
  const headerWidth = (first: boolean) => sp * 4.7 + keyWidth + (first ? sp * 3 : 0) + sp;
  const staffGap = sp * 8;
  const tabSpacing = sp * 1.6;
  const staffBlock = staves.length * sp * 4 + Math.max(0, staves.length - 1) * staffGap;
  const tabBlock = tuning ? (tuning.length - 1) * tabSpacing : 0;
  const systemHeight = sp * 6 + staffBlock + (tuning && staves.length ? sp * 4 : 0) + tabBlock + sp * 6;

  // Fill systems with measures.
  const systemsMeasures: number[][] = [];
  let current: number[] = [];
  let used = headerWidth(true);
  for (let m = 0; m < measureCount; m++) {
    const avail = opts.width - headerWidth(systemsMeasures.length === 0);
    if (current.length > 0 && used + minWidth[m]! > opts.width) {
      systemsMeasures.push(current);
      current = [];
      used = headerWidth(false);
    }
    current.push(m);
    used += Math.min(minWidth[m]!, avail);
  }
  if (current.length) systemsMeasures.push(current);

  const layout: Layout = { width: opts.width, height: 0, ops, systems: [], measures: [], unplayable: 0 };
  const alts = keyAlterations(score.keyFifths);

  systemsMeasures.forEach((ms, sysIdx) => {
    const top = sysIdx * systemHeight;
    const staffTop = staves.map((_, i) => top + sp * 6 + i * (sp * 4 + staffGap));
    const tabTop = top + sp * 6 + staffBlock + (staves.length ? sp * 4 : 0);
    const bottomOf = (i: number) => staffTop[i]! + sp * 4;
    const sysTop = staves.length ? staffTop[0]! : tabTop;
    const sysBottom = tuning ? tabTop + tabBlock : bottomOf(staves.length - 1);
    layout.systems.push({ top, bottom: top + systemHeight });
    const x0 = 0;
    const x1 = opts.width - 1;
    // Staff lines.
    staves.forEach((_, i) => {
      for (let l = 0; l < 5; l++) ops.push({ t: "line", x1: x0, y1: staffTop[i]! + l * sp, x2: x1, y2: staffTop[i]! + l * sp, w: 1 });
    });
    if (tuning) {
      for (let l = 0; l < tuning.length; l++) ops.push({ t: "line", x1: x0, y1: tabTop + l * tabSpacing, x2: x1, y2: tabTop + l * tabSpacing, w: 1 });
    }
    ops.push({ t: "line", x1: x0, y1: sysTop, x2: x0, y2: sysBottom, w: 1.5 });
    if (staves.length === 2) ops.push({ t: "line", x1: x0 - 3, y1: sysTop, x2: x0 - 3, y2: sysBottom, w: 3 });
    ops.push({ t: "text", x: sp * 0.5, y: top + sp * 3, s: String(ms[0]! + 1), size: sp * 1.2 });
    // Clefs, key and time signatures.
    let x = sp * 1;
    staves.forEach((st, i) => drawClef(ops, st.clef, x + sp * 1.2, staffTop[i]!, sp));
    if (tuning) {
      ops.push({ t: "text", x: x + sp * 1.2, y: tabTop + tabBlock / 2 + sp * 0.5, s: "TAB", size: sp * 1.4, bold: true, anchor: "middle" });
    }
    x += sp * 4.2;
    staves.forEach((st, i) => {
      const steps = score.keyFifths > 0 ? SHARP_STEPS[st.clef] : FLAT_STEPS[st.clef];
      for (let k = 0; k < Math.abs(score.keyFifths); k++) {
        const y = staffTop[i]! + sp * 4 - (steps[k]! - BOTTOM_STEP[st.clef]) * (sp / 2);
        drawAccidental(ops, score.keyFifths > 0 ? 1 : -1, x + k * sp * 1.1 + sp * 0.4, y, sp);
      }
    });
    x += keyWidth;
    if (sysIdx === 0) {
      staves.forEach((_, i) => {
        ops.push({ t: "text", x: x + sp, y: staffTop[i]! + sp * 1.85, s: String(score.timeNum), size: sp * 2.4, bold: true, anchor: "middle" });
        ops.push({ t: "text", x: x + sp, y: staffTop[i]! + sp * 3.85, s: String(score.timeDen), size: sp * 2.4, bold: true, anchor: "middle" });
      });
      x += sp * 3;
    }
    x += sp;
    // Measures stretched to the full width.
    const total = ms.reduce((a, m) => a + minWidth[m]!, 0);
    const isLast = sysIdx === systemsMeasures.length - 1;
    const stretch = isLast && total < (opts.width - x) * 0.6 ? 1 : (opts.width - x) / total;
    for (const m of ms) {
      const mw = minWidth[m]! * stretch;
      const ev = events[m]!;
      const w = weights[m]!;
      const wsum = w.reduce((a, b) => a + b, 0);
      const map: [number, number][] = [];
      let cx = x + sp;
      ev.forEach((b, i) => {
        map.push([b, cx]);
        cx += (w[i]! / wsum) * (mw - sp * 2);
      });
      const xAt = (b: number) => map.find(([e]) => Math.abs(e - fmt(b)) < 1e-6)?.[1] ?? x + sp;
      layout.measures.push({ system: sysIdx, start: m * mb, beats: mb, x0: x, x1: x + mw, map: [...map, [mb, x + mw - sp * 0.5]] });

      staves.forEach((st, i) => drawStaffMeasure(ops, st.clef, staffTop[i]!, pieces[i]![m]!, rests[i]![m]!, xAt, sp, score.keyFifths, alts, mb));
      if (tuning) {
        for (const pc of tabPieces[m]!) {
          const f = frets.get(pc.note);
          if (!f) continue;
          const y = tabTop + (tuning.length - 1 - f.string) * tabSpacing;
          const label = String(f.fret);
          const px = xAt(pc.start);
          ops.push({ t: "mask", x: px - sp * 0.45 * label.length, y: y - sp * 0.65, w: sp * 0.9 * label.length, h: sp * 1.3 });
          ops.push({ t: "text", x: px, y: y + sp * 0.45, s: label, size: sp * 1.25, anchor: "middle", note: pc.note, fret: true });
        }
      }
      x += mw;
      ops.push({ t: "line", x1: x, y1: sysTop, x2: x, y2: sysBottom, w: 1 });
    }
    if (isLast) ops.push({ t: "line", x1: x - 2, y1: sysTop, x2: x - 2, y2: sysBottom, w: 3 });
    // Lines end at the last bar line.
    for (const op of ops) {
      if (op.t === "line" && op.x2 === x1 && op.y1 === op.y2 && op.y1 >= top && op.y1 <= top + systemHeight) op.x2 = x;
    }
  });
  if (tuning) layout.unplayable = notes.length - frets.size;
  layout.height = systemsMeasures.length * systemHeight;
  return layout;
}

function drawStaffMeasure(
  ops: Op[],
  clef: Clef,
  staffTop: number,
  pieces: Piece[],
  rests: { start: number; len: number }[],
  xAt: (b: number) => number,
  sp: number,
  fifths: number,
  keyAlts: number[],
  mb: number,
) {
  const bottomStep = BOTTOM_STEP[clef];
  const yOf = (step: number) => staffTop + sp * 4 - (step - bottomStep) * (sp / 2);
  const middle = bottomStep + 4;
  const state = new Map<number, number>();
  // Group pieces into chords by start.
  const groups = new Map<number, Piece[]>();
  for (const pc of pieces) {
    const k = fmt(pc.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(pc);
  }
  for (const [start, group] of [...groups].sort((a, b) => a[0] - b[0])) {
    const x = xAt(start);
    const len = Math.min(...group.map((g) => g.len));
    const spelled = group.map((g) => ({ g, s: spell(g.p, fifths) }));
    const avg = spelled.reduce((a, b) => a + b.s.step, 0) / spelled.length;
    const up = avg < middle;
    const rx = sp * 0.62;
    const ry = sp * 0.45;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const { g, s } of spelled) {
      const y = yOf(s.step);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const filled = g.len < 2;
      // Ledger lines, under the head.
      for (let st = bottomStep - 2; st >= s.step; st -= 2) ops.push({ t: "line", x1: x - rx * 1.6, y1: yOf(st), x2: x + rx * 1.6, y2: yOf(st), w: 1 });
      for (let st = bottomStep + 10; st <= s.step; st += 2) ops.push({ t: "line", x1: x - rx * 1.6, y1: yOf(st), x2: x + rx * 1.6, y2: yOf(st), w: 1 });
      ops.push({ t: "head", x, y, rx, ry, filled, note: g.note });
      // Accidentals against the key and earlier notes in the bar.
      const current = state.has(s.step) ? state.get(s.step)! : keyAlts[s.letter]!;
      if (current !== s.alter) {
        drawAccidental(ops, s.alter, x - rx - sp * 0.9, y, sp, g.note);
        state.set(s.step, s.alter);
      }
      if ([0.75, 1.5, 3].includes(g.len)) {
        const onLine = (s.step - bottomStep) % 2 === 0;
        ops.push({ t: "dot", x: x + rx + sp * 0.5, y: onLine ? y - sp * 0.5 : y, r: sp * 0.18, note: g.note });
      }
      if (g.tieNext) {
        const tx = x + rx;
        const dir = up ? 1 : -1;
        ops.push({ t: "path", d: `M${fmt(tx)} ${fmt(y + dir * ry)} Q${fmt(tx + sp * 1.4)} ${fmt(y + dir * sp * 1.3)} ${fmt(tx + sp * 2.8)} ${fmt(y + dir * ry)}`, fill: false, w: 1, note: g.note });
      }
    }
    if (len < 4) {
      const lead = group[0]!.note;
      const stemX = up ? x + rx - 0.6 : x - rx + 0.6;
      const y1 = up ? maxY : minY;
      const y2 = up ? minY - sp * 3.4 : maxY + sp * 3.4;
      ops.push({ t: "line", x1: stemX, y1, x2: stemX, y2, w: 1.2, note: lead });
      const flags = len < 0.5 ? 2 : len < 1 ? 1 : 0;
      for (let f = 0; f < flags; f++) {
        const fy = y2 + (up ? 1 : -1) * f * sp * 0.9;
        const d = up
          ? `M${fmt(stemX)} ${fmt(fy)} C${fmt(stemX + sp * 0.2)} ${fmt(fy + sp)} ${fmt(stemX + sp * 1.4)} ${fmt(fy + sp * 1.2)} ${fmt(stemX + sp * 0.9)} ${fmt(fy + sp * 2.6)}`
          : `M${fmt(stemX)} ${fmt(fy)} C${fmt(stemX + sp * 0.2)} ${fmt(fy - sp)} ${fmt(stemX + sp * 1.4)} ${fmt(fy - sp * 1.2)} ${fmt(stemX + sp * 0.9)} ${fmt(fy - sp * 2.6)}`;
        ops.push({ t: "path", d, fill: false, w: 1.4, note: lead });
      }
    }
  }
  for (const r of rests) drawRest(ops, r.len >= mb - 1e-6 && rests.length === 1 ? 4 : r.len, xAt(r.start), staffTop, sp);
}

function drawRest(ops: Op[], len: number, x: number, staffTop: number, sp: number) {
  const mid = staffTop + sp * 2;
  if (len >= 2) {
    // Whole rest hangs from the fourth line; half rest sits on the middle line.
    const y = len >= 4 ? staffTop + sp : mid - sp * 0.5;
    ops.push({ t: "path", d: `M${fmt(x - sp * 0.6)} ${fmt(y)} h${fmt(sp * 1.2)} v${fmt(sp * 0.5)} h${fmt(-sp * 1.2)} Z`, fill: true, w: 1 });
    if (len === 3 || len === 1.5) ops.push({ t: "dot", x: x + sp, y: y, r: sp * 0.18 });
    return;
  }
  if (len >= 1) {
    const d = `M${fmt(x - sp * 0.2)} ${fmt(mid - sp * 1.5)} L${fmt(x + sp * 0.5)} ${fmt(mid - sp * 0.6)} L${fmt(x - sp * 0.2)} ${fmt(mid + sp * 0.2)} L${fmt(x + sp * 0.5)} ${fmt(mid + sp * 0.9)} Q${fmt(x - sp * 0.6)} ${fmt(mid + sp * 0.7)} ${fmt(x + sp * 0.1)} ${fmt(mid + sp * 1.6)}`;
    ops.push({ t: "path", d, fill: false, w: 1.8 });
    if (len === 1.5) ops.push({ t: "dot", x: x + sp, y: mid, r: sp * 0.18 });
    return;
  }
  const flags = len < 0.5 ? 2 : 1;
  ops.push({ t: "line", x1: x + sp * 0.4, y1: mid - sp * 0.6, x2: x - sp * 0.1, y2: mid + sp * 1.2, w: 1.2 });
  for (let f = 0; f < flags; f++) {
    const y = mid - sp * 0.5 + f * sp * 0.8;
    ops.push({ t: "dot", x: x - sp * 0.3, y, r: sp * 0.25 });
    ops.push({ t: "line", x1: x - sp * 0.3, y1: y, x2: x + sp * 0.4 - f * sp * 0.2, y2: y - sp * 0.1, w: 1 });
  }
  if (len === 0.75) ops.push({ t: "dot", x: x + sp * 0.9, y: mid, r: sp * 0.18 });
}

function drawAccidental(ops: Op[], alter: number, x: number, y: number, sp: number, note?: number) {
  if (alter === 1) {
    ops.push({ t: "line", x1: x - sp * 0.2, y1: y - sp * 1.1, x2: x - sp * 0.2, y2: y + sp * 1.2, w: 1, note });
    ops.push({ t: "line", x1: x + sp * 0.2, y1: y - sp * 1.2, x2: x + sp * 0.2, y2: y + sp * 1.1, w: 1, note });
    ops.push({ t: "line", x1: x - sp * 0.45, y1: y - sp * 0.25, x2: x + sp * 0.45, y2: y - sp * 0.45, w: 2, note });
    ops.push({ t: "line", x1: x - sp * 0.45, y1: y + sp * 0.45, x2: x + sp * 0.45, y2: y + sp * 0.25, w: 2, note });
  } else if (alter === -1) {
    ops.push({ t: "line", x1: x - sp * 0.3, y1: y - sp * 1.6, x2: x - sp * 0.3, y2: y + sp * 0.5, w: 1.1, note });
    ops.push({ t: "path", d: `M${fmt(x - sp * 0.3)} ${fmt(y)} C${fmt(x + sp * 0.2)} ${fmt(y - sp * 0.6)} ${fmt(x + sp * 0.8)} ${fmt(y - sp * 0.1)} ${fmt(x - sp * 0.3)} ${fmt(y + sp * 0.5)}`, fill: false, w: 1.3, note });
  } else {
    ops.push({ t: "line", x1: x - sp * 0.3, y1: y - sp * 1.2, x2: x - sp * 0.3, y2: y + sp * 0.5, w: 1, note });
    ops.push({ t: "line", x1: x + sp * 0.3, y1: y - sp * 0.5, x2: x + sp * 0.3, y2: y + sp * 1.2, w: 1, note });
    ops.push({ t: "line", x1: x - sp * 0.3, y1: y - sp * 0.3, x2: x + sp * 0.3, y2: y - sp * 0.45, w: 1.8, note });
    ops.push({ t: "line", x1: x - sp * 0.3, y1: y + sp * 0.45, x2: x + sp * 0.3, y2: y + sp * 0.3, w: 1.8, note });
  }
}

function drawClef(ops: Op[], clef: Clef, x: number, staffTop: number, sp: number) {
  const f = (n: number) => fmt(n);
  if (clef === "treble") {
    const gy = staffTop + sp * 3; // the G line
    const d = [
      `M${f(x + sp * 0.3)} ${f(gy + sp * 2.6)}`,
      `C${f(x - sp * 0.5)} ${f(gy + sp * 2.9)} ${f(x - sp * 0.6)} ${f(gy + sp * 1.9)} ${f(x + sp * 0.05)} ${f(gy + sp * 1.9)}`,
      `C${f(x + sp * 0.5)} ${f(gy + sp * 1.9)} ${f(x + sp * 0.4)} ${f(gy + sp * 2.4)} ${f(x + sp * 0.3)} ${f(gy + sp * 2.6)}`,
      `L${f(x + sp * 0.15)} ${f(gy - sp * 4.6)}`,
      `C${f(x + sp * 1.3)} ${f(gy - sp * 3.6)} ${f(x + sp * 0.9)} ${f(gy - sp * 2.4)} ${f(x - sp * 0.7)} ${f(gy - sp * 0.9)}`,
      `C${f(x - sp * 1.5)} ${f(gy + sp * 0.2)} ${f(x - sp * 0.6)} ${f(gy + sp * 1.5)} ${f(x + sp * 0.6)} ${f(gy + sp * 1.0)}`,
      `C${f(x + sp * 1.5)} ${f(gy + sp * 0.5)} ${f(x + sp * 0.9)} ${f(gy - sp * 0.9)} ${f(x + sp * 0.1)} ${f(gy - sp * 0.6)}`,
      `C${f(x - sp * 0.5)} ${f(gy - sp * 0.3)} ${f(x - sp * 0.4)} ${f(gy + sp * 0.4)} ${f(x + sp * 0.1)} ${f(gy + sp * 0.4)}`,
    ].join(" ");
    ops.push({ t: "path", d, fill: false, w: 1.6 });
  } else {
    const fy = staffTop + sp; // the F line
    const d = `M${f(x - sp * 0.5)} ${f(fy)} C${f(x - sp * 0.5)} ${f(fy - sp * 1.3)} ${f(x + sp * 1.7)} ${f(fy - sp * 1.4)} ${f(x + sp * 1.7)} ${f(fy + sp * 0.3)} C${f(x + sp * 1.7)} ${f(fy + sp * 1.7)} ${f(x + sp * 0.4)} ${f(fy + sp * 2.7)} ${f(x - sp * 0.6)} ${f(fy + sp * 3)}`;
    ops.push({ t: "path", d, fill: false, w: 1.8 });
    ops.push({ t: "dot", x: x - sp * 0.35, y: fy, r: sp * 0.35 });
    ops.push({ t: "dot", x: x + sp * 2.3, y: fy - sp * 0.5, r: sp * 0.18 });
    ops.push({ t: "dot", x: x + sp * 2.3, y: fy + sp * 0.5, r: sp * 0.18 });
  }
}

/** The x of a beat on the laid-out score, and the system it falls in. */
export function playheadAt(layout: Layout, beat: number): { x: number; system: number } | null {
  const m = layout.measures.find((ms) => beat >= ms.start - 1e-6 && beat < ms.start + ms.beats);
  if (!m) return null;
  const local = beat - m.start;
  let prev = m.map[0]!;
  for (const pt of m.map) {
    if (pt[0] > local) {
      const t = (local - prev[0]) / (pt[0] - prev[0] || 1);
      return { x: prev[1] + t * (pt[1] - prev[1]), system: m.system };
    }
    prev = pt;
  }
  return { x: prev[1], system: m.system };
}
