import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isAdmin } from "@every-app/sdk/server";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { z } from "zod";
import * as assistant from "@/server/assistant";
import * as scores from "@/server/scores";

// Each runs behind ensureUserMiddleware: `context.user` is the member the
// Gateway signed in, and every query takes their id.

export const getMe = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context: { user } }) => {
    await scores.ensureUser(user);
    return { admin: isAdmin(user) };
  });

export const listScores = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context }) => {
    await scores.ensureUser(context.user);
    return scores.listScores(context.user.id);
  });

export const getScore = createServerFn()
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => scores.idInput.parse(data))
  .handler(async ({ data, context }) => {
    const score = await scores.getScore(context.user.id, data.id);
    if (!score) return null;
    return {
      ...score,
      shareUrl: score.shareToken ? scores.shareUrl(getRequest().url, score.shareToken) : null,
    };
  });

export const saveScore = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), change: scores.updateInput }).strict().parse(data),
  )
  .handler(async ({ data, context }) => {
    const result = await scores.updateScore(context.user.id, data.id, data.change);
    if (result === null) return { status: "missing" as const };
    if (result === "conflict") return { status: "conflict" as const };
    return { status: "saved" as const, version: result.version, updatedAt: result.updatedAt };
  });

export const renameScore = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), title: z.string().trim().min(1, "Title is required").max(200) }).strict().parse(data),
  )
  .handler(async ({ data, context }) => {
    const current = await scores.getScore(context.user.id, data.id);
    if (!current) return { ok: false };
    const result = await scores.updateScore(context.user.id, data.id, { version: current.version, title: data.title });
    return { ok: typeof result === "object" && result !== null };
  });

export const deleteScore = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => scores.idInput.parse(data))
  .handler(({ data, context }) => scores.deleteScore(context.user.id, data.id));

export const setSharing = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => z.object({ id: z.string().uuid(), on: z.boolean() }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const result = await scores.setSharing(context.user.id, data.id, data.on);
    if (!result) return null;
    return { shareUrl: result.shareToken ? scores.shareUrl(getRequest().url, result.shareToken) : null };
  });

export const getAssistantStatus = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async () => ({ available: await assistant.assistantAvailable() }));

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => assistant.askInput.parse(data))
  .handler(async ({ data, context }) => {
    const score = await scores.getScore(context.user.id, data.id);
    if (!score) return { ok: false as const, reason: "missing" as const };
    return assistant.askAssistant(score.title, data.draft, data.request);
  });

export const getUsage = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context: { user } }) => {
    if (!isAdmin(user)) return { allowed: false as const, members: [] };
    return { allowed: true as const, members: await scores.usage() };
  });

/** A shared score by its link's token. No member needed: this is what the public /s/<token> page shows. */
export const getSharedScore = createServerFn()
  .validator((data: unknown) => z.object({ token: z.string().max(64) }).strict().parse(data))
  .handler(async ({ data }) => {
    const parsed = scores.tokenInput.safeParse(data);
    if (!parsed.success) return null;
    return scores.getShared(parsed.data.token);
  });
