import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/client/components/EmptyState";
import { MemberShell } from "@/client/components/MemberShell";
import { PageHeader } from "@/client/components/PageHeader";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { formatBytes, formatLength } from "@/client/lib/format";
import { getUsage } from "@/serverFunctions/scores";

export const Route = createFileRoute("/admin")({
  loader: () => getUsage(),
  component: Admin,
});

function Admin() {
  const usage = Route.useLoaderData();
  if (!usage.allowed) {
    return (
      <MemberShell>
        <PageHeader title="Usage" />
        <div data-testid="admin-refused">
          <EmptyState kind="error" title="Only workspace admins can see this page." />
        </div>
      </MemberShell>
    );
  }
  return (
    <MemberShell admin>
      <PageHeader title="Usage" />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Scores</TableHead>
              <TableHead>Recorded</TableHead>
              <TableHead>Storage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.members.map((m) => (
              <TableRow key={m.email} data-testid="usage-row">
                <TableCell>{m.email}</TableCell>
                <TableCell className="tabular-nums">{m.scores}</TableCell>
                <TableCell className="tabular-nums">{formatLength(m.seconds)}</TableCell>
                <TableCell className="tabular-nums">{formatBytes(m.bytes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </MemberShell>
  );
}
