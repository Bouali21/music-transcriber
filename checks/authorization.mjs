// Authorization: private paths, ownership, the public share route, admin-only overview, no own sign-in.
import { startRuntime, expect } from '/home/user/oss-new/control/runtime/index.mjs';
import { createScore, json } from './lib.mjs';

const runtime = await startRuntime();
try {
  await runtime.assertPrivateAccess(['/', '/new', '/api/scores']);

  const mine = await createScore(runtime, 'owner', { title: 'Owner sketch in D' });
  const theirs = await createScore(runtime, 'member', { title: 'Member etude' });

  // Anonymous visitors and other organizations reach none of the score API.
  for (const role of [undefined, 'outsider']) {
    for (const path of [`/api/scores/${mine.id}`, `/api/scores/${mine.id}/audio`, `/api/scores/${mine.id}/export/midi`, `/scores/${mine.id}`]) {
      const res = await runtime.fetch(path, { role });
      expect([401, 403]).toContain(res.status);
    }
    const res = await runtime.fetch('/api/scores', { role, method: 'POST', body: new FormData() });
    expect([401, 403]).toContain(res.status);
  }

  // One member never reads or changes another's score, admins included.
  for (const [role, other] of [['member', mine], ['owner', theirs]]) {
    for (const path of ['', '/audio', '/export/midi', '/export/musicxml', '/export/pdf']) {
      expect((await runtime.fetch(`/api/scores/${other.id}${path}`, { role })).status).toBe(404);
    }
    expect((await runtime.fetch(`/api/scores/${other.id}`, { role, method: 'PATCH', ...json({ version: 1, title: 'Taken' }) })).status).toBe(404);
    expect((await runtime.fetch(`/api/scores/${other.id}/share`, { role, method: 'POST' })).status).toBe(404);
    expect((await runtime.fetch(`/api/scores/${other.id}`, { role, method: 'DELETE' })).status).toBe(404);
    const list = await (await runtime.fetch('/api/scores', { role })).json();
    expect(list.scores.map((s) => s.id)).not.toContain(other.id);
  }
  const still = await (await runtime.fetch(`/api/scores/${mine.id}`, { role: 'owner' })).json();
  expect(still.score.title).toBe('Owner sketch in D');

  const memberPage = await (await runtime.context('member')).newPage();
  await memberPage.goto('/');
  await expect(memberPage.getByTestId('score-row')).toHaveCount(1);
  await expect(memberPage.getByText('Owner sketch in D')).toHaveCount(0);
  await memberPage.goto(`/scores/${mine.id}`);
  await expect(memberPage.getByTestId('score-missing')).toBeVisible();
  await expect(memberPage.getByText('Owner sketch in D')).toHaveCount(0);

  // The public share route shows only the shared score, read-only.
  const { shareUrl } = await (await runtime.fetch(`/api/scores/${mine.id}/share`, { role: 'owner', method: 'POST' })).json();
  const path = new URL(shareUrl).pathname;
  const html = await (await runtime.fetch(path)).text();
  expect(html).toContain('Owner sketch in D');
  expect(html).not.toContain('Member etude');
  expect(html).not.toContain('owner@example.test');
  expect(html).not.toContain('/audio');
  expect((await runtime.fetch('/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
  expect((await runtime.fetch(`/s/${mine.id}`)).status).toBe(404);
  // A visitor with the link still can't change the score or fetch its recording.
  expect([401, 403]).toContain((await runtime.fetch(`/api/scores/${mine.id}/audio`)).status);
  expect([401, 403]).toContain((await runtime.fetch(`${path}`, { method: 'POST' })).status);
  const visitor = await (await runtime.context(null)).newPage();
  await visitor.goto(path);
  await expect(visitor.getByTestId('score-title')).toHaveText('Owner sketch in D');
  await expect(visitor.getByTestId('edit-toggle')).toHaveCount(0);
  await expect(visitor.getByTestId('share-toggle')).toHaveCount(0);
  await expect(visitor.getByText('All apps')).toHaveCount(0);

  // Admin-only overview: counts per member, refused to non-admins.
  expect((await runtime.fetch('/api/admin/usage', { role: 'member' })).status).toBe(403);
  const usage = await (await runtime.fetch('/api/admin/usage', { role: 'owner' })).json();
  expect(usage.members.find((m) => m.email === 'member@example.test').scores).toBe(1);
  expect(JSON.stringify(usage)).not.toContain('Member etude');
  await memberPage.goto('/admin');
  await expect(memberPage.getByTestId('admin-refused')).toBeVisible();
  await expect(memberPage.getByText('owner@example.test')).toHaveCount(0);
  const ownerPage = await (await runtime.context('owner')).newPage();
  await ownerPage.goto('/admin');
  await expect(ownerPage.getByTestId('usage-row')).toHaveCount(2);

  // No AI provider on this Gateway: the assistant stays hidden.
  await ownerPage.goto(`/scores/${mine.id}`);
  await ownerPage.getByTestId('edit-toggle').click();
  await expect(ownerPage.getByTestId('save-score')).toBeVisible();
  await expect(ownerPage.getByTestId('assistant-panel')).toHaveCount(0);

  // Sharing off: the link is gone for everyone.
  await runtime.fetch(`/api/scores/${mine.id}/share`, { role: 'owner', method: 'DELETE' });
  expect((await runtime.fetch(path)).status).toBe(404);

  // The app serves no sign-in of its own.
  for (const p of ['/login', '/signin', '/sign-in', '/signup', '/register', '/logout', '/account']) {
    const res = await runtime.fetch(p, { role: 'owner' });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/type="password"/);
  }
  console.log('authorization: ok');
} finally {
  await runtime.close();
}
