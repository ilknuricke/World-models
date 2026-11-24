/**
 * 11-02 coach (ARCHITECTURE-M2 §10.5): a provoked slide on the dynamics pad and a kerb strike on the loop's bump strip
 * each produce one coach line after the moment, in the insights caption's place, announced once (politely, no
 * numbers); insights stay quiet while driving. Screenshots go to SHOTS_DIR.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/11-02-shots';
mkdirSync(SHOTS, { recursive: true });

const intent = (page: Page, i: Record<string, number> | null) => page.evaluate((x) => globalThis.__app!.driveIntent(x), i);
const mode = (page: Page) => page.evaluate(() => globalThis.__app!.state().driveMode);

/** The test intent is not a device source: keep the idle hand-back away like a visitor touching the screen. */
async function keepAlive(page: Page): Promise<void> {
  await page.addInitScript(() => {
    setInterval(() => window.dispatchEvent(new Event('pointerdown')), 1000);
  });
}

async function expectCoach(page: Page, text: RegExp): Promise<void> {
  const caption = page.locator('.sl-coach-caption');
  await expect(caption).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.sl-coach-text')).toHaveText(text);
  const announced = await page.locator('.sl-coach-announce').textContent();
  expect(announced).toBe(await page.locator('.sl-coach-text').textContent());
  expect(announced).not.toMatch(/\d/);
  await expect(page.locator('.sl-coach-announce')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('.sl-insights-caption')).toBeHidden();
}

test.describe('11-02 coach', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(400_000);

  test('provoked slide on the dynamics pad: one line after the moment', async ({ page }) => {
    const errors = captureConsole(page);
    await keepAlive(page);
    await waitForReady(page, '/?e2e=1&quality=low&drive=manual&spawn=steering-pad');
    test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');
    await expect.poll(() => mode(page), { timeout: 60_000 }).toBe('manual');
    await expect.poll(() => page.evaluate(() => globalThis.__app!.drive().zone), { timeout: 60_000 }).toBe('dynamics-pad');

    // a calm launch with the assists on, then assists off and full lock with the throttle released
    await intent(page, { throttle: 0.5 });
    await page.waitForFunction(() => globalThis.__app!.drive().u > 18, undefined, { timeout: 300_000, polling: 100 });
    await page.evaluate(() => globalThis.__app!.set('driveAids', { abs: false, traction: false, stability: false, steering: false }));
    await intent(page, { steer: 1, throttle: 0 });
    await expectCoach(page, /tutuş/);
    const line = await page.locator('.sl-coach-text').textContent();
    console.log(`[11-02] slide line: "${line}" · chip "${await page.locator('.sl-coach-chip').textContent()}"`);
    await page.screenshot({ path: join(SHOTS, '11-02-slide.png') });
    expect(await mode(page)).toBe('manual');
    await intent(page, null);
    await expectHealthyBoot(page, errors);
  });

  test('kerb strike on the bump strip: the kerb line', async ({ page }) => {
    const errors = captureConsole(page);
    await keepAlive(page);
    // Auto, paused just before the bump strip's kerb clip (the line moves right onto the kerb)
    await waitForReady(page, '/?e2e=1&quality=low&paused=1&t=17.1');
    test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');
    await page.keyboard.press('ArrowUp'); // take the wheel (unpauses)
    await intent(page, { throttle: 0.35 });
    await expect.poll(() => mode(page), { timeout: 60_000 }).toBe('manual');
    await expectCoach(page, /bordür/);
    console.log(`[11-02] kerb line: "${await page.locator('.sl-coach-text').textContent()}" · chip "${await page.locator('.sl-coach-chip').textContent()}"`);
    await page.screenshot({ path: join(SHOTS, '11-02-kerb.png') });
    await intent(page, null);
    await expectHealthyBoot(page, errors);
  });
});
