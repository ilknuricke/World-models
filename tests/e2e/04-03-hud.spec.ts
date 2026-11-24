import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSimulation } from '../../src/sim-core/index';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/04-03-shots';
mkdirSync(SHOTS, { recursive: true });

const sim = createSimulation({
  catalog: { track: () => undefined, vehicle: () => undefined, suspension: () => undefined },
  trackId: 'proving-loop',
  vehicleId: 'gt-coupe',
  suspensionId: 'macpherson',
});
const carousel = sim.track.sections.find((s) => s.def.phenomenon === 'steady-state-roll')!;
const T0 = (sim.lapTimeAt(carousel.s0) + 0.8).toFixed(3);
const BOOT = `/?e2e=1&quality=low&paused=1&t=${T0}&suspension=macpherson`;
const RAD = 180 / Math.PI;

/** Steps the paused lab one 30 Hz UI tick at a time, rendering each (the panel samples per rendered frame). */
async function run(page: Page, ticks: number): Promise<void> {
  await page.evaluate((n) => {
    for (let i = 0; i < n; i++) globalThis.__app!.advance(1 / 30);
  }, ticks);
}

const num = (s: string | null) => Number((s ?? '').replace('−', '-').replace(/[^\d.-]/g, ''));

test.describe('04-03 telemetry panel + insights', () => {
  test.setTimeout(900_000);

  test('true-value readouts, carousel insight, swap delta chip + ghost, controls (no 3D)', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, `${BOOT}&features=-renderer`);
    const panel = page.locator('.sl-telemetry-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.sl-telemetry-panel-corner')).toHaveCount(4);

    await page.evaluate(() => globalThis.__app!.set('amplification', 2.5));
    await expect(panel.locator('.sl-telemetry-panel-note')).toHaveText(/gerçek ölçek/i);
    await run(page, 90);

    // readouts are TRUE values (the pose is amplified x2.5, the numbers are not)
    const f = await page.evaluate(() => globalThis.__app!.frame());
    expect(f.sectionId).toBe(carousel.id);
    const heroes = panel.locator('.sl-telemetry-panel-hero');
    expect(Math.abs(num(await heroes.nth(1).textContent()) - Math.abs(f.roll * RAD))).toBeLessThan(0.11);
    expect(Math.abs(num(await heroes.nth(0).textContent()) - Math.abs(f.ay / 9.80665))).toBeLessThan(0.02);
    const fl = panel.locator('.sl-telemetry-panel-value').first();
    expect(Math.abs(num(await fl.textContent()) - f.corners[0]!.camber * RAD)).toBeLessThan(0.11);

    // one contextual caption in the carousel, numbers from the frame
    const caption = page.locator('.sl-insights-caption');
    await expect(caption).toBeVisible();
    await expect(page.locator('.sl-insights-text')).toHaveText(/virajın dışına yatar/);
    await expect(page.locator('.sl-insights-announce')).toHaveAttribute('aria-live', 'polite'); // 07-03: caption announced once, chip silent
    await expect(page.locator('.sl-insights-announce')).toHaveText(/virajın dışına yatar/);
    // the section chip reads the live TRUE frame (15 Hz), like the card: nowhere near the x2.5 pose
    expect(Math.abs(num(await page.locator('.sl-insights-chip').textContent()) - Math.abs(f.roll * RAD))).toBeLessThan(0.11);

    // swap: after a 1 s settle, the delta chip compares the same place on the lap; the ghost legend names the old one
    await page.evaluate(() => globalThis.__app!.set('suspensionId', 'double-wishbone'));
    await run(page, 36);
    await expect(page.locator('.sl-insights-text')).toHaveText('MacPherson dikme → Çift salıncak');
    await expect(page.locator('.sl-insights-chip-label')).toHaveText(/^Kamber (SÖ|SĞÖ|SA|SĞA)$/);
    await expect(page.locator('.sl-insights-after')).toHaveText(/^−?\d+\.\d°$/);
    await expect(panel.locator('.sl-telemetry-panel-legend.is-ghost')).toHaveText('Dikme');
    await expect(panel.locator('.sl-telemetry-panel-legend.is-live')).toHaveText('Çift salıncak');

    // trace controls
    await panel.locator('.sl-telemetry-panel-corner').nth(3).click();
    await expect(panel.locator('.sl-telemetry-panel-corner').nth(3)).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('button', { name: 'Yük' }).click();
    await run(page, 2);
    await expect(panel.locator('.sl-telemetry-panel-value').first()).toHaveText(/ kN$/);

    // the engineer panel takes the column; hiding the HUD hides both
    await page.evaluate(() => globalThis.__app!.set('engineerOpen', true));
    await expect(panel).toBeHidden();
    await page.evaluate(() => {
      globalThis.__app!.set('engineerOpen', false);
      globalThis.__app!.set('hudVisible', false);
    });
    await expect(panel).toBeHidden();
    await expect(page.locator('.sl-insights')).toBeHidden();
    await expectHealthyBoot(page, errors);
  });

  test('screenshots over the scene: carousel, swap ghost + delta chip', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, BOOT);
    await run(page, 150);
    await expect(page.locator('.sl-insights-caption')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, '04-03-carousel.png'), timeout: 300_000 });

    await page.evaluate(() => globalThis.__app!.set('suspensionId', 'double-wishbone'));
    await run(page, 40);
    await expect(page.locator('.sl-insights-chip-label')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, '04-03-swap-delta.png'), timeout: 300_000 });

    // replay the same stretch: the ghost is the strut's trace at the same track positions
    await page.evaluate((t) => globalThis.__app!.seek(t), Number(T0));
    await run(page, 150);
    await expect(page.locator('.sl-telemetry-panel-legend.is-ghost')).toBeVisible();
    await page.locator('.sl-telemetry-panel').screenshot({ path: join(SHOTS, '04-03-panel-ghost.png'), timeout: 300_000 });
    await expectHealthyBoot(page, errors);
  });
});
