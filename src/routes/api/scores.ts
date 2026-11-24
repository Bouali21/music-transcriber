import { createFileRoute } from "@tanstack/react-router";
import { memberOf, unauthorized } from "@/server/http";
import * as scores from "@/server/scores";

// The score list and new scores, for the app's pages and for scripts with a
// Gateway personal access token. Members only.
export const Route = createFileRoute("/api/scores")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const user = await memberOf(request);
        if (!user) return unauthorized();
        await scores.ensureUser(user);
        return Response.json({ scores: await scores.listScores(user.id) });
      },
      // multipart/form-data: `audio` (the original recording) and `score` (JSON).
      POST: async ({ request }: { request: Request }) => {
        const user = await memberOf(request);
        if (!user) return unauthorized();
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > scores.MAX_UPLOAD_BYTES + 1024 * 1024) {
          return Response.json({ error: "Files can be at most 90 MB." }, { status: 413 });
        }
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "Send the recording and the score as a form." }, { status: 400 });
        }
        const audio = form.get("audio");
        const meta = form.get("score");
        if (!(audio instanceof File) || typeof meta !== "string") {
          return Response.json({ error: "Send the recording and the score as a form." }, { status: 400 });
        }
        if (audio.size > scores.MAX_UPLOAD_BYTES) {
          return Response.json({ error: "Files can be at most 90 MB." }, { status: 413 });
        }
        const type = audio.type || "application/octet-stream";
        if (!/^(audio|video)\//.test(type)) {
          return Response.json({ error: "Upload an audio or video file." }, { status: 400 });
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(meta);
        } catch {
          return Response.json({ error: "The score isn't valid JSON." }, { status: 400 });
        }
        const parsed = scores.createInput.safeParse(parsedJson);
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid score" }, { status: 400 });
        }
        const score = await scores.createScore(user, parsed.data, { data: await audio.arrayBuffer(), type });
        return Response.json({ score }, { status: 201 });
      },
    },
  },
});
