import { describe, expect, it } from "vitest";
import { applyEdits } from "./edits";
import { layoutScore } from "./layout";
import { toMidi } from "./midi";
import { toMusicXml } from "./musicxml";
import { toPdf } from "./pdf";
import { assignFrets, TUNINGS } from "./tab";
import { pitchName, splitLength } from "./theory";
import type { ScoreData } from "./types";

const score: ScoreData = {
  title: "Test & tune", instrument: "guitar", tempo: 90, keyFifths: 2, keyMode: "major", timeNum: 3, timeDen: 4,
  notes: [{ p: 52, s: 0, d: 1 }, { p: 64, s: 0, d: 1 }, { p: 66, s: 1, d: 2.5 }, { p: 73, s: 3.5, d: 0.5 }],
};

describe("music", () => {
  it("spells pitches in the key", () => {
    expect(pitchName(61, 0)).toBe("C♯4");
    expect(pitchName(70, -1)).toBe("B♭4");
    expect(splitLength(2.5)).toEqual([2, 0.5]);
  });
  it("gives each chord note its own string within reach", () => {
    const frets = assignFrets(score.notes, TUNINGS.guitar);
    expect(frets.size).toBe(4);
    expect(frets.get(0)!.string).not.toBe(frets.get(1)!.string);
    for (const [i, f] of frets) expect(TUNINGS.guitar[f.string]! + f.fret).toBe(score.notes[i]!.p);
  });
  it("writes MIDI, MusicXML and PDF", () => {
    const midi = toMidi(score);
    expect(new TextDecoder().decode(midi.slice(0, 4))).toBe("MThd");
    const xml = toMusicXml(score);
    expect(xml).toContain("<work-title>Test &amp; tune</work-title>");
    expect(xml).toContain("<beats>3</beats>");
    expect(xml).toContain("<fret>");
    expect(xml.match(/<measure /g)!.length).toBe(2);
    const pdf = new TextDecoder().decode(toPdf(score));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("(TAB) Tj");
  });
  it("lays out notes and tab", () => {
    const layout = layoutScore(score, { width: 600, tab: true });
    expect(layout.ops.filter((o) => o.t === "head").length).toBeGreaterThanOrEqual(4);
    expect(layout.ops.filter((o) => o.t === "text" && o.fret).length).toBe(4);
  });
  it("applies assistant edits", () => {
    const out = applyEdits(score.notes, [{ op: "delete", i: 0 }, { op: "transpose", semitones: 12 }, { op: "add", p: 40, s: 5, d: 1 }]);
    expect(out.map((n) => n.p)).toEqual([76, 78, 85, 40]);
  });
});
