import { expect, test, type Browser, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

test('e2e mode: live-lab is offline, provides no readout and causes no errors', async ({ page }) => {
  const errors = captureConsole(page);
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  await waitForReady(page, '/?e2e=1');
  const feature = await page.evaluate(() => globalThis.__app!.features().find((f) => f.id === 'live-lab'));
  expect(feature).toEqual({ id: 'live-lab', enabled: true });
  expect(await page.evaluate(() => globalThis.__app!.state().room)).toEqual({ code: null, role: null, connected: false, viewers: 0, dist: {} });
  await expect(page.locator('.sl-live-lab')).toHaveCount(0);
  expect(sockets).toEqual([]);
  await expectHealthyBoot(page, errors);
});

async function viewer(browser: Browser): Promise<{ page: Page; errors: string[] }> {
  const page = await (await browser.newContext()).newPage();
  const errors = captureConsole(page);
  // ?debug=1 exposes window.__app without e2e mode (which would keep the room offline). Two full-speed pages
  // share one SwiftShader CPU, so the second boot gets a longer budget than waitForReady's 20 s.
  await page.goto('/?debug=1&quality=low');
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 60_000 });
  return { page, errors };
}

test('two viewers see each other and the suspension distribution (real Room DO in workerd)', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await viewer(browser);
  const b = await viewer(browser);
  for (const { page } of [a, b]) {
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().room.viewers), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.sl-live-lab')).toBeVisible();
    await expect(page.locator('.sl-live-lab-count')).toHaveText(/^Laboratuvarda \d+ kişi$/);
  }
  expect(await a.page.evaluate(() => globalThis.__app!.state().room)).toMatchObject({ code: 'LIVE', role: 'viewer', connected: true });

  await b.page.evaluate(() => globalThis.__app!.set('suspensionId', 'macpherson'));
  await expect
    .poll(() => a.page.evaluate(() => globalThis.__app!.state().room.dist['gt-coupe:macpherson'] ?? 0), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1);
  // Labels are the suspension's short copy label (MacPherson = "Strut").
  await expect(a.page.locator('.sl-live-lab-legend')).toContainText(/Dikme|MacPherson/);
  // My own pick is highlighted in my readout.
  await expect(b.page.locator('.sl-live-lab-item[data-mine]')).toContainText(/Dikme|MacPherson/);

  // Leaving updates the count for the one who stays.
  const before = await a.page.evaluate(() => globalThis.__app!.state().room.viewers);
  await b.page.context().close();
  await expect.poll(() => a.page.evaluate(() => globalThis.__app!.state().room.viewers), { timeout: 10_000 }).toBeLessThan(before);
  await expectHealthyBoot(a.page, a.errors);
  expect(b.errors).toEqual([]);
});
