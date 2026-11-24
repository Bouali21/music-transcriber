import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Notation } from "@/client/components/Notation";
import { PianoRoll, type Hand } from "@/client/components/PianoRoll";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Button } from "@/client/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import type { usePlayer } from "@/client/lib/player";
import type { ScoreData } from "@/lib/music/types";

const HANDS = [
  { value: "both" as const, label: "Both hands", icon: null },
  { value: "left" as const, label: "Left hand", icon: null },
  { value: "right" as const, label: "Right hand", icon: null },
];

/** Sheet music, tablature (guitar and bass) and, for members, the piano roll. */
export function ScoreViews({
  score,
  player,
  rollTranspose,
  onRollTranspose,
  selected,
  marked,
  onSelect,
}: {
  score: ScoreData;
  player: ReturnType<typeof usePlayer>;
  rollTranspose?: number;
  onRollTranspose?: (value: number) => void;
  selected?: number | null;
  marked?: Set<number>;
  onSelect?: (index: number | null) => void;
}) {
  const [hand, setHand] = useState<Hand>("both");
  const hasTab = score.instrument === "guitar" || score.instrument === "bass";
  const showHead = player.playing || player.beat > 0;
  return (
    <Tabs defaultValue="sheet" className="gap-4">
      <TabsList>
        <TabsTrigger value="sheet">Sheet</TabsTrigger>
        {hasTab ? <TabsTrigger value="tab">Tab</TabsTrigger> : null}
        {onRollTranspose ? <TabsTrigger value="roll">Piano roll</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="sheet">
        {score.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : null}
        <Notation score={score} mode="staff" beat={player.beat} showPlayhead={showHead} selected={selected} marked={marked} onSelect={onSelect} />
      </TabsContent>
      {hasTab ? (
        <TabsContent value="tab">
          <Notation score={score} mode="tab" beat={player.beat} showPlayhead={showHead} selected={selected} marked={marked} onSelect={onSelect} />
        </TabsContent>
      ) : null}
      {onRollTranspose ? (
        <TabsContent value="roll" className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedToggle items={HANDS} value={hand} onChange={setHand} showLabels />
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">Transpose</span>
              <Button size="icon-sm" variant="outline" aria-label="Transpose down" onClick={() => onRollTranspose((rollTranspose ?? 0) - 1)} data-testid="roll-transpose-down">
                <Minus />
              </Button>
              <span className="w-8 text-center text-sm tabular-nums" data-testid="roll-transpose">
                {(rollTranspose ?? 0) > 0 ? `+${rollTranspose}` : rollTranspose}
              </span>
              <Button size="icon-sm" variant="outline" aria-label="Transpose up" onClick={() => onRollTranspose((rollTranspose ?? 0) + 1)} data-testid="roll-transpose-up">
                <Plus />
              </Button>
            </div>
          </div>
          <PianoRoll notes={score.notes} beat={player.beat} transpose={rollTranspose ?? 0} hand={hand} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
