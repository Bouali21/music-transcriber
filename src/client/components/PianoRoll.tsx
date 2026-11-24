import { useMemo } from "react";
import { useWidth } from "@/client/components/Notation";
import type { Note } from "@/lib/music/types";

const LOW = 21;
const HIGH = 108;
const BLACK = new Set([1, 3, 6, 8, 10]);
const WINDOW_BEATS = 8;
const ROLL_HEIGHT = 300;
const KEY_HEIGHT = 64;

export type Hand = "both" | "left" | "right";

/** Notes falling onto a keyboard; left hand below middle C. */
export function PianoRoll({
  notes,
  beat,
  transpose,
  hand,
}: {
  notes: Note[];
  beat: number;
  transpose: number;
  hand: Hand;
}) {
  const { ref, width } = useWidth();
  const whiteCount = useMemo(() => {
    let c = 0;
    for (let p = LOW; p <= HIGH; p++) if (!BLACK.has(p % 12)) c++;
    return c;
  }, []);
  const ww = width / whiteCount;
  const keyX = useMemo(() => {
    const xs = new Map<number, { x: number; w: number; black: boolean }>();
    let wi = 0;
    for (let p = LOW; p <= HIGH; p++) {
      if (BLACK.has(p % 12)) xs.set(p, { x: wi * ww - ww * 0.3, w: ww * 0.6, black: true });
      else {
        xs.set(p, { x: wi * ww, w: ww, black: false });
        wi++;
      }
    }
    return xs;
  }, [ww]);
  const pxPerBeat = ROLL_HEIGHT / WINDOW_BEATS;
  const visible = notes
    .map((n) => ({ ...n, p: n.p + transpose, left: n.p < 60 }))
    .filter((n) => n.p >= LOW && n.p <= HIGH)
    .filter((n) => hand === "both" || (hand === "left") === n.left)
    .filter((n) => n.s + n.d > beat && n.s < beat + WINDOW_BEATS);
  const sounding = new Set(visible.filter((n) => n.s <= beat && beat < n.s + n.d).map((n) => n.p));
  const keys = [...keyX.entries()];

  return (
    <div ref={ref} className="w-full overflow-hidden rounded-lg border border-border bg-card" data-testid="piano-roll">
      <svg width={width} height={ROLL_HEIGHT + KEY_HEIGHT} role="img" aria-label="Piano roll">
        {visible.map((n, i) => {
          const k = keyX.get(n.p)!;
          const top = ROLL_HEIGHT - (n.s + n.d - beat) * pxPerBeat;
          const h = n.d * pxPerBeat;
          return (
            <rect
              key={i}
              data-hand={n.left ? "left" : "right"}
              x={k.x + 1}
              y={Math.max(-h, top)}
              width={Math.max(2, k.w - 2)}
              height={Math.max(2, h - 2)}
              rx={3}
              className={n.left ? "fill-chart-2" : "fill-chart-1"}
            />
          );
        })}
        {keys
          .filter(([, k]) => !k.black)
          .map(([p, k]) => (
            <rect
              key={p}
              x={k.x}
              y={ROLL_HEIGHT}
              width={k.w}
              height={KEY_HEIGHT}
              className={sounding.has(p) ? (p < 60 + transpose ? "fill-chart-2" : "fill-chart-1") : "fill-background stroke-border"}
            />
          ))}
        {keys
          .filter(([, k]) => k.black)
          .map(([p, k]) => (
            <rect
              key={p}
              x={k.x}
              y={ROLL_HEIGHT}
              width={k.w}
              height={KEY_HEIGHT * 0.62}
              className={sounding.has(p) ? (p < 60 + transpose ? "fill-chart-2" : "fill-chart-1") : "fill-foreground"}
            />
          ))}
        <line x1={0} x2={width} y1={ROLL_HEIGHT} y2={ROLL_HEIGHT} className="stroke-border" />
      </svg>
    </div>
  );
}
