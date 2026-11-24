import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/client/components/AppShell";

const LINK =
  "text-sm text-muted-foreground transition-colors hover:text-foreground data-[status=active]:text-foreground";

/** AppShell with the app's own links. */
export function MemberShell({ admin, children }: { admin?: boolean; children: ReactNode }) {
  return (
    <AppShell
      nav={
        <nav className="flex items-center gap-4">
          <Link to="/" className={LINK} activeOptions={{ exact: true }}>
            Scores
          </Link>
          <Link to="/new" className={LINK}>
            New
          </Link>
          {admin ? (
            <Link to="/admin" className={LINK}>
              Admin
            </Link>
          ) : null}
        </nav>
      }
    >
      {children}
    </AppShell>
  );
}
