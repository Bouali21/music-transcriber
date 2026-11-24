import { AppShell } from "@/client/components/AppShell";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";

export function NotFound() {
  return (
    <AppShell>
      <PageHeader title="Page not found" />
      <EmptyState kind="filtered" title="There's nothing at this address." />
    </AppShell>
  );
}
