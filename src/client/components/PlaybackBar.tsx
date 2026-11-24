import { Pause, Play, SkipBack, Timer } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { SPEEDS, type usePlayer } from "@/client/lib/player";
import { position } from "@/lib/music/theory";
import type { ScoreData } from "@/lib/music/types";

/** Play/pause, back to the start, speed and metronome. */
export function PlaybackBar({
  player,
  score,
}: {
  player: ReturnType<typeof usePlayer>;
  score: ScoreData;
}) {
  const idx = SPEEDS.indexOf(player.speed);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="icon"
        onClick={player.toggle}
        aria-label={player.playing ? "Pause" : "Play"}
        data-testid="play-toggle"
        disabled={score.notes.length === 0}
      >
        {player.playing ? <Pause /> : <Play />}
      </Button>
      <Button size="icon" variant="outline" onClick={player.seekStart} aria-label="Back to start" data-testid="seek-start">
        <SkipBack />
      </Button>
      <span className="min-w-12 text-sm tabular-nums text-muted-foreground" data-testid="play-position" title="Bar.beat">
        {position(player.beat, score)}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => player.setSpeed(SPEEDS[Math.max(0, idx - 1)]!)}
          disabled={idx <= 0}
          data-testid="speed-down"
          aria-label="Slower"
        >
          Slower
        </Button>
        <span className="w-12 text-center text-sm tabular-nums" data-testid="speed-value">
          {player.speed}×
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => player.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, idx + 1)]!)}
          disabled={idx >= SPEEDS.length - 1}
          data-testid="speed-up"
          aria-label="Faster"
        >
          Faster
        </Button>
      </div>
      <Button
        size="sm"
        variant={player.metronome ? "secondary" : "outline"}
        aria-pressed={player.metronome}
        onClick={() => player.setMetronome(!player.metronome)}
        data-testid="metronome-toggle"
      >
        <Timer />
        Metronome
      </Button>
    </div>
  );
}
