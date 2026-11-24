// Shared helpers for the suites: a synthesized recording and API calls.

/** A mono 16-bit PCM WAV of the given samples. */
export function wav(samples, sampleRate, bits = 16) {
  const bytes = bits / 8;
  const data = samples.length * bytes;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * bytes, 28);
  buf.writeUInt16LE(bytes, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    if (bits === 16) buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    else buf.writeUInt8(Math.round(v * 127 + 128), 44 + i);
  }
  return buf;
}

/** A short piano-like melody at 120 bpm in C major: [midi, beats] pairs. */
export const MELODY = [
  [60, 1], [64, 1], [67, 1], [72, 1],
  [71, 1], [67, 1], [69, 1], [65, 1],
  [64, 1], [62, 1], [60, 1], [67, 1],
  [65, 1], [64, 1], [62, 1], [60, 2],
];

export function melodyWav() {
  const sr = 22050;
  const beat = 0.5;
  const total = MELODY.reduce((a, [, b]) => a + b, 0) * beat + 0.5;
  const out = new Float32Array(Math.ceil(total * sr));
  let t = 0;
  for (const [midi, beats] of MELODY) {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const len = beats * beat - 0.04;
    const start = Math.round(t * sr);
    for (let i = 0; i < len * sr; i++) {
      const x = i / sr;
      const env = Math.min(1, x / 0.005) * Math.exp(-x * 1.5) * Math.min(1, (len - x) / 0.01);
      out[start + i] += 0.5 * env * (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(4 * Math.PI * f * x) + 0.15 * Math.sin(6 * Math.PI * f * x));
    }
    t += beats * beat;
  }
  return wav(out, sr);
}

/** Silence just over 15 minutes, 8-bit at 8 kHz. */
export function longWav() {
  return wav(new Float32Array(8000 * (15 * 60 + 2)), 8000, 8);
}

export const SAMPLE_NOTES = [
  { p: 64, s: 0, d: 1 }, { p: 67, s: 1, d: 1 }, { p: 71, s: 2, d: 2 },
  { p: 52, s: 0, d: 2 }, { p: 59, s: 2, d: 2 },
  { p: 69, s: 4, d: 1 }, { p: 67, s: 5, d: 0.5 }, { p: 66, s: 5.5, d: 0.5 }, { p: 64, s: 6, d: 2 },
];

/** Creates a score through the API as `role`; returns the parsed score. */
export async function createScore(runtime, role, overrides = {}) {
  const meta = {
    title: 'Harbor Lullaby', instrument: 'piano', tempo: 96, keyFifths: 1, keyMode: 'minor',
    timeNum: 4, timeDen: 4, durationSec: 5.5, notes: SAMPLE_NOTES, ...overrides,
  };
  const form = new FormData();
  form.set('audio', new Blob([melodyWav()], { type: 'audio/wav' }), 'take.wav');
  form.set('score', JSON.stringify(meta));
  const res = await runtime.fetch('/api/scores', { role, method: 'POST', body: form });
  if (res.status !== 201) throw new Error(`create ${res.status}: ${await res.text()}`);
  return (await res.json()).score;
}

export function json(body) {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
