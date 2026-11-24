// Persistence: scores, edits, recordings and share links survive a restart.
import { startRuntime, expect } from '/home/user/oss-new/control/runtime/index.mjs';
import { createScore, json } from './lib.mjs';

const runtime = await startRuntime();
try {
  const score = await createScore(runtime, 'owner', { title: 'Late Night Blues' });
  const edited = await runtime.fetch(`/api/scores/${score.id}`, { role: 'owner', method: 'PATCH', ...json({ version: 1, tempo: 72, notes: [{ p: 55, s: 0, d: 2 }, { p: 58, s: 2, d: 2 }] }) });
  expect(edited.status).toBe(200);
  const { shareUrl } = await (await runtime.fetch(`/api/scores/${score.id}/share`, { role: 'owner', method: 'POST' })).json();

  await runtime.restart();

  const back = (await (await runtime.fetch(`/api/scores/${score.id}`, { role: 'owner' })).json()).score;
  expect(back.title).toBe('Late Night Blues');
  expect(back.tempo).toBe(72);
  expect(back.version).toBe(2);
  expect(back.notes).toEqual([{ p: 55, s: 0, d: 2 }, { p: 58, s: 2, d: 2 }]);
  const audio = await runtime.fetch(`/api/scores/${score.id}/audio`, { role: 'owner' });
  expect(audio.status).toBe(200);
  expect((await audio.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  expect((await runtime.fetch(new URL(shareUrl).pathname)).status).toBe(200);

  const page = await (await runtime.context('owner')).newPage();
  await page.goto('/');
  await expect(page.getByTestId('score-row')).toContainText('Late Night Blues');
  console.log('persistence: ok');
} finally {
  await runtime.close();
}
