/**
 * 08-03 take the wheel (ARCHITECTURE-M2 §10.1-10.2): keyboard takeover, driving, reverse, reset, hand-back, the pill.
 * The driving part needs the Manual Drive plant (08-02); without it the test is skipped, never faked.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/08-03-shots';
mkdirSync(SHOTS, { recursive: true });
const BOOT = '/?e2e=1&quality=low&paused=1&t=40';

const drive = (page: Page) => page.evaluate(() => globalThis.__app!.drive());
const advance = (page: Page, s: number) => page.evaluate((x) => globalThis.__app!.advance(x), s);
const mode = (page: Page) => page.evaluate(() => globalThis.__app!.state().driveMode);
/** Yaw change in (-pi, pi]. */
const dYaw = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

test.describe('08-03 take the wheel', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  // SwiftShader renders a few frames per second and the plant runs 240 Hz in the page: generous timeouts.
  test.setTimeout(240_000);

  test('the pill in Auto and the motorcycle says Auto only', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, BOOT);
    const pill = page.locator('.sl-drive-pill');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('data-mode', 'auto');
    const toggle = page.locator('.sl-drive-toggle');
    await expect(toggle).toHaveAccessibleName(/^Sürüş modu: Otomatik/);
    // the takeover prompt appears after 4 s of Auto (only when this vehicle can be driven)
    if (await page.evaluate(() => globalThis.__app!.drive().available)) {
      await expect(page.locator('.sl-drive-hint')).toHaveAttribute('data-kind', 'prompt', { timeout: 60_000 });
      await page.waitForTimeout(600);
    }
    await page.screenshot({ path: join(SHOTS, '08-03-auto-pill.png') });

    // the bike: Auto only, said plainly; W does not take over and logs nothing
    await page.goto(`${BOOT}&vehicle=cafe-racer`);
    await page.waitForFunction(() => globalThis.__app?.ready === true);
    await expect(pill).toContainText('Bu araçta yalnızca otomatik sürüş var');
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('Enter');
    await advance(page, 0.2);
    expect(await mode(page)).toBe('auto');
    await page.locator('.sl-drive').screenshot({ path: join(SHOTS, '08-03-moto-pill.png') });
    // A and S keep their M1 meanings in Auto
    await page.keyboard.press('KeyS');
    expect(await page.evaluate(() => globalThis.__app!.state().timeScale)).toBe(0.25);
    await expectHealthyBoot(page, errors);
  });

  test('keyboard: take over, accelerate, steer, reverse, reset, hand back', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, BOOT);
    test.skip(!(await drive(page)).available, 'Manual Drive plant (08-02) not in this build');

    // A held S (slow motion) is not a takeover; ↑ is, on the press
    await page.keyboard.press('KeyS');
    expect(await mode(page)).toBe('auto');
    await page.keyboard.press('KeyS');
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => mode(page)).toBe('manual');
    await expect(page.locator('.sl-drive-pill')).toHaveAttribute('data-mode', 'manual');
    await expect(page.locator('.sl-drive-hint')).toHaveAttribute('data-kind', 'controls');
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS, '08-03-manual-hint.png') });

    await advance(page, 3);
    expect((await drive(page)).speed).toBeGreaterThan(8);
    await expect(page.locator('.sl-drive-speed')).not.toHaveText('');

    const y0 = (await drive(page)).yaw;
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(100);
    await advance(page, 1);
    expect(dYaw(y0, (await drive(page)).yaw)).toBeGreaterThan(0);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowUp');

    // stop, then keep holding ↓ at standstill: reverse
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(100);
    for (let i = 0; i < 12 && (await drive(page)).speed > 0.3; i++) await advance(page, 1.5);
    await advance(page, 2);
    expect((await drive(page)).u).toBeLessThan(0);
    await page.keyboard.up('ArrowDown');

    // R: at rest on the road
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(100);
    await advance(page, 0.1);
    const reset = await drive(page);
    expect(reset.speed).toBeLessThan(0.5);
    expect(reset.zone).toBe('loop');

    // Enter hands back (10-04: on the loop that is Returning, the autopilot brings the car back); a still-held ↑
    // cannot retake it until released
    await page.keyboard.down('ArrowUp');
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).not.toBe('manual');
    await page.waitForTimeout(200);
    expect(await mode(page)).not.toBe('manual');
    await page.keyboard.up('ArrowUp');
    await expect(page.locator('.sl-drive-pill')).toHaveAttribute('data-mode', 'auto');
    await expectHealthyBoot(page, errors);
  });
});
