import { writtenOffset } from "./layout";
import { assignFrets, TUNINGS } from "./tab";
import { letterName, spell } from "./theory";
import { instrumentOf, measureBeats, totalBeats, type ScoreData } from "./types";

const DIV = 4; // divisions per quarter: a sixteenth is 1
const TYPES: Record<number, [string, boolean]> = {
  1: ["16th", false], 2: ["eighth", false], 3: ["eighth", true], 4: ["quarter", false],
  6: ["quarter", true], 8: ["half", false], 12: ["half", true], 16: ["whole", false],
};
const PIECES = [16, 12, 8, 6, 4, 3, 2, 1];

function split(div: number): number[] {
  const out: number[] = [];
  while (div > 0) {
    const p = PIECES.find((x) => x <= div)!;
    out.push(p);
    div -= p;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** MusicXML (partwise) of the score; piano gets a grand staff, guitar and bass carry string and fret. */
export function toMusicXml(score: ScoreData): string {
  const grand = score.instrument === "piano" || score.instrument === "all";
  const offset = writtenOffset(score.instrument);
  const mbDiv = Math.round(measureBeats(score) * DIV);
  const measures = Math.max(1, Math.ceil((Math.round(totalBeats(score) * DIV) - 0.001) / mbDiv));
  const tuning = score.instrument === "guitar" || score.instrument === "bass" ? TUNINGS[score.instrument] : null;
  const frets = tuning ? assignFrets(score.notes, tuning) : new Map();
  const staves = grand ? [1, 2] : [1];
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`);
  out.push(`<score-partwise version="4.0">`);
  out.push(`<work><work-title>${esc(score.title)}</work-title></work>`);
  out.push(`<part-list><score-part id="P1"><part-name>${esc(instrumentOf(score.instrument).label)}</part-name>`);
  out.push(`<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>${instrumentOf(score.instrument).program + 1}</midi-program></midi-instrument></score-part></part-list>`);
  out.push(`<part id="P1">`);
  // Each staff's notes as [startDiv, lenDiv, pitch, index] cut at bar lines.
  type Seg = { start: number; len: number; p: number; idx: number; tieStart: boolean; tieStop: boolean };
  const segs: Seg[][][] = staves.map(() => Array.from({ length: measures }, () => []));
  score.notes.forEach((n, idx) => {
    const staff = grand && n.p < 60 ? 1 : 0;
    let start = Math.round(n.s * DIV);
    const end = Math.round((n.s + n.d) * DIV);
    let first = true;
    while (start < end) {
      const m = Math.floor(start / mbDiv);
      const mEnd = Math.min(end, (m + 1) * mbDiv);
      if (m < measures) segs[staff]![m]!.push({ start: start - m * mbDiv, len: mEnd - start, p: n.p, idx, tieStart: mEnd < end, tieStop: !first });
      first = false;
      start = mEnd;
    }
  });
  for (let m = 0; m < measures; m++) {
    out.push(`<measure number="${m + 1}">`);
    if (m === 0) {
      out.push(`<attributes><divisions>${DIV}</divisions><key><fifths>${score.keyFifths}</fifths><mode>${score.keyMode}</mode></key>`);
      out.push(`<time><beats>${score.timeNum}</beats><beat-type>${score.timeDen}</beat-type></time>`);
      if (grand) out.push(`<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>`);
      else if (score.instrument === "bass") out.push(`<clef><sign>F</sign><line>4</line><clef-octave-change>-1</clef-octave-change></clef>`);
      else if (score.instrument === "guitar") out.push(`<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>`);
      else out.push(`<clef><sign>G</sign><line>2</line></clef>`);
      out.push(`</attributes>`);
      out.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type><sound tempo="${score.tempo}"/></direction>`);
    }
    staves.forEach((staffNo, s) => {
      if (s > 0) out.push(`<backup><duration>${mbDiv}</duration></backup>`);
      const list = segs[s]![m]!;
      const groups = new Map<number, Seg[]>();
      for (const seg of list) {
        if (!groups.has(seg.start)) groups.set(seg.start, []);
        groups.get(seg.start)!.push(seg);
      }
      const starts = [...groups.keys()].sort((a, b) => a - b);
      let cursor = 0;
      const rest = (len: number) => {
        for (const piece of split(len)) {
          const [type, dot] = TYPES[piece]!;
          out.push(`<note><rest/><duration>${piece}</duration><voice>${staffNo}</voice><type>${type}</type>${dot ? "<dot/>" : ""}${grand ? `<staff>${staffNo}</staff>` : ""}</note>`);
        }
      };
      starts.forEach((start, gi) => {
        if (start > cursor) rest(start - cursor);
        if (start < cursor) return; // overlapped by the chord before: dropped from this voice
        const group = groups.get(start)!;
        const next = starts[gi + 1] ?? mbDiv;
        const len = Math.max(1, Math.min(Math.min(...group.map((g) => g.len)), next - start));
        const pieces = split(len);
        pieces.forEach((piece, pi) => {
          const [type, dot] = TYPES[piece]!;
          group.forEach((g, ci) => {
            const sp = spell(g.p + offset, score.keyFifths);
            const tieStop = pi > 0 || g.tieStop;
            const tieStart = pi < pieces.length - 1 || (g.tieStart && len === g.len);
            const f = frets.get(g.idx);
            out.push(
              `<note>${ci > 0 ? "<chord/>" : ""}<pitch><step>${letterName(sp.letter)}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ""}<octave>${sp.octave}</octave></pitch>` +
                `<duration>${piece}</duration>${tieStop ? '<tie type="stop"/>' : ""}${tieStart ? '<tie type="start"/>' : ""}<voice>${staffNo}</voice><type>${type}</type>${dot ? "<dot/>" : ""}${grand ? `<staff>${staffNo}</staff>` : ""}` +
                (tieStop || tieStart || (f && pi === 0)
                  ? `<notations>${tieStop ? '<tied type="stop"/>' : ""}${tieStart ? '<tied type="start"/>' : ""}${f && pi === 0 && tuning ? `<technical><string>${tuning.length - f.string}</string><fret>${f.fret}</fret></technical>` : ""}</notations>`
                  : "") +
                `</note>`,
            );
          });
        });
        cursor = start + len;
      });
      if (cursor < mbDiv) rest(mbDiv - cursor);
    });
    out.push(`</measure>`);
  }
  out.push(`</part></score-partwise>`);
  return out.join("\n");
}
