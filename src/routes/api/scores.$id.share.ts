import { createFileRoute } from "@tanstack/react-router";
import { memberOf, notFound, unauthorized } from "@/server/http";
import * as scores from "@/server/scores";

async function toggle(request: Request, id: string, on: boolean) {
  const user = await memberOf(request);
  if (!user) return unauthorized();
  if (!scores.idInput.safeParse({ id }).success) return notFound();
  const result = await scores.setSharing(user.id, id, on);
  if (!result) return notFound();
  return Response.json({ shareUrl: result.shareToken ? scores.shareUrl(request.url, result.shareToken) : null });
}

// The owner turns the read-only link on (POST) or off (DELETE).
export const Route = createFileRoute("/api/scores/$id/share")({
  server: {
    handlers: {
      POST: ({ request, params }: { request: Request; params: { id: string } }) => toggle(request, params.id, true),
      DELETE: ({ request, params }: { request: Request; params: { id: string } }) => toggle(request, params.id, false),
    },
  },
});
