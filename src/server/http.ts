import { env } from "cloudflare:workers";
import { getEveryAppUser, type EveryAppUser } from "@every-app/sdk/server";

/** The member the Gateway signed in, or null. */
export async function memberOf(request: Request): Promise<EveryAppUser | null> {
  return getEveryAppUser(request, env);
}

export const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
export const unauthorized = () => Response.json({ error: "Sign in through your Gateway" }, { status: 401 });

/** A file name safe for Content-Disposition. */
export function fileName(title: string, ext: string) {
  const base = title.replace(/[^\w .()-]+/g, "").trim().slice(0, 80) || "score";
  return `${base}.${ext}`;
}
