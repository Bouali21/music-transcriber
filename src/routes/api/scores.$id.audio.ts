import { createFileRoute } from "@tanstack/react-router";
import { memberOf, notFound, unauthorized } from "@/server/http";
import * as scores from "@/server/scores";

// The original recording, for its owner only.
export const Route = createFileRoute("/api/scores/$id/audio")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const user = await memberOf(request);
        if (!user) return unauthorized();
        if (!scores.idInput.safeParse({ id: params.id }).success) return notFound();
        const audio = await scores.getAudio(user.id, params.id);
        if (!audio) return notFound();
        return new Response(audio.object.body, {
          headers: {
            "content-type": audio.type,
            "content-length": String(audio.object.size),
            "cache-control": "private, max-age=3600",
          },
        });
      },
    },
  },
});
