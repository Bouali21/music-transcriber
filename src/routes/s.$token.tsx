import { createFileRoute, notFound } from "@tanstack/react-router";
import { AppShell } from "@/client/components/AppShell";
import { PageHeader } from "@/client/components/PageHeader";
import { PlaybackBar } from "@/client/components/PlaybackBar";
import { ScoreViews } from "@/client/components/ScoreViews";
import { usePlayer } from "@/client/lib/player";
import { keyName } from "@/lib/music/theory";
import { instrumentOf, sortNotes } from "@/lib/music/types";
import { getSharedScore } from "@/serverFunctions/scores";

// Public (everyapp.config.ts): anyone with the link sees this one score,
// read-only. The loader runs on the server for the first load.
export const Route = createFileRoute("/s/$token")({
  loader: async ({ params }) => {
    const score = await getSharedScore({ data: { token: params.token } });
    if (!score) throw notFound();
    return { ...score, notes: sortNotes(score.notes) };
  },
  staleTime: Infinity,
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.title ?? "Shared score" }] }),
  component: SharedScore,
});

function SharedScore() {
  const score = Route.useLoaderData();
  const player = usePlayer(score);
  return (
    <AppShell>
      <PageHeader
        title={<span data-testid="score-title">{score.title}</span>}
        description={`${instrumentOf(score.instrument).label} · ${keyName(score.keyFifths, score.keyMode)} · ${score.timeNum}/${score.timeDen} · ${score.tempo} bpm`}
      />
      <div className="space-y-6">
        <PlaybackBar player={player} score={score} />
        <ScoreViews score={score} player={player} />
      </div>
    </AppShell>
  );
}
