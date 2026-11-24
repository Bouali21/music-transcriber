import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { FileMusic, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { MemberShell } from "@/client/components/MemberShell";
import { PageHeader } from "@/client/components/PageHeader";
import { SimpleSelect } from "@/client/components/SimpleSelect";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { formatLength, formatWhen } from "@/client/lib/format";
import { instrumentOf } from "@/lib/music/types";
import type { ScoreSummary } from "@/server/scores";
import { deleteScore, getMe, listScores, renameScore } from "@/serverFunctions/scores";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [me, scores] = await Promise.all([getMe(), listScores()]);
    return { admin: me.admin, scores };
  },
  component: Library,
});

const SORTS = [
  { value: "changed", label: "Last changed" },
  { value: "title", label: "Title" },
  { value: "length", label: "Length" },
] as const;

function Library() {
  const { admin, scores } = Route.useLoaderData();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<string>("changed");
  const [renaming, setRenaming] = useState<ScoreSummary | null>(null);
  const [deleting, setDeleting] = useState<ScoreSummary | null>(null);
  const [pending, setPending] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = scores.filter((s) => !q || s.title.toLowerCase().includes(q));
    return [...list].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "length"
          ? b.durationSec - a.durationSec
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [scores, query, sort]);

  const newButton = (
    <Button render={<Link to="/new" />} nativeButton={false} data-testid="new-transcription">
      <Plus />
      New transcription
    </Button>
  );

  return (
    <MemberShell admin={admin}>
      <PageHeader title="Scores" actions={scores.length > 0 ? newButton : null} />
      {scores.length === 0 ? (
        <EmptyState
          icon={FileMusic}
          media="rows"
          title="No scores yet"
          description="Transcribe a recording and its score will appear here."
          action={newButton}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search by title"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-xs"
              data-testid="score-search"
              aria-label="Search by title"
            />
            <SimpleSelect value={sort} onChange={setSort} options={SORTS} label="Sort by" testId="score-sort" />
          </div>
          {shown.length === 0 ? (
            <EmptyState kind="filtered" title="No score matches that search." />
          ) : (
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead className="hidden sm:table-cell">Instrument</TableHead>
                    <TableHead>Length</TableHead>
                    <TableHead className="hidden sm:table-cell">Changed</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((s) => (
                    <TableRow key={s.id} data-testid="score-row">
                      <TableCell className="max-w-56 truncate font-medium">
                        <Link to="/scores/$id" params={{ id: s.id }} className="hover:underline">
                          {s.title}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {instrumentOf(s.instrument).label}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{formatLength(s.durationSec)}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{formatWhen(s.updatedAt)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="icon-sm" variant="ghost" aria-label="Rename" onClick={() => setRenaming(s)} data-testid="rename-score">
                            <Pencil />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={() => setDeleting(s)} data-testid="delete-score">
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </div>
      )}
      {renaming ? (
        <RenameDialog
          score={renaming}
          onClose={() => setRenaming(null)}
          onDone={async () => {
            setRenaming(null);
            await router.invalidate();
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete “${deleting.title}”?`}
          confirmLabel="Delete"
          destructive
          pending={pending}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setPending(true);
            try {
              await deleteScore({ data: { id: deleting.id } });
              await router.invalidate();
              setDeleting(null);
            } catch {
              toast.error("Couldn't delete the score. Try again.");
            } finally {
              setPending(false);
            }
          }}
        >
          The score and its recording are deleted for good.
        </ConfirmDialog>
      ) : null}
    </MemberShell>
  );
}

function RenameDialog({
  score,
  onClose,
  onDone,
}: {
  score: ScoreSummary;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [title, setTitle] = useState(score.title);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            setPending(true);
            try {
              await renameScore({ data: { id: score.id, title } });
              await onDone();
            } catch {
              toast.error("Couldn't rename the score. Try again.");
            } finally {
              setPending(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename score</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename">Title</Label>
            <Input id="rename" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid="rename-input" autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} disabled={!title.trim()} data-testid="rename-save">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
