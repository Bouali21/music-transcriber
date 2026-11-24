import { useCallback, useEffect, useRef, useState } from "react";
import { instrumentOf, totalBeats, type ScoreData } from "@/lib/music/types";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

interface Running {
  ctx: AudioContext;
  audioT0: number;
  perfT0: number;
  startBeat: number;
  next: number;
  nextClick: number;
  timer: number;
  frame: number;
}

/** Plays a score with a small synthesizer; `beat` follows along for highlighting. */
export function usePlayer(score: ScoreData, transpose = 0) {
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [metronome, setMetronome] = useState(false);
  const running = useRef<Running | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const latest = useRef({ score, speed, metronome, transpose, beat });
  latest.current = { score, speed, metronome, transpose, beat };

  const stop = useCallback(() => {
    const r = running.current;
    if (!r) return;
    clearInterval(r.timer);
    cancelAnimationFrame(r.frame);
    running.current = null;
    setPlaying(false);
  }, []);

  const start = useCallback((fromBeat: number) => {
    const { score: sc, speed: sp } = latest.current;
    const ctx = ctxRef.current ?? new AudioContext();
    ctxRef.current = ctx;
    void ctx.resume();
    const notes = sc.notes;
    const end = totalBeats(sc);
    const from = fromBeat >= end ? 0 : fromBeat;
    const r: Running = {
      ctx,
      audioT0: ctx.currentTime + 0.08,
      perfT0: performance.now() + 80,
      startBeat: from,
      next: notes.findIndex((n) => n.s >= from - 1e-6),
      nextClick: Math.ceil(from - 1e-6),
      timer: 0,
      frame: 0,
    };
    if (r.next < 0) r.next = notes.length;
    const secPerBeat = () => 60 / (sc.tempo * sp);
    const tick = () => {
      const { metronome: click, transpose: tr } = latest.current;
      const horizon = ctx.currentTime + 0.35;
      while (r.next < notes.length) {
        const n = notes[r.next]!;
        const t = r.audioT0 + (n.s - r.startBeat) * secPerBeat();
        if (t > horizon) break;
        voice(ctx, n.p + tr, Math.max(t, ctx.currentTime), n.d * secPerBeat(), sc.instrument);
        r.next++;
      }
      const unit = 4 / sc.timeDen;
      while (true) {
        const t = r.audioT0 + (r.nextClick - r.startBeat) * secPerBeat();
        if (t > horizon || r.nextClick > end) break;
        if (click) {
          const inBar = Math.round(r.nextClick / unit) % sc.timeNum === 0;
          clickAt(ctx, Math.max(t, ctx.currentTime), inBar);
        }
        r.nextClick += unit;
      }
    };
    const frame = () => {
      const b = r.startBeat + Math.max(0, performance.now() - r.perfT0) / 1000 / secPerBeat();
      if (b >= end) {
        setBeat(0);
        stop();
        return;
      }
      setBeat(b);
      r.frame = requestAnimationFrame(frame);
    };
    tick();
    r.timer = window.setInterval(tick, 60);
    r.frame = requestAnimationFrame(frame);
    running.current = r;
    setPlaying(true);
  }, [stop]);

  const toggle = useCallback(() => {
    if (running.current) stop();
    else start(latest.current.beat);
  }, [start, stop]);

  const seekStart = useCallback(() => {
    const was = !!running.current;
    stop();
    setBeat(0);
    if (was) start(0);
  }, [start, stop]);

  // A change of speed restarts from where playback is.
  const changeSpeed = useCallback((value: number) => {
    setSpeed(value);
    latest.current.speed = value;
    if (running.current) {
      const b = latest.current.beat;
      stop();
      start(b);
    }
  }, [start, stop]);

  useEffect(() => () => {
    stop();
    void ctxRef.current?.close();
  }, [stop]);

  return { playing, beat, speed, metronome, toggle, seekStart, setSpeed: changeSpeed, setMetronome, stop };
}

function voice(ctx: AudioContext, pitch: number, at: number, length: number, instrument: string) {
  const freq = 440 * 2 ** ((pitch - 69) / 12);
  const plucked = instrumentOf(instrument).poly || instrument === "bass";
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = plucked ? "triangle" : instrument === "flute" || instrument === "voice" ? "sine" : "sawtooth";
  osc.frequency.value = freq;
  const peak = plucked ? 0.22 : 0.08;
  const endAt = at + Math.max(0.08, length);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.008);
  if (plucked) gain.gain.exponentialRampToValueAtTime(peak * 0.15, endAt);
  else gain.gain.setValueAtTime(peak, endAt - 0.03);
  gain.gain.linearRampToValueAtTime(0, endAt + 0.05);
  let node: AudioNode = gain;
  if (!plucked && osc.type === "sawtooth") {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = Math.min(4000, freq * 4);
    gain.connect(filter);
    node = filter;
  }
  osc.connect(gain);
  node.connect(ctx.destination);
  osc.start(at);
  osc.stop(endAt + 0.1);
}

function clickAt(ctx: AudioContext, at: number, accent: boolean) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = accent ? 1760 : 1320;
  gain.gain.setValueAtTime(0.12, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.05);
}
