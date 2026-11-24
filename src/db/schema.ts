import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Members seen by the app, keyed by the Gateway's user id. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const scores = sqliteTable(
  "scores",
  {
    id: text("id").primaryKey(),
    // The Gateway's user id of the owner; every query filters by it.
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    instrument: text("instrument").notNull(),
    tempo: integer("tempo").notNull(),
    keyFifths: integer("key_fifths").notNull(),
    keyMode: text("key_mode", { enum: ["major", "minor"] }).notNull(),
    timeNum: integer("time_num").notNull(),
    timeDen: integer("time_den").notNull(),
    durationSec: real("duration_sec").notNull(),
    /** JSON array of { p, s, d }. */
    notes: text("notes").notNull(),
    noteCount: integer("note_count").notNull(),
    audioKey: text("audio_key").notNull(),
    audioType: text("audio_type").notNull(),
    audioBytes: integer("audio_bytes").notNull(),
    version: integer("version").notNull().default(1),
    /** Random token of the public read-only link; null while not shared. */
    shareToken: text("share_token").unique(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("scores_owner_idx").on(t.ownerId, t.updatedAt)],
);
