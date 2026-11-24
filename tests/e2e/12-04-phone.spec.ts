import { expect, test, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { captureConsole } from './helpers';

// Big screen + phone driver against the real Room DO (workerd via a private `vite preview`). The screen runs
// ?screen=1&debug=1 (not e2e=1, which keeps the room offline) to expose window.__app. Touch is emulated (CDP);
// tilt is driven with synthetic DeviceMotionEvents only: it was not tried on a real phone here.
const SHOTS = process.env['SHOTS_DIR'];
const LANDSCAPE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const SMALL = { viewport: { width: 667, height: 375 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

const opened: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.close().catch(() => undefined)));
});
const context = async (browser: Browser, options: Parameters<Browser['newContext']>[0]) => {
  const c = await browser.newContext(options);
  opened.push(c);
  return c;
};

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/12-04-${name}.png` });
};

async function phone(browser: Browser, path: string, size = LANDSCAPE) {
  const page = await (await context(browser, size)).newPage();
  const errors = captureConsole(page);
  const scripts: { url: string; body: string }[] = [];
  page.on('response', async (r) => {
    if (r.request().resourceType() === 'script') scripts.push({ url: r.url(), body: await r.text().catch(() => '') });
  });
  // wall-clock stamp of every input event on the phone (same machine as the screen: comparable with its Date.now())
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __inputs: { t: number; type: string; x: number }[] };
    w.__inputs = [];
    for (const type of ['pointerdown', 'pointermove'])
      addEventListener(type, (e) => w.__inputs.push({ t: Date.now(), type, x: (e as PointerEvent).clientX }), { capture: true });
  });
  await page.goto(path);
  return { page, errors, scripts };
}

const pt = (x: number, y: number, id: number) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
const centreOf = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
};
const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: ReturnType<typeof pt>[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

/** The big screen, with every relayed `in` frame logged (wall clock) as it reaches the page's JS. */
async function openScreen(browser: Browser, size: { width: number; height: number }, extra = '') {
  const screen = await (await context(browser, { viewport: size, deviceScaleFactor: 1 })).newPage();
  const errors = captureConsole(screen);
  await screen.addInitScript(() => {
    const w = globalThis as unknown as { __inLog: { t: number; s: number; n: number }[] };
    w.__inLog = [];
    const Native = WebSocket;
    class Logged extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (e) => {
          if (typeof e.data === 'string' && e.data.startsWith('{"t":"in"')) {
            const m = JSON.parse(e.data) as { s: number; n: number };
            w.__inLog.push({ t: Date.now(), s: m.s, n: m.n });
          }
        });
      }
    }
    globalThis.WebSocket = Logged;
  });
  await screen.goto(`/?screen=1&quality=low&debug=1${extra}`);
  await screen.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
  const card = screen.locator('.sl-phone-drive');
  await expect(card).toBeVisible({ timeout: 30_000 });
  const room = await screen.evaluate(() => JSON.parse(sessionStorage.getItem('sl-live-lab-screen-room')!) as { code: string; driverKey: string; hostKey: string });
  return {
    screen,
    errors,
    card,
    room,
    drive: () => screen.evaluate(() => globalThis.__app!.drive()),
    mode: async () => (await screen.evaluate(() => globalThis.__app!.state())).driveMode,
  };
}

test('a phone drives the big screen through the room, fails safe, and recovers calmly', async ({ browser }) => {
  test.setTimeout(300_000);
  const { screen, errors: screenErrors, card, room, drive, mode } = await openScreen(browser, { width: 1440, height: 900 });

  // The card: QR with the driver key only in the fragment
  await expect(card).toHaveAttribute('data-state', 'waiting');
  await expect(card.locator('.sl-qr path')).toHaveAttribute('d', /^M/);
  expect(room.driverKey).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  expect(room.driverKey).not.toBe(room.hostKey);
  await shot(screen, 'screen-card');

  // Phone: /remote.html?room=CODE#d=KEY -> driver; the key moves to sessionStorage and leaves the address bar
  const p1 = await phone(browser, `/remote.html?room=${room.code}#d=${room.driverKey}`);
  await expect(p1.page.locator('.rm-header')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
  await expect(p1.page.locator('.rm-role')).toHaveText('Sürücü');
  expect(p1.page.url()).not.toContain('#');
  expect(await p1.page.evaluate((c) => sessionStorage.getItem(`sl-remote-driver:${c}`), room.code)).toBe(room.driverKey);
  await expect(card).toHaveAttribute('data-state', 'paired', { timeout: 10_000 });
  await expect(p1.page.locator('.rm-badge')).toHaveAttribute('data-level', /ok|amber/, { timeout: 10_000 });

  // landscape layout: thumb-sized targets, nothing scrolls, the controls fit the viewport
  for (const size of [LANDSCAPE.viewport, SMALL.viewport]) {
    await p1.page.setViewportSize(size);
    for (const sel of ['.rm-drive-pedal[data-pedal="gas"]', '.rm-drive-pedal[data-pedal="brake"]', '.rm-drive-steer', '.rm-drive-btn >> nth=0']) {
      const b = (await p1.page.locator(sel).boundingBox())!;
      expect(Math.min(b.width, b.height), `${sel} at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(48);
      expect(b.y + b.height).toBeLessThanOrEqual(size.height + 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width + 0.5);
    }
    expect(await p1.page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight])).toEqual([0, 0]);
    if (size.width === 667) await shot(p1.page, 'phone-667');
  }
  await p1.page.setViewportSize(LANDSCAPE.viewport);

  // GAS takes the wheel on the screen through the drive arbitration ('phone' source)
  const cdp = await p1.page.context().newCDPSession(p1.page);
  const gas = await centreOf(p1.page, '.rm-drive-pedal[data-pedal="gas"]');
  const steer = await centreOf(p1.page, '.rm-drive-steer');
  const g = pt(gas.x, gas.y, 1);
  await touch(cdp, 'touchStart', [g]);
  await expect.poll(mode, { timeout: 10_000 }).toBe('manual').catch(async (e) => {
    console.log('DIAG', await screen.evaluate(() => { const l = (globalThis as unknown as { __inLog: { t: number; s: number; n: number }[] }).__inLog; return JSON.stringify({ n: l.length, last: l.slice(-3), now: Date.now(), state: document.querySelector('.sl-phone-drive')?.getAttribute('data-state'), link: document.querySelector('.sl-phone-drive')?.getAttribute('data-link') }); }));
    console.log('DIAG phone', await p1.page.evaluate(() => JSON.stringify({ st: document.body.dataset['status'], badge: document.querySelector('.rm-badge')?.textContent, vis: document.visibilityState })));
    throw e;
  });
  await expect(card).toHaveAttribute('data-state', 'driving', { timeout: 10_000 });
  await expect(card.locator('.sl-phone-drive-status-text')).toHaveText('Telefondan kontrol ediliyor');
  await expect.poll(async () => (await drive()).speed, { timeout: 20_000 }).toBeGreaterThan(2);
  await expect(p1.page.locator('.rm-drive-mode')).toHaveText('Kontrol sizde', { timeout: 10_000 });
  await expect.poll(async () => Number(await p1.page.locator('.rm-drive-speed').textContent()), { timeout: 10_000 }).toBeGreaterThan(3);

  // Drag right = steer right (+ = left in the sim)
  const s0 = pt(steer.x, steer.y, 2);
  await touch(cdp, 'touchStart', [g, s0]);
  await touch(cdp, 'touchMove', [g, { ...s0, x: s0.x + steer.w * 0.4 }]);
  await expect.poll(async () => (await drive()).steer, { timeout: 10_000 }).toBeLessThan(-0.05);
  await expect(p1.page.locator('.rm-drive-steer')).toHaveClass(/is-held/);
  await shot(p1.page, 'phone-driving');
  await shot(screen, 'screen-driving');
  await touch(cdp, 'touchEnd', []);

  // Tilt (synthetic gravity vectors in a landscape hold; not a real phone): Centre, turn right + Done, then steer right
  const motion = (deg: number) =>
    p1.page.evaluate((d) => {
      const w = globalThis as unknown as { __tilt?: number; __tiltTimer?: number };
      w.__tilt = d;
      w.__tiltTimer ??= window.setInterval(() => {
        const a = ((w.__tilt ?? 0) * Math.PI) / 180;
        // landscape hold: gravity along device -x at rest; rolling the device by a turns gravity in the x-y plane
        const ev = new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: -9.81 * Math.cos(a), y: 9.81 * Math.sin(a), z: 0 }, interval: 16 });
        dispatchEvent(ev);
      }, 16);
    }, deg);
  await motion(0);
  // this Chromium has DeviceMotionEvent.requestPermission (the iOS-style path): grant the sensors, then tap
  await p1.page.context().grantPermissions(['accelerometer', 'gyroscope']);
  await p1.page.getByRole('button', { name: 'Eğerek yön ver' }).click();
  await expect(p1.page.locator('.rm-drive-sheet-title')).toHaveText('Direksiyon gibi tutun');
  await p1.page.getByRole('button', { name: 'Ortala', exact: true }).click();
  await expect(p1.page.locator('.rm-drive-sheet-title')).toHaveText('Şimdi biraz sağa çevirin');
  await motion(20);
  await p1.page.waitForTimeout(150);
  await p1.page.getByRole('button', { name: 'Tamam', exact: true }).click();
  await expect(p1.page.locator('.rm-drive-sheet')).toBeHidden();
  await expect(p1.page.locator('.rm-drive')).toHaveAttribute('data-steering', 'tilt');
  await motion(0);
  await p1.page.waitForTimeout(400);
  const gas2 = await centreOf(p1.page, '.rm-drive-pedal[data-pedal="gas"]');
  await touch(cdp, 'touchStart', [pt(gas2.x, gas2.y, 3)]);
  // the frames the screen receives carry the tilt (s + = LEFT on the wire); the car's conditioned demand follows
  const lastS = () => screen.evaluate(() => (globalThis as unknown as { __inLog: { s: number }[] }).__inLog.at(-1)?.s ?? 0);
  await motion(25);
  await expect.poll(lastS, { timeout: 10_000 }).toBeLessThan(-300); // tilted right = steer right
  await expect.poll(async () => (await drive()).steer, { timeout: 10_000 }).toBeLessThan(-0.05);
  await shot(p1.page, 'phone-tilt');
  await motion(-25);
  await expect.poll(lastS, { timeout: 10_000 }).toBeGreaterThan(300);
  await touch(cdp, 'touchEnd', []);
  await p1.page.getByRole('button', { name: 'Sürgüyü kullan' }).click();
  await expect(p1.page.locator('.rm-drive')).toHaveAttribute('data-steering', 'touch');

  // A second phone takes the wheel (newest wins); the first gets a calm "replaced" sheet and does not reconnect
  const p2 = await phone(browser, `/remote.html?room=${room.code}#d=${room.driverKey}`);
  await expect(p2.page.locator('.rm-header')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
  await expect(p1.page.locator('.rm-drive-sheet-title')).toHaveText('Başka bir telefon kontrolü devraldı', { timeout: 10_000 });
  await expect(p1.page.locator('.rm-header')).toHaveAttribute('data-status', 'replaced');
  await shot(p1.page, 'phone-replaced');
  await p1.page.waitForTimeout(2000);
  await expect(p1.page.locator('.rm-header')).toHaveAttribute('data-status', 'replaced'); // final: no ping-pong
  // the second phone drives straight away (its sequence numbers start elsewhere: the screen takes it as a new stream)
  const cdp2 = await p2.page.context().newCDPSession(p2.page);
  const gasB = await centreOf(p2.page, '.rm-drive-pedal[data-pedal="gas"]');
  const steerB = await centreOf(p2.page, '.rm-drive-steer');
  await touch(cdp2, 'touchStart', [pt(gasB.x, gasB.y, 1), pt(steerB.x, steerB.y, 2)]);
  await touch(cdp2, 'touchMove', [pt(gasB.x, gasB.y, 1), pt(steerB.x - steerB.w * 0.4, steerB.y, 2)]);
  await expect.poll(async () => (await drive()).steer, { timeout: 15_000 }).toBeGreaterThan(0.05).catch(async (e) => {
    console.log('DIAG2', await mode(), await screen.evaluate(() => JSON.stringify({ last: (globalThis as unknown as { __inLog: unknown[] }).__inLog.slice(-2), toast: !document.querySelector('.sl-phone-drive-toast')?.hasAttribute('hidden'), state: document.querySelector('.sl-phone-drive')?.getAttribute('data-state') })));
    throw e;
  }); // dragged left
  await expect.poll(mode).toBe('manual');

  // Closing the driving phone: failsafe -> Returning with a note on the screen (timed in the next test)
  await p2.page.close();
  await expect.poll(mode, { timeout: 10_000 }).not.toBe('manual');
  await expect(screen.locator('.sl-phone-drive-toast')).toBeVisible();
  await expect(screen.locator('.sl-phone-drive-toast')).toContainText('Telefon kumandasıyla bağlantı kesildi');
  await shot(screen, 'screen-failsafe');

  // Wrong key and an unknown room: calm sheets, no reconnect loop
  const bad = await phone(browser, `/remote.html?room=${room.code}#d=${'x'.repeat(32)}`);
  await expect(bad.page.locator('.rm-drive-sheet-title')).toHaveText('Bu sürüş kodunun süresi doldu', { timeout: 20_000 });
  await bad.page.waitForTimeout(400); // the dimmed panel fades back behind the sheet
  await shot(bad.page, 'phone-denied');
  await bad.page.getByRole('button', { name: 'İzleyici olarak katıl' }).click();
  await expect(bad.page.locator('.rm-role')).toHaveText('İzleyici', { timeout: 20_000 });
  const gone = await phone(browser, `/remote.html?room=ZZZZZ#d=${room.driverKey}`);
  await expect(gone.page.locator('.rm-drive-sheet-title')).toHaveText('ZZZZZ odası kapandı', { timeout: 20_000 });

  // The phone page stays small and three.js-free
  const total = p1.scripts.reduce((sum, s) => sum + s.body.length, 0);
  console.log(`12-04 phone scripts: ${p1.scripts.length} files, ${(total / 1024).toFixed(1)} kB (uncompressed)`);
  for (const s of p1.scripts) {
    expect(s.body, s.url).not.toMatch(/WebGLRenderer|three\.module|THREE\./);
    expect(s.url).not.toMatch(/three/);
  }
  expect(total).toBeLessThan(80 * 1024);

  expect(screenErrors).toEqual([]);
  for (const p of [p1, bad, gone]) expect(p.errors.filter((e) => !/WebSocket|40[14]/.test(e))).toEqual([]);
});

// The same path without the render loop: under SwiftShader the rendered screen's main thread stalls for up to a second
// (frames then reach its JS in bursts), which would time the software renderer, not the link. Room, relay, live-lab,
// drive arbitration, conditioning and the simulation are unchanged.
test('input latency and the 1 s failsafe, measured on a screen without the render loop', async ({ browser }) => {
  test.setTimeout(240_000);
  const { screen, errors, room, mode } = await openScreen(browser, { width: 960, height: 540 }, '&features=-renderer');
  const p = await phone(browser, `/remote.html?room=${room.code}#d=${room.driverKey}`);
  await expect(p.page.locator('.rm-header')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
  // first sim frame (wall clock) whose conditioned steer demand crosses a threshold
  await screen.evaluate(() => {
    const w = globalThis as unknown as { __steerAt: (sign: number, after: number) => Promise<number> };
    w.__steerAt = (sign, after) =>
      new Promise((resolve) => {
        const check = () => {
          const s = globalThis.__app!.drive().steer;
          if (Date.now() >= after && (sign < 0 ? s < -0.05 : s > -0.02)) resolve(Date.now());
          else requestAnimationFrame(check);
        };
        check();
      });
  });
  const cdp = await p.page.context().newCDPSession(p.page);
  const gas = await centreOf(p.page, '.rm-drive-pedal[data-pedal="gas"]');
  const steer = await centreOf(p.page, '.rm-drive-steer');
  const g = pt(gas.x, gas.y, 1);
  const s0 = pt(steer.x, steer.y, 2);
  await touch(cdp, 'touchStart', [g]);
  await expect.poll(mode, { timeout: 10_000 }).toBe('manual');
  await p.page.waitForTimeout(1000);
  await touch(cdp, 'touchStart', [g, s0]);

  const net: number[] = [];
  const e2e: number[] = [];
  for (let i = 0; i < 20; i++) {
    const right = i % 2 === 0;
    const before = await screen.evaluate(() => (globalThis as unknown as { __inLog: unknown[] }).__inLog.length);
    const t0 = Date.now();
    const sim = screen.evaluate(({ sign, after }) => (globalThis as unknown as { __steerAt: (s: number, a: number) => Promise<number> }).__steerAt(sign, after), { sign: right ? -1 : 1, after: t0 });
    await touch(cdp, 'touchMove', [g, { ...s0, x: right ? s0.x + steer.w * 0.4 : s0.x + 1 }]);
    const tIn = await screen.evaluate(
      ({ before, right }) =>
        new Promise<number>((resolve) => {
          const log = (globalThis as unknown as { __inLog: { t: number; s: number }[] }).__inLog;
          const check = () => {
            const hit = log.slice(before).find((f) => (right ? f.s < -300 : f.s === 0));
            if (hit) resolve(hit.t);
            else setTimeout(check, 1);
          };
          check();
        }),
      { before, right },
    );
    const tEvent = await p.page.evaluate(() => (globalThis as unknown as { __inputs: { t: number }[] }).__inputs.at(-1)!.t);
    net.push(tIn - tEvent);
    e2e.push((await sim) - tEvent);
    await p.page.waitForTimeout(250 + 37 * (i % 3)); // de-phase from the 30 Hz tick
  }
  const fmt = (xs: number[]) => `min ${Math.min(...xs)} p50 ${pct(xs, 0.5)} p90 ${pct(xs, 0.9)} max ${Math.max(...xs)}`;
  console.log(`12-04 latency, phone input event -> in frame at the screen's JS (ms, n=${net.length}): ${fmt(net)}`);
  console.log(`12-04 latency, phone input event -> screen sim steer demand (ms, n=${e2e.length}): ${fmt(e2e)}`);
  expect(pct(net, 0.5)).toBeLessThan(100);
  expect(pct(e2e, 0.5)).toBeLessThan(150);

  // Closing the phone page: Returning (not Manual) within 1.5 s
  const tClose = Date.now();
  await p.page.close();
  await expect.poll(mode, { timeout: 3_000, intervals: [20] }).not.toBe('manual');
  const tReturn = Date.now() - tClose;
  console.log(`12-04 phone closed -> screen ${await mode()} after ${tReturn} ms`);
  expect(tReturn).toBeLessThan(1500);
  await expect(screen.locator('.sl-phone-drive-toast')).toBeVisible();
  expect(errors).toEqual([]);

  // Not a big screen (no room of its own, no driver key): the feature is on but shows and sends nothing
  const viewer = await (await context(browser, { viewport: { width: 960, height: 540 } })).newPage();
  await viewer.goto('/?quality=low&debug=1&features=-renderer');
  await viewer.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
  expect((await viewer.evaluate(() => globalThis.__app!.features())).find((f) => f.id === 'phone-drive')).toMatchObject({ enabled: true });
  await viewer.waitForTimeout(1500);
  expect(await viewer.locator('.sl-phone-drive, .sl-phone-drive-toast').count()).toBe(0);
});
