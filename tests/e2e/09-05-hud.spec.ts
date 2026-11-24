/**
 * 09-05 handling HUD (ARCHITECTURE-M2 §10.2, §10.5, §13): the Assists popover writes store.driveAids, aid lamps and the
 * Approximate badge follow frame.drive. Needs the Manual Drive plant; without it the tests are skipped, never faked.
 * ABS lamp on a hard stop needs 09-04's aid wiring (plant sets absActive).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/09-05-shots';
mkdirSync(SHOTS, { recursive: true });
const BOOT = '/?e2e=1&quality=low&paused=1&t=40';

const drive = (page: Page) => page.evaluate(() => globalThis.__app!.drive());
const advance = (page: Page, s: number) => page.evaluate((x) => globalThis.__app!.advance(x), s);
const mode = (page: Page) => page.evaluate(() => globalThis.__app!.state().driveMode);
const intent = (page: Page, i: Record<string, number> | null) => page.evaluate((x) => globalThis.__app!.driveIntent(x), i);
const lamp = (page: Page, id: string) => page.locator(`.sl-drive-lamp[data-lamp="${id}"]`);

/** Takes the wheel with ↑ and keeps it held: the idle hand-back counts device input, and the scripted intent wins anyway. */
async function takeOver(page: Page) {
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => mode(page)).toBe('manual');
  await expect(page.locator('.sl-drive-pill')).toHaveAttribute('data-mode', 'manual');
}

/** Steps the plant in small slices until `done` (the lamps update on rendered frames, so give each slice a frame). */
async function stepUntil(page: Page, done: () => Promise<boolean>, slices: number, s = 0.1) {
  for (let i = 0; i < slices; i++) {
    if (await done()) return true;
    await advance(page, s);
    await page.waitForTimeout(50);
  }
  return done();
}

test.describe('09-05 handling HUD', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(300_000);

  test('assists popover writes store.driveAids; traction lamp on a launch; approximate badge in a slide', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, BOOT);
    test.skip(!(await drive(page)).available, 'Manual Drive plant not in this build');

    // Auto stays clean: no Assists button, no lamps
    await expect(page.locator('.sl-drive-aids-btn')).toBeHidden();
    await takeOver(page);

    // the popover: four named switches and the honesty line
    const btn = page.locator('.sl-drive-aids-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAccessibleName('Sürüş destekleri: tümü açık. Destek: basitleştirilmiş model');
    await btn.click();
    const panel = page.locator('#sl-drive-aids-panel');
    await expect(panel).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toContainText('Destek: basitleştirilmiş model');
    for (const name of ['Kilitlenme önleyici frenler', 'Çekiş kontrolü', 'Denge kontrolü', 'Direksiyon desteği'])
      await expect(page.getByRole('switch', { name, exact: true })).toBeChecked();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SHOTS, '09-05-aids-1280.png') });

    // ABS off by pointer: store and kernel see it, the button says so, focus leaves the switch (keys keep driving)
    await page.getByRole('switch', { name: 'Kilitlenme önleyici frenler' }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().driveAids.abs)).toBe(false);
    expect((await page.evaluate(() => globalThis.__app!.state().driveAids)).traction).toBe(true);
    await expect(btn).toHaveAccessibleName(/^Sürüş destekleri: Kilitlenme önleyici frenler kapalı/);
    await expect(page.locator('.sl-drive-aids-tag')).toHaveText('Bazıları kapalı');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');

    // keyboard: Escape closes and returns focus; Enter on the focused button opens (and does not hand back)
    await page.getByRole('switch', { name: 'Kilitlenme önleyici frenler' }).focus();
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().driveAids.abs)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(btn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    expect(await mode(page)).toBe('manual');
    await page.mouse.click(200, 200); // outside: closes
    await expect(panel).toBeHidden();

    // traction lamp: full throttle from rest with the aids on (the real plant reports tractionActive)
    await page.keyboard.press('KeyR');
    await advance(page, 0.2);
    await intent(page, { throttle: 1 });
    const tcs = await stepUntil(page, () => lamp(page, 'traction').isVisible(), 60);
    expect(tcs, 'traction lamp lit during a full-throttle launch').toBe(true);
    await expect(lamp(page, 'traction')).toContainText('Çekiş');
    await page.screenshot({ path: join(SHOTS, '09-05-lamp-1280.png') });

    // approximate badge: aids off, get going, then a handbrake turn past the validated domain
    await page.evaluate(() => globalThis.__app!.set('driveAids', { abs: false, traction: false, stability: false, steering: false }));
    await expect(page.locator('.sl-drive-aids-tag')).toHaveText('Kapalı');
    await stepUntil(page, async () => (await drive(page)).speed > 18, 60, 0.25);
    await intent(page, { throttle: 0.4, steer: 1, handbrake: 1 });
    const slid = await stepUntil(page, () => lamp(page, 'approximate').isVisible(), 40, 0.05);
    expect(slid, 'approximate badge visible during a forced slide').toBe(true);
    expect((await drive(page)).approximate || (await lamp(page, 'approximate').isVisible())).toBe(true);
    await expect(lamp(page, 'approximate')).toContainText('Yaklaşık');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, '09-05-approx-1920.png') });

    // hand back: lamps and the Assists button leave with Manual
    await intent(page, null);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).not.toBe('manual');
    await expect(page.locator('.sl-drive-lamp:visible')).toHaveCount(0);
    await expect(btn).toBeHidden();
    await expectHealthyBoot(page, errors);
  });

  test('ABS lamp on a scripted hard stop', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, BOOT);
    test.skip(!(await drive(page)).available, 'Manual Drive plant not in this build');
    await takeOver(page);
    await intent(page, { throttle: 1 });
    await stepUntil(page, async () => (await drive(page)).speed > 25, 80, 0.25);
    await intent(page, { brake: 1 });
    expect(await stepUntil(page, () => lamp(page, 'abs').isVisible(), 40, 0.05)).toBe(true);
    await expect(lamp(page, 'abs')).toContainText('ABS');
    await intent(page, null);
    await page.keyboard.up('ArrowUp');
    await expectHealthyBoot(page, errors);
  });
});
