import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { captureConsole } from './helpers';

// Delivery hardening (07-02): the enforced CSP (public/_headers, served by the workerd assets engine in
// `vite preview` and in production) raises no violation on any page/view, and the presenter's host key never
// appears in a WebSocket URL. Runs against the real Room DO (?debug=1, not e2e=1, which keeps the room offline).

interface Watch {
  readonly page: Page;
  readonly errors: string[];
  readonly sockets: string[];
  violations(): Promise<string[]>;
}

async function open(context: BrowserContext, path: string): Promise<Watch> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const list: string[] = [];
    (globalThis as unknown as { __csp: string[] }).__csp = list;
    document.addEventListener('securitypolicyviolation', (e) => list.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`));
  });
  const errors = captureConsole(page);
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  await page.goto(path);
  return { page, errors, sockets, violations: () => page.evaluate(() => (globalThis as unknown as { __csp: string[] }).__csp) };
}

const ready = (page: Page) => page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 150_000 }); // SwiftShader under shared CPU load

test('enforced CSP: zero violations in follow, close-up, explore, x-ray, motorcycle and the engineer', async ({ browser }) => {
  test.setTimeout(360_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const app = await open(context, '/?quality=low&debug=1');
  await ready(app.page);
  const csp = await (await context.request.get('/')).headers()['content-security-policy'];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");

  const step = async (fn: () => Promise<void>) => {
    await fn();
    await app.page.evaluate(() => globalThis.__app!.advance(1));
    await app.page.waitForTimeout(500);
  };
  await step(async () => app.page.evaluate(() => globalThis.__app!.set('view', 'closeup')));
  await step(async () => app.page.evaluate(() => globalThis.__app!.set('xray', true)));
  await step(async () => app.page.evaluate(() => globalThis.__app!.set('view', 'explore')));
  await step(async () => app.page.evaluate(() => globalThis.__app!.set('view', 'follow')));
  await step(async () => app.page.evaluate(() => globalThis.__app!.set('vehicleId', 'cafe-racer')));
  await expect.poll(() => app.page.evaluate(() => globalThis.__app!.state().vehicleId)).toBe('cafe-racer');
  await step(async () => app.page.evaluate(() => globalThis.__app!.set('view', 'closeup')));
  await step(async () => app.page.evaluate(() => globalThis.__app!.set('vehicleId', 'gt-coupe')));
  await step(async () => app.page.keyboard.press('m')); // audio toggle (07-03), if present
  // Engineer: a real POST to the local worker (no AI binding locally -> labelled rule answer).
  await app.page.getByRole('button', { name: 'Mühendise sor' }).click();
  await app.page.locator('.sl-engineer-input').fill('What is a roll centre?');
  await app.page.locator('.sl-engineer-input').press('Enter');
  await expect(app.page.locator('.sl-engineer-text')).not.toBeEmpty({ timeout: 20_000 });
  await expect.poll(() => app.page.evaluate(() => globalThis.__app!.state().room.connected), { timeout: 20_000 }).toBe(true);

  expect(await app.violations()).toEqual([]);
  expect(app.errors).toEqual([]);
  expect(app.sockets.length).toBeGreaterThan(0);
  // The detector itself works: an inline style attribute is refused and reported.
  await app.page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<i style="color:red"></i>'));
  await expect.poll(() => app.violations()).toEqual([expect.stringMatching(/^style-src-attr /)]);
  await context.close();
});

test('remote pages: CSP clean; the host key never travels in a WebSocket URL; screen sees the host connect', async ({ browser }) => {
  test.setTimeout(360_000);
  const big = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const screen = await open(big, '/?screen=1&quality=low&debug=1');
  await ready(screen.page);
  const card = screen.page.locator('.sl-presenter');
  await expect(card).toHaveAttribute('data-mode', 'host', { timeout: 20_000 });
  const { code, hostKey } = await screen.page.evaluate(() => JSON.parse(sessionStorage.getItem('sl-live-lab-screen-room')!) as { code: string; hostKey: string });

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const host = await open(phone, `/remote.html?room=${code}#k=${hostKey}`);
  await expect(host.page.locator('.rm-header')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
  await expect(host.page.locator('.rm-role')).toHaveText('Sunucu');
  // "Host connected" (presence.hosts) flips the screen to the audience QR before any command is sent.
  await expect(card).toHaveAttribute('data-mode', 'audience', { timeout: 10_000 });

  const audience = await open(await browser.newContext({ viewport: { width: 360, height: 640 } }), `/r/${code}`);
  await expect(audience.page.locator('.rm-role')).toHaveText('İzleyici', { timeout: 20_000 });

  for (const w of [screen, host, audience]) {
    expect(w.sockets.length).toBeGreaterThan(0);
    for (const url of w.sockets) {
      expect(url).not.toContain(hostKey);
      expect(new URL(url).searchParams.has('k')).toBe(false);
    }
    expect(await w.violations()).toEqual([]);
    expect(w.errors).toEqual([]);
  }
  expect(host.page.url()).not.toContain(hostKey);
});
