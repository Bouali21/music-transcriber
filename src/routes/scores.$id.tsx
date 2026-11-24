import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronLeft,
  Download,
  Minus,
  Plus,
  Redo2,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/client/components/CopyButton";
import { EmptyState } from "@/client/components/EmptyState";
import { MemberShell } from "@/client/components/MemberShell";
import { PageHeader } from "@/client/components/PageHeader";
import { PlaybackBar } from "@/client/components/PlaybackBar";
import { ScoreViews } from "@/client/components/ScoreViews";
import { SimpleSelect } from "@/client/components/SimpleSelect";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Switch } from "@/client/components/ui/switch";
import { Textarea } from "@/client/components/ui/textarea";
import { usePlayer } from "@/client/lib/player";
import { applyEdits, type Edit } from "@/lib/music/edits";
import {
  durationName,
  EDIT_LENGTHS,
  KEY_OPTIONS,
  keyName,
  pitchName,
  transposeKey,
} from "@/lib/music/theory";
import {
  instrumentOf,
  sortNotes,
  TIME_SIGNATURES,
  totalBeats,
  type Note,
  type ScoreData,
} from "@/lib/music/types";
import {
  askAssistant,
  getAssistantStatus,
  getScore,
  saveScore,
  setSharing,
} from "@/serverFunctions/scores";

export const Route = createFileRoute("/scores/$id")({
  loader: async ({ params }) => {
    const parsed = /^[0-9a-f-]{36}$/.test(params.id);
    return { score: parsed ? await getScore({ data: { id: params.id } }) : null };
  },
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.score?.title ?? "Score" }] }),
  component: ScorePage,
});

type Loaded = NonNullable<Awaited<ReturnType<typeof getScore>>>;

function ScorePage() {
  const { score } = Route.useLoaderData();
  if (!score) {
    return (
      <MemberShell>
        <PageHeader title="Score not found" />
        <div data-testid="score-missing">
          <EmptyState
            kind="filtered"
            title="This score doesn't exist or isn't yours."
            action={
              <Button variant="outline" render={<Link to="/" />} nativeButton={false}>
                Back to scores
              </Button>
            }
          />
        </div>
      </MemberShell>
    );
  }
  return <ScoreWorkspace key={`${score.id}:${score.version}`} initial={score} />;
}

interface Snapshot {
  draft: ScoreData;
  selected: number | null;
}

const TIME_OPTIONS = TIME_SIGNATURES.map(([n, d]) => ({ value: `${n}/${d}`, label: `${n}/${d}` }));

function ScoreWorkspace({ initial }: { initial: Loaded }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ScoreData>(() => ({ ...initial, notes: sortNotes(initial.notes) }));
  const [selected, setSelected] = useState<number | null>(null);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [version, setVersion] = useState(initial.version);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [tempoText, setTempoText] = useState(String(initial.tempo));
  const [rollTranspose, setRollTranspose] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(initial.shareUrl);
  const [sharing, setSharingPending] = useState(false);
  const [marked, setMarked] = useState<Set<number> | undefined>();
  const player = usePlayer(draft, rollTranspose);

  const commit = (next: ScoreData, nextSelected: number | null = selected) => {
    setPast((p) => [...p.slice(-199), { draft, selected }]);
    setFuture([]);
    setDraft(next);
    setSelected(nextSelected);
    setDirty(true);
    setMarked(undefined);
  };

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setFuture((f) => [{ draft, selected }, ...f]);
    setPast((p) => p.slice(0, -1));
    setDraft(prev.draft);
    setSelected(prev.selected);
    setTempoText(String(prev.draft.tempo));
    setDirty(true);
    setMarked(undefined);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, { draft, selected }]);
    setFuture((f) => f.slice(1));
    setDraft(next.draft);
    setSelected(next.selected);
    setTempoText(String(next.draft.tempo));
    setDirty(true);
  };

  /** Replaces the selected note and keeps it selected after re-sorting. */
  const changeSelected = (change: (n: Note) => Note) => {
    if (selected === null) return;
    const current = draft.notes[selected];
    if (!current) return;
    const replaced = change(current);
    const notes = draft.notes.map((n, i) => (i === selected ? replaced : n));
    const sorted = sortNotes(notes);
    commit({ ...draft, notes: sorted }, sorted.indexOf(replaced));
  };

  const addNote = () => {
    const base = selected !== null ? draft.notes[selected] : undefined;
    const note: Note = base
      ? { p: base.p, s: base.s + base.d, d: base.d }
      : { p: 60, s: Math.ceil(totalBeats(draft)), d: 1 };
    const sorted = sortNotes([...draft.notes, note]);
    commit({ ...draft, notes: sorted }, sorted.indexOf(note));
  };

  const deleteNote = () => {
    if (selected === null) return;
    commit({ ...draft, notes: draft.notes.filter((_, i) => i !== selected) }, null);
  };

  const transposeAll = (semitones: number) => {
    const notes = draft.notes.map((n) => ({ ...n, p: Math.min(127, Math.max(0, n.p + semitones)) }));
    commit({ ...draft, notes, keyFifths: transposeKey(draft.keyFifths, draft.keyMode, semitones) });
  };

  const save = async () => {
    const tempo = Number(tempoText);
    if (!Number.isInteger(tempo) || tempo < 20 || tempo > 320) {
      toast.error("Tempo must be a whole number from 20 to 320.");
      return;
    }
    if (!draft.title.trim()) {
      toast.error("Give the score a title.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveScore({
        data: {
          id: initial.id,
          change: {
            version,
            title: draft.title.trim(),
            tempo,
            keyFifths: draft.keyFifths,
            keyMode: draft.keyMode,
            timeNum: draft.timeNum,
            timeDen: draft.timeDen as 2 | 4 | 8,
            notes: draft.notes,
          },
        },
      });
      if (result.status === "saved") {
        setVersion(result.version);
        setDirty(false);
        toast.success("Saved", { id: "saved" });
      } else if (result.status === "conflict") {
        setConflict(true);
      } else {
        toast.error("This score no longer exists.");
      }
    } catch {
      toast.error("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleShare = async (on: boolean) => {
    setSharingPending(true);
    try {
      const result = await setSharing({ data: { id: initial.id, on } });
      setShareUrl(result?.shareUrl ?? null);
    } catch {
      toast.error("Couldn't change sharing. Try again.");
    } finally {
      setSharingPending(false);
    }
  };

  const sel = selected !== null ? draft.notes[selected] : undefined;
  const lengthIdx = sel ? EDIT_LENGTHS.indexOf(sel.d) : -1;
  const stepLength = (dir: 1 | -1) =>
    changeSelected((n) => {
      const i = EDIT_LENGTHS.indexOf(n.d);
      const next = i < 0 ? EDIT_LENGTHS.find((l) => (dir > 0 ? l > n.d : l >= n.d)) ?? 1 : EDIT_LENGTHS[Math.min(EDIT_LENGTHS.length - 1, Math.max(0, i + dir))]!;
      return { ...n, d: next };
    });

  return (
    <MemberShell>
      <PageHeader
        backLink={
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ChevronLeft className="size-4" aria-hidden />
            Scores
          </Link>
        }
        title={<span data-testid="score-title">{editing ? draft.title || "Untitled" : draft.title}</span>}
        description={
          <span className="flex flex-wrap gap-x-2">
            <span>{instrumentOf(draft.instrument).label}</span>·<span data-testid="score-key">{keyName(draft.keyFifths, draft.keyMode)}</span>·
            <span>{draft.timeNum}/{draft.timeDen}</span>·<span data-testid="score-tempo">{draft.tempo} bpm</span>·
            <span data-testid="note-count">{draft.notes.length} notes</span>
          </span>
        }
        actions={
          <Button variant={editing ? "default" : "outline"} onClick={() => { setEditing(!editing); setSelected(null); }} data-testid="edit-toggle">
            {editing ? <Check /> : null}
            {editing ? "Done" : "Edit"}
          </Button>
        }
      />

      <div className="space-y-6">
        {editing ? (
          <EditPanel
            draft={draft}
            tempoText={tempoText}
            onTitle={(title) => commit({ ...draft, title })}
            onTempo={(text) => {
              setTempoText(text);
              const t = Number(text);
              if (Number.isInteger(t) && t >= 20 && t <= 320) commit({ ...draft, tempo: t });
            }}
            onKey={(v) => {
              const [f, mode] = v.split(":");
              commit({ ...draft, keyFifths: Number(f), keyMode: mode as "major" | "minor" });
            }}
            onTime={(v) => {
              const [n, d] = v.split("/").map(Number);
              commit({ ...draft, timeNum: n!, timeDen: d! });
            }}
            onTranspose={transposeAll}
          />
        ) : null}

        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-36 text-sm" data-testid="selected-note">
              {sel ? `${pitchName(sel.p, draft.keyFifths)} · ${durationName(sel.d)}` : "Select a note"}
            </span>
            <div className="flex flex-wrap gap-1">
              <Button size="icon-sm" variant="outline" aria-label="Pitch up" disabled={!sel || sel.p >= 127} onClick={() => changeSelected((n) => ({ ...n, p: n.p + 1 }))} data-testid="note-up"><ArrowUp /></Button>
              <Button size="icon-sm" variant="outline" aria-label="Pitch down" disabled={!sel || sel.p <= 0} onClick={() => changeSelected((n) => ({ ...n, p: n.p - 1 }))} data-testid="note-down"><ArrowDown /></Button>
              <Button size="icon-sm" variant="outline" aria-label="Earlier" disabled={!sel || sel.s <= 0} onClick={() => changeSelected((n) => ({ ...n, s: Math.max(0, n.s - 0.25) }))} data-testid="note-left"><ArrowLeft /></Button>
              <Button size="icon-sm" variant="outline" aria-label="Later" disabled={!sel} onClick={() => changeSelected((n) => ({ ...n, s: n.s + 0.25 }))} data-testid="note-right"><ArrowRight /></Button>
              <Button size="sm" variant="outline" disabled={!sel || lengthIdx === 0} onClick={() => stepLength(-1)} data-testid="note-shorter">Shorter</Button>
              <Button size="sm" variant="outline" disabled={!sel || lengthIdx === EDIT_LENGTHS.length - 1} onClick={() => stepLength(1)} data-testid="note-longer">Longer</Button>
              <Button size="sm" variant="outline" onClick={addNote} data-testid="note-add"><Plus />Add note</Button>
              <Button size="icon-sm" variant="outline" aria-label="Delete note" disabled={!sel} onClick={deleteNote} data-testid="note-delete"><Trash2 /></Button>
            </div>
            <div className="ml-auto flex gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Undo" disabled={past.length === 0} onClick={undo} data-testid="undo"><Undo2 /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Redo" disabled={future.length === 0} onClick={redo} data-testid="redo"><Redo2 /></Button>
              <Button size="sm" onClick={save} pending={saving} disabled={!dirty} data-testid="save-score">Save</Button>
            </div>
          </div>
        ) : null}

        {conflict ? (
          <Alert variant="destructive" data-testid="save-conflict">
            <AlertTitle>This score changed since you opened it</AlertTitle>
            <AlertDescription>Reload to get the latest version. Your edits here are lost.</AlertDescription>
            <AlertAction>
              <Button size="sm" variant="outline" onClick={() => void router.invalidate()} data-testid="reload-score">
                Reload
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        <PlaybackBar player={player} score={draft} />
        <ScoreViews
          score={draft}
          player={player}
          rollTranspose={rollTranspose}
          onRollTranspose={setRollTranspose}
          selected={editing ? selected : null}
          marked={marked}
          onSelect={editing ? setSelected : undefined}
        />

        {editing ? (
          <AssistantPanel
            scoreId={initial.id}
            draft={draft}
            onApply={(edits) => {
              const before = new Set(draft.notes.map((n) => `${n.p}@${n.s}@${n.d}`));
              const notes = applyEdits(draft.notes, edits);
              commit({ ...draft, notes }, null);
              setMarked(new Set(notes.flatMap((n, i) => (before.has(`${n.p}@${n.s}@${n.d}`) ? [] : [i]))));
            }}
            onUndo={undo}
            onKeep={() => setMarked(undefined)}
          />
        ) : null}

        <Card>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Original recording</Label>
              <audio controls preload="none" src={`/api/scores/${initial.id}/audio`} className="w-full" data-testid="original-audio" />
            </div>
            <div className="space-y-2">
              <Label>Download</Label>
              <div className="flex flex-wrap gap-2">
                {([["midi", "MIDI"], ["musicxml", "MusicXML"], ["pdf", "PDF"]] as const).map(([format, label]) => (
                  <Button
                    key={format}
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<a href={`/api/scores/${initial.id}/export/${format}`} download />}
                    data-testid={`export-${format}`}
                  >
                    <Download />
                    {label}
                  </Button>
                ))}
              </div>
              {dirty ? <p className="text-sm text-muted-foreground">Save to include your edits in downloads.</p> : null}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Switch checked={shareUrl !== null} disabled={sharing} onCheckedChange={(on) => void toggleShare(on)} data-testid="share-toggle" aria-label="Share a read-only link" />
                <Label>Share a read-only link</Label>
              </div>
              {shareUrl ? (
                <div className="flex items-center gap-2">
                  <Input readOnly value={shareUrl} data-testid="share-link" aria-label="Share link" onFocus={(e) => e.target.select()} />
                  <CopyButton value={shareUrl} successMessage="Link copied" />
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </MemberShell>
  );
}

function EditPanel({
  draft,
  tempoText,
  onTitle,
  onTempo,
  onKey,
  onTime,
  onTranspose,
}: {
  draft: ScoreData;
  tempoText: string;
  onTitle: (v: string) => void;
  onTempo: (v: string) => void;
  onKey: (v: string) => void;
  onTime: (v: string) => void;
  onTranspose: (semitones: number) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="edit-title">Title</Label>
          <Input id="edit-title" value={draft.title} maxLength={200} onChange={(e) => onTitle(e.target.value)} data-testid="edit-title" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-tempo">Tempo (bpm)</Label>
          <Input id="edit-tempo" type="number" min={20} max={320} value={tempoText} onChange={(e) => onTempo(e.target.value)} data-testid="edit-tempo" />
        </div>
        <div className="space-y-2">
          <Label>Key</Label>
          <SimpleSelect value={`${draft.keyFifths}:${draft.keyMode}`} onChange={onKey} options={KEY_OPTIONS} label="Key" testId="edit-key" className="w-full" />
        </div>
        <div className="space-y-2">
          <Label>Time signature</Label>
          <SimpleSelect value={`${draft.timeNum}/${draft.timeDen}`} onChange={onTime} options={TIME_OPTIONS} label="Time signature" testId="edit-time" className="w-full" />
        </div>
        <div className="space-y-2">
          <Label>Transpose score</Label>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => onTranspose(-1)} data-testid="transpose-down"><Minus />Semitone</Button>
            <Button variant="outline" size="sm" onClick={() => onTranspose(1)} data-testid="transpose-up"><Plus />Semitone</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AssistantPanel({
  scoreId,
  draft,
  onApply,
  onUndo,
  onKeep,
}: {
  scoreId: string;
  draft: ScoreData;
  onApply: (edits: Edit[]) => void;
  onUndo: () => void;
  onKeep: () => void;
}) {
  const [available, setAvailable] = useState(false);
  const [request, setRequest] = useState("");
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getAssistantStatus()
      .then((s) => live && setAvailable(s.available))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, []);

  const notes = useMemo(() => draft.notes, [draft.notes]);
  if (!available) return null;

  const ask = async () => {
    setPending(true);
    setProblem(null);
    try {
      const result = await askAssistant({
        data: {
          id: scoreId,
          request,
          draft: { tempo: draft.tempo, keyFifths: draft.keyFifths, keyMode: draft.keyMode, timeNum: draft.timeNum, timeDen: draft.timeDen, notes: notes.slice(0, 4000) },
        },
      });
      if (result.ok) {
        onApply(result.edits);
        setPreview(result.summary || "Edits applied.");
        setRequest("");
      } else if (result.reason === "off") {
        setAvailable(false);
      } else {
        setProblem("The assistant couldn't turn that into edits. Try rewording it.");
      }
    } catch {
      setProblem("The assistant didn't answer. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card data-testid="assistant-panel">
      <CardContent className="space-y-3">
        <Label htmlFor="assistant-input" className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          Ask for a change
        </Label>
        <Textarea
          id="assistant-input"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Make bar 3 an octave lower"
          maxLength={1000}
          data-testid="assistant-input"
        />
        {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
        {preview ? (
          <Alert data-testid="assistant-preview">
            <AlertTitle>{preview}</AlertTitle>
            <AlertAction className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { onUndo(); setPreview(null); }} data-testid="assistant-undo">Undo</Button>
              <Button size="sm" onClick={() => { onKeep(); setPreview(null); }} data-testid="assistant-keep">Keep</Button>
            </AlertAction>
          </Alert>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={ask} pending={pending} disabled={!request.trim() || preview !== null} data-testid="assistant-ask">
            Ask
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
