import { createFileRoute } from "@tanstack/react-router";
import { isAdmin } from "@every-app/sdk/server";
import { memberOf, unauthorized } from "@/server/http";
import * as scores from "@/server/scores";

// Score counts and storage per member, for the organization's admins.
export const Route = createFileRoute("/api/admin/usage")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const user = await memberOf(request);
        if (!user) return unauthorized();
        if (!isAdmin(user)) return Response.json({ error: "Admins only" }, { status: 403 });
        return Response.json({ members: await scores.usage() });
      },
    },
  },
});
