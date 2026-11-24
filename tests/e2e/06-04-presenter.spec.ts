import { expect, test, type Browser, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot } from './helpers';

// Big screen + presenter phone + audience phones against the real Room DO (workerd via vite preview).
// The screen uses ?debug=1 (not e2e=1, which keeps the room offline) to expose window.__app.
const SHOTS = process.env['SHOTS_DIR'];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

async function phone(browser: Browser, path: string, size = PHONE): Promise<{ page: Page; errors: string[]; scripts: { url: string; body: string }[] }> {
  const page = await (await browser.newContext(size)).newPage();
  const errors = captureConsole(page);
  const scripts: { url: string; body: string }[] = [];
  page.on('response', async (r) => {
    if (r.request().resourceType() === 'script') scripts.push({ url: r.url(), body: await r.text().catch(() => '') });
  });
  await page.goto(path);
  return { page, errors, scripts };
}

const shot = async (page: Page, name: string, fullPage = false) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-04-${name}.png`, fullPage });
};

test('presenter phone drives the big screen; audience votes show as live bars', async ({ browser }) => {
  test.setTimeout(240_000);
  const screen = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const screenErrors = captureConsole(screen);
  await screen.goto('/?screen=1&quality=low&debug=1');
  await screen.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 90_000 });
  const state = () => screen.evaluate(() => globalThis.__app!.state());

  // Code + presenter QR (host key only in the QR's fragment).
  const card = screen.locator('.sl-presenter');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute('data-mode', 'host');
  await expect(card.locator('.sl-qr path')).toHaveAttribute('d', /^M/);
  const code = (await card.locator('.sl-presenter-code').textContent())!;
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  const { hostKey } = await screen.evaluate(() => JSON.parse(sessionStorage.getItem('sl-live-lab-screen-room')!) as { hostKey: string });
  await shot(screen, 'screen-code');

  // Presenter phone: /remote.html -> /remote keeps ?room= and the #k= fragment; the key is then removed from the URL.
  const host = await phone(browser, `/remote.html?room=${code}#k=${hostKey}`);
  await expect(host.page.locator('.rm-header')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
  await expect(host.page.locator('.rm-role')).toHaveText('Sunucu');
  expect(host.page.url()).toMatch(new RegExp(`/remote(\\.html)?\\?room=${code}$`));

  const tap = (name: string) => host.page.getByRole('button', { name, exact: true }).or(host.page.getByRole('radio', { name, exact: true })).first().click();
  await tap('Dikme');
  await expect.poll(async () => (await state()).suspensionId).toBe('macpherson');
  await expect(card).toHaveAttribute('data-mode', 'audience'); // the host took control
  await tap('Yakın plan');
  await host.page.getByRole('button', { name: /^Röntgen/ }).click();
  await tap('Çeyrek hız');
  await host.page.getByRole('button', { name: /^Büyüt/ }).click();
  await expect.poll(async () => {
    const s = await state();
    return [s.view, s.xray, s.timeScale, s.amplification];
  }).toEqual(['closeup', true, 0.25, 2.5]);
  await host.page.getByRole('button', { name: /^Firkete viraj/ }).click();
  await expect.poll(() => screen.evaluate(() => globalThis.__app!.frame().sectionId), { timeout: 10_000 }).toBe('hairpin');
  await tap('Ön tekerlek');
  await expect.poll(async () => (await state()).focusCorner).toBe('fl');
  await tap('Sürüş');
  await host.page.getByRole('button', { name: /^Röntgen/ }).click();
  await tap('Gerçek zaman');
  await expect.poll(async () => (await state()).view).toBe('follow');
  await shot(host.page, 'host', true);
  await host.page.setViewportSize({ width: 360, height: 640 });
  expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await shot(host.page, 'host-360');

  // Audience phones via the short link /r/CODE.
  const audience = [];
  for (let i = 0; i < 3; i++) {
    const a = await phone(browser, `/r/${code}`);
    await expect(a.page.locator('.rm-header')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
    await expect(a.page.locator('.rm-role')).toHaveText('İzleyici');
    audience.push(a);
  }
  await expect(audience[0]!.page.locator('.rm-wait-title')).toBeVisible();

  await tap('Anketi aç');
  const picks = ['Çift salıncak', 'Çift salıncak', 'Dikme'];
  for (const [i, a] of audience.entries()) {
    const option = a.page.getByRole('button', { name: new RegExp(`^${picks[i]}`) });
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click();
  }
  const bars = screen.locator('.sl-poll');
  await expect(bars).toBeVisible();
  await expect(bars.locator('.sl-poll-total')).toHaveText('3 oy', { timeout: 10_000 });
  await expect(bars.locator('.sl-poll-option[data-lead] .sl-poll-label')).toHaveText('Çift salıncak');
  await expect(audience[0]!.page.locator('.rm-poll-row[data-mine]')).toContainText('Çift salıncak');
  await expect(host.page.locator('.rm-poll-body')).toContainText('3 oy');
  await shot(audience[0]!.page, 'audience');
  await shot(screen, 'screen-poll');

  // Close and run the winner on the big screen.
  await tap('Anketi kapat');
  await expect(bars).toHaveAttribute('data-open', 'false');
  await host.page.getByRole('button', { name: 'Çift salıncak ile dene' }).click();
  await expect.poll(async () => (await state()).suspensionId).toBe('double-wishbone');
  await expect(audience[1]!.page.locator('.rm-ballot')).toHaveAttribute('data-open', 'false');

  await expectHealthyBoot(screen, screenErrors);
  for (const p of [host, ...audience]) expect(p.errors).toEqual([]);
  // The remote ships no three.js and stays small.
  const js = host.scripts.filter((s) => new URL(s.url).pathname.startsWith('/assets/') || s.url.includes('/src/'));
  expect(js.length).toBeGreaterThan(0);
  for (const s of js) expect(s.body).not.toMatch(/WebGLRenderer|three\.module/);
  expect(js.reduce((n, s) => n + s.body.length, 0)).toBeLessThan(80_000);
});

test('remote: redirect keeps the room, unknown rooms offer the code form at 360x640', async ({ browser, request }) => {
  const res = await request.get('/remote.html?room=ABCDE', { maxRedirects: 0 });
  if (res.status() >= 300 && res.status() < 400) expect(res.headers()['location']).toMatch(/\?room=ABCDE$/);
  else expect(res.status()).toBe(200);

  const a = await phone(browser, '/remote.html?room=ZZZZZ', { ...PHONE, viewport: { width: 360, height: 640 } });
  await expect(a.page.locator('.rm-header')).toHaveAttribute('data-status', 'gone', { timeout: 20_000 });
  await expect(a.page.locator('.rm-join')).toBeVisible();
  const overflow = await a.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Typing a code navigates to it (upper-cased).
  await a.page.locator('.rm-input').fill('zzzzy');
  await a.page.getByRole('button', { name: 'Katıl' }).click();
  await expect(a.page).toHaveURL(/room=ZZZZY/);
  // A closed WS upgrade for an unknown room is the only expected network noise.
  expect(a.errors.filter((e) => !/WebSocket|ZZZZ/.test(e))).toEqual([]);
});
