/**
 * 10-04 Drive UX v2 (ARCHITECTURE-M2 §10.2-10.4): hand-back = Returning with its chip and the latch back to Auto (no
 * fade), Rejoin now (faded cut), takeover while returning; stations popover and ?spawn; annex hand-back (faded release);
 * a mocked standard gamepad (no real pad was available: navigator.getGamepads is replaced in the page) steers with the
 * right sign and takes over / hands back; touch controls on a landscape phone and a tablet (emulated coarse pointer,
 * CDP touch events); reduced motion turns the fade into a plain cut.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/10-04-shots';
mkdirSync(SHOTS, { recursive: true });
const BOOT = '/?e2e=1&quality=low&paused=1&t=40';
const MANUAL = '/?e2e=1&quality=low&t=40&drive=manual';

const drive = (page: Page) => page.evaluate(() => globalThis.__app!.drive());
const advance = (page: Page, s: number) => page.evaluate((x) => globalThis.__app!.advance(x), s);
const mode = (page: Page) => page.evaluate(() => globalThis.__app!.state().driveMode);
const fadeOpacity = (page: Page) => page.evaluate(() => Number(getComputedStyle(document.querySelector('.sl-drive-fade')!).opacity));
const dYaw = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Samples the fade's opacity on every animation frame until stopped; returns the maximum seen. */
async function watchFade(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = globalThis as unknown as { __fadeMax: number; __fadeOn: boolean };
    w.__fadeMax = 0;
    w.__fadeOn = true;
    const tick = () => {
      w.__fadeMax = Math.max(w.__fadeMax, Number(getComputedStyle(document.querySelector('.sl-drive-fade')!).opacity));
      if (w.__fadeOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () =>
    page.evaluate(() => {
      const w = globalThis as unknown as { __fadeMax: number; __fadeOn: boolean };
      w.__fadeOn = false;
      return w.__fadeMax;
    });
}

test.describe('10-04 drive UX v2', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(300_000);

  test('hand-back: Returning chip, latch back to Auto without a fade; takeover while returning; Rejoin now fades', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, MANUAL);
    test.skip(!(await drive(page)).available, 'no Manual Drive plant in this build');
    await expect.poll(() => mode(page)).toBe('manual');
    await advance(page, 0.5);
    expect((await drive(page)).zone).toBe('loop');

    // Enter on the loop: Returning (not an immediate release)
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).toBe('returning');
    const pill = page.locator('.sl-drive-pill');
    await expect(pill).toHaveClass(/is-returning/);
    await expect(page.locator('.sl-drive-rejoin')).toBeVisible();
    await expect(page.locator('.sl-drive-toggle')).toHaveAccessibleName(/^Sürüş modu: Dönülüyor/);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SHOTS, '10-04-returning.png') });

    // the autopilot latches onto the lap: Auto, no fade (the latch is continuous)
    const stop = await watchFade(page);
    for (let i = 0; i < 40 && (await mode(page)) === 'returning'; i++) await advance(page, 1);
    expect(await mode(page)).toBe('auto');
    await page.waitForTimeout(300);
    expect(await stop()).toBe(0);
    await expect(pill).not.toHaveClass(/is-returning/);
    // still on the detached clock after the latch (MD-07, 13-01): the pill says so and offers Rejoin now
    expect((await drive(page)).detached).toBe(true);
    await expect(pill).toHaveClass(/is-off-lap/);
    await expect(page.locator('.sl-drive-return-text')).toHaveText('Canlı turun dışında');
    await expect(page.locator('.sl-drive-rejoin')).toBeVisible();

    // take the wheel, hand back, and take it again while returning (any driving key, no cut)
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => mode(page)).toBe('manual');
    await advance(page, 0.5);
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).toBe('returning');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => mode(page)).toBe('manual');

    // Rejoin now: a faded immediate release
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).toBe('returning');
    const stop2 = await watchFade(page);
    await page.locator('.sl-drive-rejoin').click();
    await expect.poll(() => mode(page)).toBe('auto');
    await page.waitForTimeout(800);
    expect(await stop2()).toBeGreaterThan(0.5);
    expect(await fadeOpacity(page)).toBe(0);
    // the release re-synced to the shared lap: no longer off the live lap
    await expect.poll(async () => (await drive(page)).detached).toBe(false);
    await expect(pill).not.toHaveClass(/is-off-lap/);
    await expectHealthyBoot(page, errors);
  });

  test('stations: popover in Auto spawns in Manual, ?spawn, annex hand-back is a faded release', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, BOOT);
    test.skip(!(await drive(page)).available, 'no Manual Drive plant in this build');
    const btn = page.locator('.sl-drive-stations-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAccessibleName(/Test alanında sür/);
    await btn.click();
    const panel = page.locator('#sl-drive-stations-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Test alanında sür');
    await expect(panel.locator('.sl-drive-station')).toHaveCount(5);
    await expect(panel.locator('[data-station="braking-platform"]')).toContainText('Lastik tutunması deneyi');
    expect(await panel.innerText()).not.toMatch(/\d/); // experiments, not challenges: no numbers
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, '10-04-stations.png') });
    // Escape closes it; from the keyboard: Enter opens, Escape closes and gives focus back
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    expect(await mode(page)).toBe('auto'); // Enter on the focused button is the button's, not a takeover
    await page.keyboard.press('Tab');
    await expect(panel.locator('.sl-drive-station').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(btn).toBeFocused();

    await btn.click();
    await panel.locator('[data-station="slalom"]').click();
    await expect.poll(() => mode(page)).toBe('manual');
    await expect.poll(async () => Math.hypot((await drive(page)).x + 170, (await drive(page)).y - 280), { timeout: 30_000 }).toBeLessThan(1);
    await expect(page.locator('.sl-drive-hint')).toHaveAttribute('data-kind', 'station');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, '10-04-station-note.png') });

    // annex hand-back: no autopilot across the grass, a short "Returning to the lap" and a faded release
    await advance(page, 0.2);
    expect((await drive(page)).zone).toBe('dynamics-pad');
    const stop = await watchFade(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.sl-drive-hint')).toHaveAttribute('data-kind', 'note');
    await expect(page.locator('.sl-drive-hint')).toContainText('Tura dönülüyor');
    await expect.poll(() => mode(page)).toBe('auto');
    await page.waitForTimeout(600);
    expect(await stop()).toBeGreaterThan(0.5);

    // ?spawn with ?drive=manual
    await waitForReady(page, `${MANUAL}&spawn=braking-platform`);
    await expect.poll(() => mode(page)).toBe('manual');
    await advance(page, 0.1);
    const d = await drive(page);
    expect(Math.hypot(d.x - 149.75, d.y - 110)).toBeLessThan(1);
    expect(d.zone).toBe('braking-platform');
    await expectHealthyBoot(page, errors);
  });

  test('gamepad (mocked standard pad): trigger takes over, stick right steers right, A hands back, rumble toggle offered', async ({ page }) => {
    await page.addInitScript(() => {
      const w = globalThis as unknown as { __pad: { x: number; rt: number; lt: number; a: number; on: boolean }; __rumble: number };
      w.__pad = { x: 0, rt: 0, lt: 0, a: 0, on: true };
      w.__rumble = 0;
      const actuator = {
        effects: ['dual-rumble'],
        playEffect: () => {
          w.__rumble++;
          return Promise.resolve('complete');
        },
        reset: () => Promise.resolve('complete'),
      };
      let t = 0;
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => {
          const s = w.__pad;
          if (!s.on) return [null, null, null, null];
          const buttons = Array.from({ length: 17 }, (_, i) => {
            const v = i === 7 ? s.rt : i === 6 ? s.lt : i === 0 ? s.a : 0;
            return { value: v, pressed: v > 0.5, touched: v > 0 };
          });
          return [{ id: 'Mock pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: ++t, axes: [s.x, 0, 0, 0], buttons, vibrationActuator: actuator }, null, null, null];
        },
      });
    });
    const errors = captureConsole(page);
    await waitForReady(page, BOOT);
    test.skip(!(await drive(page)).available, 'no Manual Drive plant in this build');
    const setPad = (p: Partial<{ x: number; rt: number; lt: number; a: number; on: boolean }>) =>
      page.evaluate((v) => Object.assign((globalThis as unknown as { __pad: object }).__pad, v), p);

    // hot-plug note; the prompt speaks of the pad
    await expect(page.locator('.sl-drive')).toHaveClass(/has-pad/);
    await setPad({ rt: 1 });
    await expect.poll(() => mode(page)).toBe('manual');
    await advance(page, 2);
    expect((await drive(page)).speed).toBeGreaterThan(5);
    const y0 = (await drive(page)).yaw;
    await setPad({ x: 1 });
    await page.waitForTimeout(300);
    await advance(page, 1);
    const d = await drive(page);
    expect(d.steer).toBeLessThan(0); // stick right = steer right (ISO 8855: + left)
    expect(dYaw(y0, d.yaw)).toBeLessThan(0);
    await expect(page.locator('.sl-drive-hint')).toHaveAttribute('data-kind', /pad|note/);

    // rumble switch offered (dual-rumble in effects) inside the Assists popover
    await page.locator('.sl-drive-aids-btn').click();
    await expect(page.getByRole('switch', { name: 'Oyun kumandası titreşimi' })).toBeVisible();
    await page.keyboard.press('Escape');

    // A hands back (on the loop: Returning); a trigger takes the wheel back
    await setPad({ x: 0, rt: 0 });
    await page.waitForTimeout(200);
    await setPad({ a: 1 });
    await expect.poll(() => mode(page)).not.toBe('manual');
    await setPad({ a: 0 });
    await page.waitForTimeout(200);
    await setPad({ rt: 0.6 });
    await expect.poll(() => mode(page)).toBe('manual');
    // unplug: note, keyboard still drives
    await setPad({ on: false, rt: 0 });
    await expect(page.locator('.sl-drive')).not.toHaveClass(/has-pad/);
    await expectHealthyBoot(page, errors);
  });

  test('reduced motion: Rejoin is a plain cut (no fade)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = captureConsole(page);
    await waitForReady(page, MANUAL);
    test.skip(!(await drive(page)).available, 'no Manual Drive plant in this build');
    await expect.poll(() => mode(page)).toBe('manual');
    await advance(page, 0.3);
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).toBe('returning');
    const stop = await watchFade(page);
    await page.locator('.sl-drive-rejoin').click();
    await expect.poll(() => mode(page)).toBe('auto');
    await page.waitForTimeout(500);
    expect(await stop()).toBe(0);
    await expectHealthyBoot(page, errors);
  });
});

for (const [name, viewport, isMobile] of [
  ['phone', { width: 844, height: 390 }, true],
  ['tablet', { width: 1024, height: 768 }, false],
] as const) {
  test.describe(`10-04 touch (${name})`, () => {
    test.use({ viewport, hasTouch: true, isMobile });
    test.setTimeout(300_000);

    test(`touch: slider and pedals drive, the rest of the canvas still orbits (${viewport.width}x${viewport.height})`, async ({ page }) => {
      const errors = captureConsole(page);
      await waitForReady(page, BOOT);
      test.skip(!(await drive(page)).available, 'no Manual Drive plant in this build');
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      await expect(page.locator('.sl-drive-touch')).toBeHidden();
      await page.locator('.sl-drive-toggle').tap();
      await expect.poll(() => mode(page)).toBe('manual');
      const touch = page.locator('.sl-drive-touch');
      await expect(touch).toBeVisible();
      for (const sel of ['.sl-drive-pad[data-pad="gas"]', '.sl-drive-pad[data-pad="brake"]', '.sl-drive-steer']) {
        const b = (await page.locator(sel).boundingBox())!;
        expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(48);
      }
      // the canvas centre is not covered by the touch layer (orbit keeps working there)
      expect(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 3)?.closest('.sl-drive-touch') ?? null)).toBeNull();

      const gas = (await page.locator('.sl-drive-pad[data-pad="gas"]').boundingBox())!;
      const steer = (await page.locator('.sl-drive-steer').boundingBox())!;
      const cdp = await page.context().newCDPSession(page);
      const pt = (x: number, y: number, id: number) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
      const g = pt(gas.x + gas.width / 2, gas.y + gas.height / 2, 1);
      const s0 = pt(steer.x + steer.width / 2, steer.y + steer.height / 2, 2);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [g] });
      await page.waitForTimeout(400);
      await advance(page, 2);
      expect((await drive(page)).speed).toBeGreaterThan(3);
      const y0 = (await drive(page)).yaw;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [g, s0] });
      for (let k = 1; k <= 5; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [g, { ...s0, x: s0.x - (k * steer.width) / 10 }] });
      await page.waitForTimeout(400);
      await advance(page, 1);
      const d = await drive(page);
      expect(d.steer).toBeGreaterThan(0); // dragged left = steer left
      expect(dYaw(y0, d.yaw)).toBeGreaterThan(0);
      await expect(page.locator('.sl-drive-steer')).toHaveClass(/is-held/);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, `10-04-touch-${name}.png`) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(300);
      await expect(page.locator('.sl-drive-steer')).not.toHaveClass(/is-held/);
      await expectHealthyBoot(page, errors);
    });
  });
}
