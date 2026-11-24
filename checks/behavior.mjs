// Behavior: every retained feature's main path, against the packaged release.
import { startRuntime, expect } from '/home/user/oss-new/control/runtime/index.mjs';
import { createScore, json, longWav, melodyWav, SAMPLE_NOTES } from './lib.mjs';

// A Gateway whose AI provider answers: the assistant raises every note an octave.
const FAKE_GATEWAY = `export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/ai/') && url.pathname.endsWith('/chat/completions')) {
    const body = await request.json();
    if (!body.messages || body.messages.length === 0) return Response.json({ error: { message: 'messages required' } }, { status: 400 });
    const content = JSON.stringify({ summary: 'Moved the whole melody up an octave.', edits: [{ op: 'transpose', semitones: 12 }] });
    return Response.json({ id: 'x', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  }
  return Response.json({ code: 'integration_not_configured', message: 'not configured' }, { status: 503, headers: { 'x-everyapp-error': 'integration_not_configured' } });
} };`;

const runtime = await startRuntime({
  bindings: { EVERY_APP_GATEWAY: { type: 'worker', worker: 'fake-gateway' } },
  workers: [{ config: { name: 'fake-gateway', compatibilityDate: '2025-01-01', manifest: { mainModule: 'g.mjs', modules: { 'g.mjs': { type: 'esm', contents: FAKE_GATEWAY } } } } }],
});
try {
  // ---- Request-level: create, read, audio, exports, stale save, limits, sharing.
  const score = await createScore(runtime, 'owner');
  expect(score.title).toBe('Harbor Lullaby');
  expect(score.notes).toHaveLength(SAMPLE_NOTES.length);
  expect(score.version).toBe(1);

  const list = await (await runtime.fetch('/api/scores', { role: 'owner' })).json();
  expect(list.scores.map((s) => s.id)).toContain(score.id);

  const audio = await runtime.fetch(`/api/scores/${score.id}/audio`, { role: 'owner' });
  expect(audio.status).toBe(200);
  expect(audio.headers.get('content-type')).toContain('audio/wav');
  expect(Buffer.from(await audio.arrayBuffer()).subarray(0, 4).toString()).toBe('RIFF');

  const midi = await runtime.fetch(`/api/scores/${score.id}/export/midi`, { role: 'owner' });
  expect(midi.status).toBe(200);
  expect(Buffer.from(await midi.arrayBuffer()).subarray(0, 4).toString()).toBe('MThd');
  const xml = await (await runtime.fetch(`/api/scores/${score.id}/export/musicxml`, { role: 'owner' })).text();
  expect(xml).toContain('<score-partwise');
  expect(xml).toContain('<work-title>Harbor Lullaby</work-title>');
  expect(xml).toContain('<fifths>1</fifths>');
  const pdf = Buffer.from(await (await runtime.fetch(`/api/scores/${score.id}/export/pdf`, { role: 'owner' })).arrayBuffer());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

  // Saving moves the version on; a save from the old version is refused, and exports follow the save.
  const saved = await runtime.fetch(`/api/scores/${score.id}`, { role: 'owner', method: 'PATCH', ...json({ version: 1, title: 'Harbor Lullaby (verse)', notes: [...SAMPLE_NOTES, { p: 76, s: 8, d: 1 }] }) });
  expect(saved.status).toBe(200);
  expect((await saved.json()).score.version).toBe(2);
  const stale = await runtime.fetch(`/api/scores/${score.id}`, { role: 'owner', method: 'PATCH', ...json({ version: 1, title: 'Overwrite' }) });
  expect(stale.status).toBe(409);
  const xml2 = await (await runtime.fetch(`/api/scores/${score.id}/export/musicxml`, { role: 'owner' })).text();
  expect(xml2).toContain('Harbor Lullaby (verse)');
  expect(xml2.match(/<note>/g).length).toBeGreaterThan(xml.match(/<note>/g).length - 1);

  // Bad notes and recordings over 15 minutes are refused.
  const badNote = await runtime.fetch(`/api/scores/${score.id}`, { role: 'owner', method: 'PATCH', ...json({ version: 2, notes: [{ p: 200, s: 0, d: 1 }] }) });
  expect(badNote.status).toBe(400);
  await expect(createScore(runtime, 'owner', { durationSec: 901 })).rejects.toThrow(/15 minutes/);

  // Sharing: a link on this host that anyone can open, and that stops when sharing stops.
  const shared = await (await runtime.fetch(`/api/scores/${score.id}/share`, { role: 'owner', method: 'POST' })).json();
  const shareUrl = new URL(shared.shareUrl);
  expect(shareUrl.hostname).toBe(runtime.hostname);
  expect(shareUrl.pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{22,}$/);
  const anon = await runtime.fetch(shareUrl.pathname);
  expect(anon.status).toBe(200);
  expect(await anon.text()).toContain('Harbor Lullaby (verse)');

  // ---- Library: rename, search, delete with confirmation.
  const ctx = await runtime.context('owner');
  const page = await ctx.newPage();
  const extra = await createScore(runtime, 'owner', { title: 'Rainy Tuesday riff', instrument: 'guitar' });
  await page.goto('/');
  await runtime.assertBackLink(page);
  await expect(page.getByTestId('score-row')).toHaveCount(2);
  await page.getByTestId('score-search').fill('rainy');
  await expect(page.getByTestId('score-row')).toHaveCount(1);
  await page.getByTestId('score-row').first().getByTestId('rename-score').click();
  await page.getByTestId('rename-input').fill('Rainy Tuesday riff (capo off)');
  await page.getByTestId('rename-save').click();
  await expect(page.getByTestId('score-row').first()).toContainText('Rainy Tuesday riff (capo off)');

  // ---- Guitar tab: strings and frets in standard tuning, playable, and in the PDF.
  await page.getByTestId('score-row').first().getByRole('link').first().click();
  await expect(page.getByTestId('score-title')).toHaveText('Rainy Tuesday riff (capo off)');
  await page.getByRole('tab', { name: 'Tab' }).click();
  await expect(page.getByTestId('tab-view')).toBeVisible();
  await expect(page.getByTestId('tab-view').locator('[data-fret]').first()).toBeVisible();
  expect(await page.getByTestId('tab-view').locator('[data-fret]').count()).toBe(SAMPLE_NOTES.length);
  await page.getByTestId('play-toggle').click();
  await expect(page.getByTestId('play-toggle')).toHaveAccessibleName('Pause');
  await page.getByTestId('play-toggle').click();
  const tabPdf = Buffer.from(await (await runtime.fetch(`/api/scores/${extra.id}/export/pdf`, { role: 'owner' })).arrayBuffer()).toString('latin1');
  expect(tabPdf).toContain('(TAB)');

  // Delete with confirmation removes the score and its recording.
  await page.goto('/');
  await page.getByTestId('score-search').fill('rainy');
  await page.getByTestId('score-row').first().getByTestId('delete-score').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('score-row')).toHaveCount(0);
  expect((await runtime.fetch(`/api/scores/${extra.id}/audio`, { role: 'owner' })).status).toBe(404);

  // ---- Transcribe: a recording over 15 minutes is refused with a message.
  await page.goto('/new');
  await page.getByTestId('audio-file').setInputFiles({ name: 'rehearsal.wav', mimeType: 'audio/wav', buffer: longWav() });
  await page.getByTestId('start-transcription').click();
  await expect(page.getByTestId('transcribe-error')).toContainText('15 minutes');

  // ---- Transcribe a piano recording end to end.
  await page.goto('/new');
  await page.getByTestId('audio-file').setInputFiles({ name: 'Morning Song - piano take 2.wav', mimeType: 'audio/wav', buffer: melodyWav() });
  await expect(page.getByTestId('title-input')).toHaveValue('Morning Song - piano take 2');
  await page.getByTestId('instrument-select').click();
  await page.getByRole('option', { name: 'Piano' }).click();
  await page.getByTestId('start-transcription').click();
  await page.waitForURL(/\/scores\/[0-9a-f-]{36}$/, { timeout: 60000 });
  await expect(page.getByTestId('score-title')).toHaveText('Morning Song - piano take 2');
  await expect(page.getByTestId('score-key')).toHaveText('C major');
  await expect(page.getByTestId('score-tempo')).toHaveText('120 bpm');
  const noteCount = Number((await page.getByTestId('note-count').textContent()).match(/\d+/)[0]);
  expect(noteCount).toBeGreaterThanOrEqual(14);
  expect(noteCount).toBeLessThanOrEqual(18);
  await expect(page.getByTestId('notation').locator('[data-note]').first()).toBeVisible();
  await expect(page.getByTestId('original-audio')).toHaveAttribute('src', /\/api\/scores\/.+\/audio$/);
  const scoreId = page.url().split('/').pop();

  // ---- Playback: speed, metronome, follow-along, back to start.
  await page.getByTestId('speed-up').click();
  await expect(page.getByTestId('speed-value')).toHaveText('1.25×');
  await page.getByTestId('metronome-toggle').click();
  await page.getByTestId('play-toggle').click();
  await expect(page.getByTestId('notation').locator('[data-active="true"]').first()).toBeVisible();
  await page.getByTestId('play-toggle').click();
  await page.getByTestId('seek-start').click();
  await expect(page.getByTestId('play-position')).toHaveText('1.1');

  // ---- Piano roll: keyboard, hand split, transpose.
  await page.getByRole('tab', { name: 'Piano roll' }).click();
  await expect(page.getByTestId('piano-roll')).toBeVisible();
  await page.getByTestId('roll-transpose-up').click();
  await expect(page.getByTestId('roll-transpose')).toHaveText('+1');
  await page.getByRole('button', { name: 'Right hand' }).click();
  await expect(page.getByTestId('piano-roll').locator('[data-hand="left"]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Sheet' }).click();

  // ---- Edit: change a note, undo/redo, tempo, save; a stale copy is refused.
  await page.getByTestId('edit-toggle').click();
  await page.getByTestId('notation').locator('[data-note="0"]').first().click();
  await expect(page.getByTestId('selected-note')).toHaveText('C4 · quarter');
  await page.getByTestId('note-up').click();
  await expect(page.getByTestId('selected-note')).toHaveText('C♯4 · quarter');
  await page.getByTestId('note-longer').click();
  await expect(page.getByTestId('selected-note')).toHaveText('C♯4 · dotted quarter');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('selected-note')).toHaveText('C♯4 · quarter');
  await page.getByTestId('redo').click();
  await page.getByTestId('note-add').click();
  await expect(page.getByTestId('note-count')).toHaveText(`${noteCount + 1} notes`);
  await page.getByTestId('note-delete').click();
  await expect(page.getByTestId('note-count')).toHaveText(`${noteCount} notes`);
  await page.getByTestId('edit-tempo').fill('108');
  await page.getByTestId('save-score').click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const afterSave = await (await runtime.fetch(`/api/scores/${scoreId}`, { role: 'owner' })).json();
  expect(afterSave.score.tempo).toBe(108);
  expect(afterSave.score.notes.some((n) => n.p === 61 && n.d === 1.5)).toBe(true);

  // Someone else saves first: this copy is now stale.
  await runtime.fetch(`/api/scores/${scoreId}`, { role: 'owner', method: 'PATCH', ...json({ version: afterSave.score.version, title: 'Morning Song (final)' }) });
  await page.getByTestId('transpose-up').click();
  await page.getByTestId('save-score').click();
  await expect(page.getByTestId('save-conflict')).toBeVisible();
  await page.getByTestId('reload-score').click();
  await expect(page.getByTestId('score-title')).toHaveText('Morning Song (final)');

  // ---- Assistant: a request becomes a previewed edit the member keeps.
  await page.getByTestId('edit-toggle').click();
  await page.getByTestId('assistant-input').fill('Move the whole melody up an octave');
  await page.getByTestId('assistant-ask').click();
  await expect(page.getByTestId('assistant-preview')).toContainText('Moved the whole melody up an octave.');
  await page.getByTestId('assistant-keep').click();
  await page.getByTestId('save-score').click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const afterAssist = await (await runtime.fetch(`/api/scores/${scoreId}`, { role: 'owner' })).json();
  expect(Math.min(...afterAssist.score.notes.map((n) => n.p))).toBeGreaterThanOrEqual(72);
  await page.getByTestId('edit-toggle').click();

  // ---- Export links and sharing from the page.
  for (const [id, path] of [['export-midi', 'midi'], ['export-musicxml', 'musicxml'], ['export-pdf', 'pdf']]) {
    await expect(page.getByTestId(id)).toHaveAttribute('href', `/api/scores/${scoreId}/export/${path}`);
  }
  await page.getByTestId('share-toggle').click();
  await expect(page.getByTestId('share-link')).toHaveValue(new RegExp(`^https?://${runtime.hostname.replace(/\./g, '\\.')}(:\\d+)?/s/`));
  const link = new URL(await page.getByTestId('share-link').inputValue());

  // A visitor opens the link: notation and playback, no editing, no exports.
  const visitor = await (await runtime.context(null)).newPage();
  await visitor.goto(link.pathname);
  await expect(visitor.getByTestId('score-title')).toHaveText('Morning Song (final)');
  await expect(visitor.getByTestId('notation').locator('[data-note]').first()).toBeVisible();
  await visitor.getByTestId('play-toggle').click();
  await expect(visitor.getByTestId('play-toggle')).toHaveAccessibleName('Pause');
  await expect(visitor.getByTestId('edit-toggle')).toHaveCount(0);
  await expect(visitor.getByTestId('export-midi')).toHaveCount(0);
  await expect(visitor.getByTestId('original-audio')).toHaveCount(0);

  // Sharing off: the link stops working.
  await page.getByTestId('share-toggle').click();
  await expect(page.getByTestId('share-link')).toHaveCount(0);
  expect((await runtime.fetch(link.pathname)).status).toBe(404);

  // ---- Phone-sized smoke.
  const phone = await (await runtime.context('owner', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await phone.goto('/');
  await expect(phone.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(phone.getByTestId('score-row').first()).toBeVisible();
  await phone.goto(`/scores/${scoreId}`);
  await expect(phone.getByTestId('notation')).toBeVisible();
  await expect(phone.getByTestId('play-toggle')).toBeVisible();

  // The result of the main workflow, for the app's picture.
  await page.reload();
  await expect(page.getByTestId('notation').locator('[data-note]').first()).toBeVisible();
  await page.locator('main').evaluate((el) => el.parentElement.scrollTo(0, 0));
  await expect(page.getByTestId('score-title')).toBeInViewport();
  await runtime.screenshot(page);
  console.log('behavior: ok');
} finally {
  await runtime.close();
}
