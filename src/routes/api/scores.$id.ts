import { createFileRoute } from "@tanstack/react-router";
import { memberOf, notFound, unauthorized } from "@/server/http";
import * as scores from "@/server/scores";

// One of the caller's own scores: read, save (with the version it was read
// at) or delete. Anyone else's is a 404.
export const Route = createFileRoute("/api/scores/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const user = await memberOf(request);
        if (!user) return unauthorized();
        if (!scores.idInput.safeParse({ id: params.id }).success) return notFound();
        const score = await scores.getScore(user.id, params.id);
        return score ? Response.json({ score }) : notFound();
      },
      PATCH: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const user = await memberOf(request);
        if (!user) return unauthorized();
        if (!scores.idInput.safeParse({ id: params.id }).success) return notFound();
        const parsed = scores.updateInput.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
        }
        const result = await scores.updateScore(user.id, params.id, parsed.data);
        if (result === null) return notFound();
        if (result === "conflict") {
          return Response.json({ error: "This score was changed since you opened it. Reload it first." }, { status: 409 });
        }
        return Response.json({ score: result });
      },
      DELETE: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const user = await memberOf(request);
        if (!user) return unauthorized();
        if (!scores.idInput.safeParse({ id: params.id }).success) return notFound();
        return (await scores.deleteScore(user.id, params.id)) ? new Response(null, { status: 204 }) : notFound();
      },
    },
  },
});
