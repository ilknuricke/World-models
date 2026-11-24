/**
 * 12-05 saved runs (ARCHITECTURE-M2 §12.1) against the real worker + local D1 (private preview; the worker's
 * TURNSTILE_SECRET is Cloudflare's always-pass test secret, the page uses the test site keys on localhost):
 * 1. a > 60 s run: the popover offers the last minute as a link and "Save the whole run"; no Turnstile request before
 *    the click; save → challenge → `#rid=` link → copied → opened in a new page it plays as "Shared run" to the
 *    identical end-state CRC; a saved run of an older model plays labelled.
 * 2. failures (mocked answers, always-fail site key): each says what happened, the fragment link stays, "Try again"
 *    only where it can help.
 * 3. opening `#rid=` links that cannot play: unknown id (real 404), malformed id, offline.
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:<private port> npx playwright test tests/e2e/12-05-share.spec.ts --trace off
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { expect, test, type Page, type Route } from '@playwright/test';
import { decodeReplayResult, encodeReplay } from '../../src/sim-core/replay/format';
import { captureConsole } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/12-05-shots';
mkdirSync(SHOTS, { recursive: true });
const MANUAL = '/?e2e=1&quality=low&t=40&drive=manual';
const VIEWER = '/?e2e=1&quality=low&paused=1&t=5';
const DT = 1 / 240;
const TURNSTILE = 'challenges.cloudflare.com';

const advance = (page: Page, s: number) => page.evaluate((x) => globalThis.__app!.advance(x), s);
const mode = (page: Page) => page.evaluate(() => globalThis.__app!.state().driveMode);
const pause = (page: Page) => page.evaluate(() => globalThis.__app!.set('paused', true));
const intent = (page: Page, i: Record<string, number> | null) => page.evaluate((x) => globalThis.__app!.driveIntent(x), i);
const data = (page: Page, sel: string, key: string) => page.evaluate(([s, k]) => (document.querySelector(s!) as HTMLElement | null)?.dataset[k!] ?? null, [sel, key]);
const panel = (page: Page) => page.locator('.sl-replay-share');
/** The widget's frame (Turnstile renders it inside a closed shadow root, so it is found by frame URL). */
const widgetFrames = (page: Page) => page.frames().filter((f) => f.url().includes(TURNSTILE)).length;

/** Errors that are not the answers this spec provokes (mocked 4xx/5xx, the 404 of an unknown id, the widget's own logs). */
const unexpected = (errors: readonly string[]) => errors.filter((e) => !e.includes('/api/replays') && !e.includes(TURNSTILE) && !e.includes('Failed to load resource'));

async function open(page: Page, path: string): Promise<void> {
  await page.goto('about:blank');
  await page.goto(path);
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
}

/** Manual, paused, a scripted drive of about `seconds` in fixed steps. */
async function recordDrive(page: Page, seconds: number): Promise<void> {
  await open(page, MANUAL);
  await expect.poll(() => mode(page)).toBe('manual');
  await pause(page);
  const script: [Record<string, number>, number][] = [
    [{ throttle: 0.6 }, 2.5],
    [{ throttle: 0.4, steer: 0.4 }, 2],
    [{ throttle: 0.3, steer: -0.5 }, 2],
    [{ brake: 0.6 }, 1],
    [{ throttle: 0.5, steer: 0.2 }, 2.5],
  ];
  for (let t = 0; t < seconds; ) {
    for (const [i, s] of script) {
      await intent(page, i);
      await advance(page, s);
      t += s;
    }
  }
  await intent(page, null);
}

async function toEnd(page: Page): Promise<void> {
  await expect.poll(() => mode(page)).toBe('replay');
  await pause(page);
  await advance(page, 0);
  const tick = Number(await data(page, '.sl-replay', 'tick'));
  const ticks = Number(await data(page, '.sl-replay', 'ticks'));
  expect(ticks).toBeGreaterThan(0);
  await advance(page, (ticks - tick) * DT);
  await advance(page, 0);
}

test.describe('12-05 saved runs', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(420_000);

  test('a long run: last minute as a link, save the whole run, open #rid= elsewhere: same end state', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors = captureConsole(page);
    const thirdParty: string[] = [];
    page.on('request', (r) => r.url().includes(TURNSTILE) && thirdParty.push(r.url()));
    await recordDrive(page, 70);
    test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');

    await page.locator('[data-action="share"]').click();
    const input = page.locator('.sl-replay-link');
    await expect(input).toHaveValue(/#r=/);
    await expect(panel(page)).toContainText('Son dakika paylaşılıyor');
    const saveBtn = page.locator('[data-action="save"]');
    await expect(saveBtn).toHaveText('Tüm sürüşü kaydet');
    expect(thirdParty, 'no Turnstile request before the visitor chooses to save').toEqual([]);
    expect(await page.locator(`script[src*="${TURNSTILE}"]`).count()).toBe(0);

    // slow the POST a little so the challenge state can be looked at
    await page.route('**/api/replays', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await saveBtn.click();
    await expect(page.locator('.sl-replay-privacy')).toBeVisible();
    await expect(page.locator('.sl-replay-privacy')).toContainText('yalnızca kontrol girdileriniz ve başlangıç durumu');
    await expect.poll(() => widgetFrames(page), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(SHOTS, '12-05-save-challenge.png') });
    expect(thirdParty.length).toBeGreaterThan(0);

    await expect.poll(() => data(page, '.sl-replay-share', 'save'), { timeout: 60_000 }).toBe('saved');
    await page.unroute('**/api/replays');
    const link = await input.inputValue();
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.hash).toMatch(/^#rid=[A-HJKMNP-Z2-9]{12}$/);
    const id = url.hash.slice(5);
    await expect(panel(page)).toContainText('Kaydedildi: bu kısa bağlantı tüm sürüşü');
    await expect(page.locator('.sl-replay-turnstile')).toBeHidden();
    await page.locator('[data-action="copy"]').click();
    await expect(panel(page)).toContainText('Bağlantı kopyalandı');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await page.screenshot({ path: join(SHOTS, '12-05-saved.png') });
    const crc = await data(page, '.sl-replay-share', 'saveCrc');
    const ticks = Number(await data(page, '.sl-replay-share', 'saveTicks'));
    console.log(`[12-05] saved ${id}: ${ticks / 240} s run, link ${link.length} chars, end crc ${crc}`);
    expect(ticks).toBeGreaterThan(240 * 65);
    expect(unexpected(errors)).toEqual([]);
    await page.close();

    // the viewer: paused Auto elsewhere on the lap opens the short link
    const viewer = await context.newPage();
    const vErrors = captureConsole(viewer);
    const vThird: string[] = [];
    viewer.on('request', (r) => r.url().includes(TURNSTILE) && vThird.push(r.url()));
    await open(viewer, `${VIEWER}#rid=${id}`);
    await expect.poll(() => mode(viewer)).toBe('replay');
    await expect(viewer.locator('.sl-replay-label')).toHaveText('Paylaşılan sürüş');
    await expect(viewer.locator('[data-action="drive"]')).toHaveText('Kendiniz sürün');
    await pause(viewer);
    await advance(viewer, 4);
    await viewer.screenshot({ path: join(SHOTS, '12-05-open-rid.png') });
    await toEnd(viewer);
    expect(await mode(viewer)).toBe('manual');
    expect(await data(viewer, '.sl-replay', 'endCrc')).toBe(crc);
    expect(vThird, 'opening a saved run loads no third-party script').toEqual([]);
    expect(unexpected(vErrors)).toEqual([]);

    // the same saved run as recorded by an older model: plays, labelled
    const got = (await (await fetch(`${baseURL}/api/replays/${id}`)).json()) as { data: string };
    const decoded = decodeReplayResult(new Uint8Array(inflateRawSync(Buffer.from(got.data, 'base64url'))));
    if (!('replay' in decoded)) throw new Error('saved run did not decode in Node');
    const older = deflateRawSync(encodeReplay({ ...decoded.replay, header: { ...decoded.replay.header, simVersion: 'm2.0' } })).toString('base64url');
    await viewer.close();
    const v2 = await context.newPage();
    await v2.route('**/api/replays/PREVMQDEKS22', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: older, createdAt: 0, expiresAt: 0 }) }));
    await open(v2, `${VIEWER}#rid=PREVMQDEKS22`);
    await expect.poll(() => mode(v2)).toBe('replay');
    await expect(v2.locator('.sl-replay-note')).toContainText('Eski bir modelle');
    await pause(v2);
    await v2.screenshot({ path: join(SHOTS, '12-05-open-rid-older.png') });
  });

  test('save failures say what happened; the fragment link stays; retry only where it helps', async ({ page }) => {
    const errors = captureConsole(page);
    await recordDrive(page, 10);
    test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');
    let posts = 0;
    let answer: (route: Route) => Promise<void> = (route) => route.continue();
    await page.route('**/api/replays', (route) => {
      posts++;
      return answer(route);
    });
    const reply = (status: number, error: string) => (route: Route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });
    const openPanel = async () => {
      if (await panel(page).isVisible()) await page.locator('[data-action="share"]').click();
      await page.locator('[data-action="share"]').click();
      await expect(page.locator('.sl-replay-link')).toHaveValue(/#r=/);
      await expect(page.locator('[data-action="save"]')).toHaveText('Kısa bağlantı kaydet');
    };
    const attempt = async (code: string, text: string, retry: boolean) => {
      await page.locator('[data-action="save"]').click();
      await expect.poll(() => data(page, '.sl-replay-share', 'saveError'), { timeout: 60_000 }).toBe(code);
      await expect(page.locator('.sl-replay-share-msg')).toContainText(text);
      await expect(page.locator('.sl-replay-share-msg')).toContainText('Yukarıdaki bağlantıyla tüm sürüşü paylaşabilirsiniz.');
      await expect(page.locator('.sl-replay-link')).toHaveValue(/#r=/);
      await expect(page.locator('.sl-replay-turnstile')).toBeHidden();
      if (retry) {
        await expect(page.locator('[data-action="save"]')).toHaveText('Yeniden dene');
        await expect(page.locator('[data-action="save"]')).toBeFocused();
      } else await expect(page.locator('[data-action="save"]')).toBeHidden();
    };

    await openPanel();
    answer = reply(403, 'turnstile');
    await attempt('challenge', 'Doğrulama başarısız oldu', true);
    answer = reply(429, 'busy');
    await attempt('busy', 'Bir dakika bekleyip', true);
    answer = reply(503, 'storage_unavailable');
    await attempt('storage', 'Kayıt alanı şu anda dolu', true);
    answer = (route) => route.abort('internetdisconnected');
    await attempt('offline', 'Çevrimdışısınız', true);
    answer = reply(503, 'daily_cap');
    await attempt('daily_cap', 'kayıt kotası doldu', false);
    await page.screenshot({ path: join(SHOTS, '12-05-error-daily-cap.png') });
    await openPanel();
    answer = reply(503, 'not_configured');
    await attempt('disabled', 'sürüş kaydı kapalı', false);
    expect(posts).toBe(6);

    // the always-fail test site key: the check fails in the widget, nothing is posted
    await page.evaluate(() => history.replaceState(null, '', `${location.pathname}${location.search}&turnstile=fail`));
    await openPanel();
    await attempt('challenge', 'Doğrulama başarısız oldu', true);
    expect(posts).toBe(6);
    await page.screenshot({ path: join(SHOTS, '12-05-error-challenge.png') });
    // Escape closes the popover and removes the widget
    await page.locator('[data-action="save"]').click();
    await expect.poll(() => widgetFrames(page), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect.poll(() => widgetFrames(page)).toBe(0);
    expect(await page.locator('.sl-replay-turnstile').evaluate((e) => e.childElementCount)).toBe(0);
    expect(unexpected(errors)).toEqual([]);
  });

  test('opening #rid= links that cannot play: unknown, malformed, offline', async ({ page }) => {
    const errors = captureConsole(page);
    await open(page, VIEWER);
    const note = page.locator('.sl-replay-note');
    await page.evaluate(() => (location.hash = '#rid=ZZZZZZZZZZZZ'));
    await expect(note).toContainText('süresi dolmuş veya hiç kaydedilmemiş');
    expect(await mode(page)).toBe('auto');
    await page.screenshot({ path: join(SHOTS, '12-05-open-missing.png') });
    await page.evaluate(() => (location.hash = '#rid=short'));
    await expect(note).toContainText('eksik');
    await page.route('**/api/replays/*', (route) => route.abort('internetdisconnected'));
    await page.evaluate(() => (location.hash = '#rid=ABCDEFGH2345'));
    await expect(note).toContainText('laboratuvara ulaşılamadı');
    expect(await mode(page)).toBe('auto');
    expect(unexpected(errors)).toEqual([]);
  });
});
