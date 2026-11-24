import { env } from "cloudflare:workers";
import {
  aiBaseUrl,
  ConfigurationError,
  createGatewayFetch,
  gatewayRefusal,
  refusalFromError,
} from "@every-app/sdk/server";
import { z } from "zod";
import { assistantReplySchema } from "@/lib/music/edits";
import { keyName, pitchName, position } from "@/lib/music/theory";
import { noteSchema, type Note } from "@/lib/music/types";

const MODEL = "openai/gpt-4o-mini";

export const askInput = z
  .object({
    id: z.string().uuid(),
    request: z.string().trim().min(1).max(1000),
    // The editor's current copy, which may have unsaved changes.
    draft: z.object({
      tempo: z.number().int().min(20).max(320),
      keyFifths: z.number().int().min(-7).max(7),
      keyMode: z.enum(["major", "minor"]),
      timeNum: z.number().int().min(1).max(16),
      timeDen: z.number().int(),
      notes: z.array(noteSchema).max(4000),
    }),
  })
  .strict();

function chatFetch() {
  try {
    return createGatewayFetch({ env });
  } catch (error) {
    if (error instanceof ConfigurationError) return null;
    throw error;
  }
}

async function complete(body: object): Promise<Response | null> {
  const fetcher = chatFetch();
  if (!fetcher) return null;
  try {
    const res = await fetcher(`${aiBaseUrl("openrouter")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (await gatewayRefusal(res.clone())) return null;
    return res;
  } catch (error) {
    if (refusalFromError(error) || error instanceof ConfigurationError) return null;
    throw error;
  }
}

/**
 * Whether the Gateway has an AI provider for this app. An empty request costs
 * nothing: the Gateway refuses it when no key is set, the provider rejects it
 * otherwise.
 */
export async function assistantAvailable(): Promise<boolean> {
  const res = await complete({ model: MODEL, messages: [], max_tokens: 1 });
  return res !== null;
}

const SYSTEM = `You edit sheet music. The user gives a score as a numbered list of notes and a request.
Positions and lengths are in quarter-note beats; a bar is given by the time signature.
Answer with JSON only: {"summary": "<one short sentence of what you changed>", "edits": [...]}.
Each edit is one of:
{"op":"set","i":<index>,"p":<midi pitch>,"s":<start beat>,"d":<length in beats>} (omit fields you keep),
{"op":"delete","i":<index>},
{"op":"add","p":<midi pitch>,"s":<start beat>,"d":<length>},
{"op":"transpose","semitones":<n>,"from":<start beat, optional>,"to":<end beat, optional>}.
Indexes refer to the list as given. Keep starts and lengths on a sixteenth-note grid (multiples of 0.25). Middle C is 60.`;

export type AssistantResult =
  | { ok: true; summary: string; edits: z.infer<typeof assistantReplySchema>["edits"] }
  | { ok: false; reason: "off" | "unclear" };

export async function askAssistant(
  title: string,
  draft: z.infer<typeof askInput>["draft"],
  request: string,
): Promise<AssistantResult> {
  const lines = draft.notes.map(
    (n: Note, i) => `${i}: ${pitchName(n.p, draft.keyFifths)} (p=${n.p}) bar ${position(n.s, draft)} s=${n.s} d=${n.d}`,
  );
  const user = `Score "${title}", ${keyName(draft.keyFifths, draft.keyMode)}, ${draft.timeNum}/${draft.timeDen}, ${draft.tempo} bpm.\nNotes:\n${lines.join("\n")}\n\nRequest: ${request}`;
  const res = await complete({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  if (!res) return { ok: false, reason: "off" };
  if (!res.ok) return { ok: false, reason: "unclear" };
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const content = body?.choices?.[0]?.message?.content ?? "";
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "unclear" };
  }
  const reply = assistantReplySchema.safeParse(parsed);
  if (!reply.success) return { ok: false, reason: "unclear" };
  const edits = reply.data.edits.filter((e) => !("i" in e) || e.i < draft.notes.length);
  return { ok: true, summary: reply.data.summary, edits };
}
