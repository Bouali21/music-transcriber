import { z } from "zod";
import { MAX_NOTES, sortNotes, type Note } from "./types";

/** Edits the assistant may return, applied to notes in reading order. */
export const editSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), i: z.number().int().min(0), p: z.number().int().min(0).max(127).optional(), s: z.number().min(0).max(4800).optional(), d: z.number().gt(0).max(64).optional() }),
  z.object({ op: z.literal("delete"), i: z.number().int().min(0) }),
  z.object({ op: z.literal("add"), p: z.number().int().min(0).max(127), s: z.number().min(0).max(4800), d: z.number().gt(0).max(64) }),
  z.object({ op: z.literal("transpose"), semitones: z.number().int().min(-48).max(48), from: z.number().min(0).optional(), to: z.number().min(0).optional() }),
]);
export type Edit = z.infer<typeof editSchema>;

export const assistantReplySchema = z.object({
  summary: z.string().max(500),
  edits: z.array(editSchema).max(2000),
});

const grid = (v: number) => Math.max(0, Math.round(v * 4) / 4);

/** Applies edits to sorted notes; indexes refer to the notes before any edit. Pitches stay within 0..127. */
export function applyEdits(notes: Note[], edits: Edit[]): Note[] {
  const working: (Note | null)[] = notes.map((n) => ({ ...n }));
  const added: Note[] = [];
  for (const e of edits) {
    if (e.op === "set" || e.op === "delete") {
      const n = working[e.i];
      if (!n) continue;
      if (e.op === "delete") working[e.i] = null;
      else working[e.i] = { p: e.p ?? n.p, s: e.s !== undefined ? grid(e.s) : n.s, d: e.d !== undefined ? Math.max(0.25, grid(e.d)) : n.d };
    } else if (e.op === "add") {
      added.push({ p: e.p, s: grid(e.s), d: Math.max(0.25, grid(e.d)) });
    } else {
      for (const list of [working, added]) {
        list.forEach((n, i) => {
          if (!n) return;
          if (e.from !== undefined && n.s < e.from) return;
          if (e.to !== undefined && n.s >= e.to) return;
          list[i] = { ...n, p: Math.min(127, Math.max(0, n.p + e.semitones)) };
        });
      }
    }
  }
  return sortNotes([...working.filter((n): n is Note => n !== null), ...added]).slice(0, MAX_NOTES);
}
