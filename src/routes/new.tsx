import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Mic, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MemberShell } from "@/client/components/MemberShell";
import { PageHeader } from "@/client/components/PageHeader";
import { SimpleSelect } from "@/client/components/SimpleSelect";
import { Alert, AlertDescription, AlertTitle } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Progress } from "@/client/components/ui/progress";
import { formatLength } from "@/client/lib/format";
import { decodeMono, mediaDuration, uploadScore } from "@/client/lib/recording";
import { transcribe } from "@/lib/music/detect";
import { INSTRUMENTS, MAX_SECONDS, type InstrumentId } from "@/lib/music/types";

export const Route = createFileRoute("/new")({
  ssr: false,
  component: NewTranscription,
});

const MAX_BYTES = 90 * 1024 * 1024;
const INSTRUMENT_OPTIONS = INSTRUMENTS.map((i) => ({ value: i.id, label: i.label }));

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: string; progress: number }
  | { kind: "failed"; message: string };

function titleFromName(name: string) {
  return name.replace(/\.[^.]+$/, "").trim().slice(0, 200) || "Untitled";
}

function NewTranscription() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [instrument, setInstrument] = useState<InstrumentId>("piano");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [recording, setRecording] = useState<{ recorder: MediaRecorder; started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const secs = (Date.now() - recording.started) / 1000;
      setElapsed(secs);
      if (secs >= MAX_SECONDS) recording.recorder.stop();
    }, 250);
    return () => clearInterval(id);
  }, [recording]);

  const pick = (f: File) => {
    setFile(f);
    setTitle(titleFromName(f.name));
    setPhase({ kind: "idle" });
  };

  const startRecording = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        const type = recorder.mimeType || "audio/webm";
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        const stamp = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }).replace(/[/:]/g, "-");
        pick(new File(chunks, `Recording ${stamp}.${ext}`, { type: type.split(";")[0] }));
      };
      recorder.start(1000);
      setElapsed(0);
      setRecording({ recorder, started: Date.now() });
    } catch {
      setMicError("The microphone isn't available. Allow access in your browser and try again.");
    }
  };

  const run = async () => {
    if (!file) return;
    try {
      if (file.size > MAX_BYTES) throw new Error("Files can be at most 90 MB.");
      setPhase({ kind: "working", step: "Reading the recording", progress: 0 });
      let duration = await mediaDuration(file);
      if (duration !== null && duration > MAX_SECONDS) {
        throw new Error(`This recording is ${formatLength(duration)} long. Recordings can be at most 15 minutes.`);
      }
      let samples: Float32Array;
      try {
        samples = await decodeMono(file);
      } catch {
        throw new Error("This file's audio can't be read. Try an mp3, wav, m4a or mp4 file.");
      }
      duration = samples.length / 22050;
      if (duration > MAX_SECONDS) {
        throw new Error(`This recording is ${formatLength(duration)} long. Recordings can be at most 15 minutes.`);
      }
      setPhase({ kind: "working", step: "Finding the notes", progress: 0 });
      const result = await transcribe(samples, instrument, (f) =>
        setPhase({ kind: "working", step: "Finding the notes", progress: f }),
      );
      setPhase({ kind: "working", step: "Uploading", progress: 0 });
      const id = await uploadScore(
        file,
        file.name,
        { title: title.trim() || titleFromName(file.name), instrument, durationSec: Math.round(duration * 100) / 100, ...result },
        (f) => setPhase({ kind: "working", step: "Uploading", progress: f }),
      );
      await navigate({ to: "/scores/$id", params: { id } });
    } catch (error) {
      setPhase({ kind: "failed", message: error instanceof Error ? error.message : "Something went wrong." });
    }
  };

  const working = phase.kind === "working";

  return (
    <MemberShell>
      <PageHeader title="New transcription" />
      <Card>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground transition-colors hover:bg-muted"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) pick(f);
              }}
            >
              <Upload className="size-5" aria-hidden />
              <span className="font-medium text-foreground">Choose a file</span>
              <span>Audio or video, up to 15 minutes</span>
              <input
                ref={inputRef}
                type="file"
                accept="audio/*,video/*"
                className="sr-only"
                data-testid="audio-file"
                disabled={working || !!recording}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pick(f);
                }}
              />
            </label>
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {recording ? (
                <>
                  <span className="tabular-nums text-foreground">{formatLength(elapsed)}</span>
                  <Button variant="destructive" onClick={() => recording.recorder.stop()} data-testid="record-stop">
                    <Square />
                    Stop
                  </Button>
                </>
              ) : (
                <>
                  <Mic className="size-5" aria-hidden />
                  <Button variant="outline" onClick={startRecording} disabled={working} data-testid="record-start">
                    Record
                  </Button>
                </>
              )}
              {micError ? <span className="text-destructive">{micError}</span> : null}
            </div>
          </div>

          {file ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid="title-input" disabled={working} />
              </div>
              <div className="space-y-2">
                <Label>Instrument</Label>
                <SimpleSelect
                  value={instrument}
                  onChange={(v) => setInstrument(v as InstrumentId)}
                  options={INSTRUMENT_OPTIONS}
                  label="Instrument"
                  testId="instrument-select"
                  className="w-full"
                />
              </div>
            </div>
          ) : null}

          {phase.kind === "working" ? (
            <div className="space-y-2" data-testid="transcribe-progress">
              <div className="flex justify-between text-sm">
                <span>{phase.step}</span>
                <span className="tabular-nums text-muted-foreground">{Math.round(phase.progress * 100)}%</span>
              </div>
              <Progress value={Math.round(phase.progress * 100)} />
            </div>
          ) : null}

          {phase.kind === "failed" ? (
            <Alert variant="destructive" data-testid="transcribe-error">
              <AlertTitle>Transcription failed</AlertTitle>
              <AlertDescription>{phase.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={run} disabled={!file || working || !!recording} pending={working} data-testid={phase.kind === "failed" ? "transcribe-retry" : "start-transcription"}>
              {phase.kind === "failed" ? "Try again" : "Transcribe"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </MemberShell>
  );
}
