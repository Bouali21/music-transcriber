// The app's tools for AI clients, served by the Gateway at /mcp with the
// signed-in member. They read only that member's own scores.
import { ToolError, defineTools } from "@every-app/sdk/server";
import { z } from "zod";
import { keyName } from "@/lib/music/theory";
import * as scores from "@/server/scores";

export const tools = defineTools({
  list_scores: {
    description: "List the member's scores: id, title, instrument, length in seconds, note count and last change.",
    risk: "read",
    input: z.object({}).strict(),
    handler: (_input, { user }) => scores.listScores(user.id),
  },
  get_score: {
    description: "One of the member's scores: tempo, key, time signature and notes (MIDI pitch, start and length in quarter-note beats).",
    risk: "read",
    input: scores.idInput,
    handler: async ({ id }, { user }) => {
      const score = await scores.getScore(user.id, id);
      if (!score) throw new ToolError("No score with that id");
      const { shareToken: _token, ...rest } = score;
      return { ...rest, key: keyName(score.keyFifths, score.keyMode) };
    },
  },
});
