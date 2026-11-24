import { and, desc, eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { db } from "@/db";
import { scores, users } from "@/db/schema";
import {
  INSTRUMENT_IDS,
  MAX_SECONDS,
  scoreFieldsSchema,
  sortNotes,
  type InstrumentId,
  type Note,
} from "@/lib/music/types";

/** Largest recording accepted, in bytes. */
export const MAX_UPLOAD_BYTES = 90 * 1024 * 1024;

export const createInput = scoreFieldsSchema.extend({
  instrument: z.enum(INSTRUMENT_IDS),
  durationSec: z
    .number()
    .min(0)
    .max(MAX_SECONDS, "Recordings can be at most 15 minutes long."),
});

export const updateInput = scoreFieldsSchema
  .partial()
  .extend({ version: z.number().int().min(1) })
  .strict();

export const idInput = z.object({ id: z.string().uuid() }).strict();

export interface ScoreSummary {
  id: string;
  title: string;
  instrument: InstrumentId;
  durationSec: number;
  noteCount: number;
  updatedAt: string;
}

export interface Score extends ScoreSummary {
  tempo: number;
  keyFifths: number;
  keyMode: "major" | "minor";
  timeNum: number;
  timeDen: number;
  notes: Note[];
  version: number;
  shared: boolean;
  shareToken: string | null;
}

type Row = typeof scores.$inferSelect;

function toScore(row: Row): Score {
  return {
    id: row.id,
    title: row.title,
    instrument: row.instrument as InstrumentId,
    durationSec: row.durationSec,
    noteCount: row.noteCount,
    updatedAt: row.updatedAt,
    tempo: row.tempo,
    keyFifths: row.keyFifths,
    keyMode: row.keyMode,
    timeNum: row.timeNum,
    timeDen: row.timeDen,
    notes: JSON.parse(row.notes) as Note[],
    version: row.version,
    shared: row.shareToken !== null,
    shareToken: row.shareToken,
  };
}

/** Records the member on first sight, keeping the email the Gateway sends. */
export async function ensureUser(user: { id: string; email: string }) {
  await db
    .insert(users)
    .values({ id: user.id, email: user.email })
    .onConflictDoUpdate({ target: users.id, set: { email: user.email } });
}

export function listScores(ownerId: string): Promise<ScoreSummary[]> {
  return db
    .select({
      id: scores.id,
      title: scores.title,
      instrument: sql<InstrumentId>`${scores.instrument}`,
      durationSec: scores.durationSec,
      noteCount: scores.noteCount,
      updatedAt: scores.updatedAt,
    })
    .from(scores)
    .where(eq(scores.ownerId, ownerId))
    .orderBy(desc(scores.updatedAt));
}

export async function getScore(ownerId: string, id: string): Promise<Score | null> {
  const [row] = await db
    .select()
    .from(scores)
    .where(and(eq(scores.id, id), eq(scores.ownerId, ownerId)));
  return row ? toScore(row) : null;
}

/** Stores the recording under the owner's prefix, then the score; the recording goes again if the score can't be written. */
export async function createScore(
  user: { id: string; email: string },
  input: z.infer<typeof createInput>,
  audio: { data: ArrayBuffer; type: string },
): Promise<Score> {
  await ensureUser(user);
  const id = crypto.randomUUID();
  const audioKey = `users/${user.id}/${id}`;
  await env.files.put(audioKey, audio.data, { httpMetadata: { contentType: audio.type } });
  const now = new Date().toISOString();
  const notes = sortNotes(input.notes);
  try {
    const [row] = await db
      .insert(scores)
      .values({
        id,
        ownerId: user.id,
        title: input.title,
        instrument: input.instrument,
        tempo: input.tempo,
        keyFifths: input.keyFifths,
        keyMode: input.keyMode,
        timeNum: input.timeNum,
        timeDen: input.timeDen,
        durationSec: input.durationSec,
        notes: JSON.stringify(notes),
        noteCount: notes.length,
        audioKey,
        audioType: audio.type,
        audioBytes: audio.data.byteLength,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toScore(row!);
  } catch (error) {
    await env.files.delete(audioKey);
    throw error;
  }
}

/** The saved score; "conflict" when the copy saved from is no longer the latest; null when not the owner's. */
export async function updateScore(
  ownerId: string,
  id: string,
  { version, notes, ...fields }: z.infer<typeof updateInput>,
): Promise<Score | "conflict" | null> {
  const sorted = notes ? sortNotes(notes) : undefined;
  const [row] = await db
    .update(scores)
    .set({
      ...fields,
      ...(sorted ? { notes: JSON.stringify(sorted), noteCount: sorted.length } : {}),
      version: version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(scores.id, id), eq(scores.ownerId, ownerId), eq(scores.version, version)))
    .returning();
  if (row) return toScore(row);
  const exists = await getScore(ownerId, id);
  return exists ? "conflict" : null;
}

export async function deleteScore(ownerId: string, id: string): Promise<boolean> {
  const [row] = await db
    .delete(scores)
    .where(and(eq(scores.id, id), eq(scores.ownerId, ownerId)))
    .returning({ audioKey: scores.audioKey });
  if (!row) return false;
  await env.files.delete(row.audioKey);
  return true;
}

export async function getAudio(ownerId: string, id: string) {
  const [row] = await db
    .select({ audioKey: scores.audioKey, audioType: scores.audioType })
    .from(scores)
    .where(and(eq(scores.id, id), eq(scores.ownerId, ownerId)));
  if (!row) return null;
  const object = await env.files.get(row.audioKey);
  return object ? { object, type: row.audioType } : null;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Turns the read-only link on (a fresh random token) or off; null when not the owner's. */
export async function setSharing(ownerId: string, id: string, on: boolean) {
  const [row] = await db
    .update(scores)
    .set({ shareToken: on ? newToken() : null })
    .where(and(eq(scores.id, id), eq(scores.ownerId, ownerId)))
    .returning({ shareToken: scores.shareToken });
  return row ? { shareToken: row.shareToken } : null;
}

export const tokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict();

/** What a shared link shows: the notation only, nothing about the owner or the recording. */
export async function getShared(token: string) {
  const [row] = await db.select().from(scores).where(eq(scores.shareToken, token));
  if (!row) return null;
  return {
    title: row.title,
    instrument: row.instrument as InstrumentId,
    tempo: row.tempo,
    keyFifths: row.keyFifths,
    keyMode: row.keyMode,
    timeNum: row.timeNum,
    timeDen: row.timeDen,
    notes: JSON.parse(row.notes) as Note[],
  };
}

/** Per member: how many scores and how much recording time and storage. Counts only, never content. */
export function usage() {
  return db
    .select({
      email: users.email,
      scores: sql<number>`count(${scores.id})`,
      seconds: sql<number>`coalesce(sum(${scores.durationSec}), 0)`,
      bytes: sql<number>`coalesce(sum(${scores.audioBytes}), 0)`,
    })
    .from(users)
    .leftJoin(scores, eq(scores.ownerId, users.id))
    .groupBy(users.id)
    .orderBy(users.email);
}

export function shareUrl(requestUrl: string, token: string) {
  return new URL(`/s/${token}`, requestUrl).toString();
}
