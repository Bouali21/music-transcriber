import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { layoutScore, playheadAt, type Op } from "@/lib/music/layout";
import type { ScoreData } from "@/lib/music/types";

/** The width of an element, following resizes. */
export function useWidth(initial = 680) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Staff notation (or tablature) drawn as SVG, with follow-along and note selection. */
export function Notation({
  score,
  mode,
  beat,
  showPlayhead,
  selected,
  marked,
  onSelect,
  testId = "notation",
}: {
  score: ScoreData;
  mode: "staff" | "tab";
  beat: number;
  showPlayhead: boolean;
  selected?: number | null;
  /** Notes to set apart, such as an assistant's changes. */
  marked?: Set<number>;
  onSelect?: (index: number | null) => void;
  testId?: string;
}) {
  const { ref, width } = useWidth();
  const sp = width < 480 ? 6 : 8;
  const layout = useMemo(
    () => layoutScore(score, { width: width - 8, staff: mode === "staff", tab: mode === "tab", sp }),
    [score, width, mode, sp],
  );
  const active = useMemo(() => {
    const set = new Set<number>();
    if (!showPlayhead) return set;
    score.notes.forEach((n, i) => {
      if (n.s <= beat + 1e-6 && beat < n.s + n.d) set.add(i);
    });
    return set;
  }, [score.notes, beat, showPlayhead]);
  const head = showPlayhead ? playheadAt(layout, beat) : null;
  const sys = head ? layout.systems[head.system] : null;

  return (
    <div ref={ref} className="w-full overflow-x-auto" data-testid={testId === "notation" && mode === "tab" ? "tab-view" : testId}>
      <svg
        width={layout.width + 8}
        height={layout.height}
        viewBox={`-4 0 ${layout.width + 8} ${layout.height}`}
        className="text-foreground"
        role="img"
        aria-label={mode === "tab" ? "Tablature" : "Sheet music"}
        onClick={(e) => {
          if (onSelect && e.target === e.currentTarget) onSelect(null);
        }}
      >
        {head && sys ? (
          <rect x={head.x - 6} y={sys.top + 8} width={12} height={sys.bottom - sys.top - 24} className="fill-primary/15" />
        ) : null}
        {layout.ops.map((op, i) => (
          <OpView
            key={i}
            op={op}
            state={
              op.t === "mask" || op.note === undefined
                ? null
                : op.note === selected
                  ? "selected"
                  : active.has(op.note)
                    ? "active"
                    : marked?.has(op.note)
                      ? "marked"
                      : null
            }
            onSelect={onSelect}
          />
        ))}
      </svg>
    </div>
  );
}

const STATE_CLASS = {
  selected: "text-chart-2",
  active: "text-primary",
  marked: "text-chart-3",
} as const;

function OpView({
  op,
  state,
  onSelect,
}: {
  op: Op;
  state: keyof typeof STATE_CLASS | null;
  onSelect?: (index: number) => void;
}): ReactNode {
  const note = op.t === "mask" ? undefined : op.note;
  const common =
    note === undefined
      ? { pointerEvents: "none" as const }
      : {
          "data-note": note,
          "data-active": state === "active" ? "true" : undefined,
          className: `${state ? STATE_CLASS[state] : ""} ${onSelect ? "cursor-pointer" : ""}`,
          onClick: onSelect
            ? (e: React.MouseEvent) => {
                e.stopPropagation();
                onSelect(note);
              }
            : undefined,
        };
  switch (op.t) {
    case "line":
      return <line x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2} stroke="currentColor" strokeWidth={op.w} {...common} />;
    case "head":
      return (
        <ellipse
          cx={op.x}
          cy={op.y}
          rx={op.rx}
          ry={op.ry}
          transform={`rotate(-20 ${op.x} ${op.y})`}
          fill={op.filled ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={op.filled ? 0.5 : 1.4}
          pointerEvents="all"
          {...common}
        />
      );
    case "path":
      return <path d={op.d} fill={op.fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth={op.w} strokeLinecap="round" {...common} />;
    case "dot":
      return <circle cx={op.x} cy={op.y} r={op.r} fill="currentColor" {...common} />;
    case "mask":
      return <rect x={op.x} y={op.y} width={op.w} height={op.h} className="fill-background" />;
    case "text":
      return (
        <text
          x={op.x}
          y={op.y}
          fontSize={op.size}
          fontWeight={op.bold ? 700 : 400}
          textAnchor={op.anchor ?? "start"}
          fill="currentColor"
          data-fret={op.fret ? "" : undefined}
          {...common}
        >
          {op.s}
        </text>
      );
  }
}
