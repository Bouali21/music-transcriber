import { createFileRoute } from "@tanstack/react-router";
import { toMidi } from "@/lib/music/midi";
import { toMusicXml } from "@/lib/music/musicxml";
import { toPdf } from "@/lib/music/pdf";
import { fileName, memberOf, notFound, unauthorized } from "@/server/http";
import * as scores from "@/server/scores";

const FORMATS = {
  midi: { ext: "mid", type: "audio/midi" },
  musicxml: { ext: "musicxml", type: "application/vnd.recordare.musicxml+xml" },
  pdf: { ext: "pdf", type: "application/pdf" },
} as const;

// Downloads of the owner's latest saved score.
export const Route = createFileRoute("/api/scores/$id/export/$format")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string; format: string } }) => {
        const user = await memberOf(request);
        if (!user) return unauthorized();
        const format = FORMATS[params.format as keyof typeof FORMATS];
        if (!format || !scores.idInput.safeParse({ id: params.id }).success) return notFound();
        const score = await scores.getScore(user.id, params.id);
        if (!score) return notFound();
        const body =
          params.format === "midi" ? toMidi(score) : params.format === "pdf" ? toPdf(score) : new TextEncoder().encode(toMusicXml(score));
        return new Response(body, {
          headers: {
            "content-type": format.type,
            "content-disposition": `attachment; filename="${fileName(score.title, format.ext)}"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
