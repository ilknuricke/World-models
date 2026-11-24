/**
 * 05-03: the cafe racer in the real app. Car -> motorcycle from the HUD toggle, three presets one click apart, the
 * lean sign at the carousel (a right turn: the bike leans right, roll > 0), fork travel Classic > Telelever at the
 * brake-zone peak, bike close-ups and screenshots. Reduced motion makes view switches cuts (SwiftShader ~1 frame/s).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/05-03-shots';
mkdirSync(SHOTS, { recursive: true });
test.use({ deviceScaleFactor: 1, viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
test.setTimeout(1_800_000);

/** Carousel apex and a lap time inside the brake zone's full-braking plateau (05-01 metrics). */
const CAROUSEL_T = 49.3;
const BRAKE_T = 4.5;
const G = 9.80665;

const frames = (page: Page, n: number) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let k = 0;
        const f = () => (++k >= count ? resolve() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

const state = (page: Page) => page.evaluate(() => globalThis.__app!.state());
const frame = (page: Page) => page.evaluate(() => globalThis.__app!.frame());
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `05-03-${name}.png`) });

async function seek(page: Page, lapTime: number): Promise<void> {
  await page.evaluate((t) => globalThis.__app!.seek(t), lapTime);
  await frames(page, 3);
}

async function view(page: Page, v: 'follow' | 'explore' | 'closeup', corner: 'f' | 'r' | null = null): Promise<void> {
  await page.evaluate(
    ([v, c]) => {
      globalThis.__app!.set('focusCorner', c as never);
      globalThis.__app!.set('view', v as never);
    },
    [v, corner] as const,
  );
  await frames(page, 3);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.sl-camera-fade')].every((e) => Number(e.style.opacity || 0) === 0), undefined, { timeout: 120_000 });
}

async function preset(page: Page, label: string, id: string): Promise<void> {
  await page.getByRole('radio', { name: new RegExp(label) }).click();
  await expect.poll(async () => (await state(page)).suspensionId, { timeout: 120_000 }).toBe(id);
  await frames(page, 3);
}

test('car <-> motorcycle: presets, lean sign, fork dive, bike framings and screenshots', async ({ page }) => {
  const consoleErrors = captureConsole(page);
  await page.goto(`/?e2e=1&quality=low&paused=1&t=${CAROUSEL_T}`);
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 300_000 });
  expect((await state(page)).vehicleId).toBe('gt-coupe');

  // One click on the HUD's vehicle toggle; it names the other class.
  const toggle = page.locator('.sl-controls-vehicle');
  await expect(toggle).toContainText('Cafe racer');
  await toggle.click();
  await expect.poll(async () => (await state(page)).vehicleId, { timeout: 120_000 }).toBe('cafe-racer');
  expect((await state(page)).suspensionId).toBe('moto-classic');
  await expect(toggle).toContainText('GT kupe');
  for (const name of ['Klasik', 'Modern', 'Telelever']) await expect(page.getByRole('radio', { name: new RegExp(name) })).toBeVisible();
  await expect(page.locator('.sl-telemetry-panel-corner')).toHaveCount(2);
  await expect(page.locator('.sl-telemetry-panel')).toContainText('Yatma');
  await frames(page, 4);

  // Carousel: a right turn, the bike leans right = roll > 0 (contract: + lifts the left side).
  await seek(page, CAROUSEL_T);
  const apex = await frame(page);
  console.log('[05-03] carousel', JSON.stringify({ section: apex.sectionId, roll: apex.roll, ay: apex.ay }));
  expect(apex.sectionId).toBe('carousel');
  expect(apex.ay).toBeLessThan(-0.6 * G);
  expect(apex.roll).toBeGreaterThan(0.45);
  await shot(page, 'chase-carousel');

  // Explore: drag a quarter turn round to a front three-quarter view.
  await view(page, 'explore');
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(400, 380, { steps: 6 });
  await page.mouse.up();
  await frames(page, 6);
  await shot(page, 'explore');

  // Brake zone: fork travel per preset at the same lap time.
  const travel: Record<string, number> = {};
  for (const [label, id] of [
    ['Klasik', 'moto-classic'],
    ['Modern', 'moto-modern'],
    ['Telelever', 'moto-telelever'],
  ] as const) {
    if ((await state(page)).suspensionId !== id) await preset(page, label, id);
    await view(page, 'follow');
    await seek(page, BRAKE_T);
    const f = await frame(page);
    expect(f.sectionId).toBe('brake-zone');
    expect(f.ax).toBeLessThan(-0.6 * G);
    travel[id] = f.corners[0]!.travel;
    console.log('[05-03] brake', id, JSON.stringify({ ax: f.ax, pitch: f.pitch, front: f.corners[0]!.travel, rear: f.corners[1]!.travel }));
    // 07-01: the fork close-up keeps the bike solid; the rear one ghosts only the bodywork over the shock.
    await view(page, 'closeup', 'f');
    expect((await state(page)).xray).toBe(false);
    await shot(page, `${label.toLowerCase()}-fork`);
    await view(page, 'closeup', 'r');
    expect((await state(page)).xray).toBe(true);
    await shot(page, `${label.toLowerCase()}-rear-xray`);
  }
  expect(travel['moto-classic']!).toBeGreaterThan(travel['moto-telelever']! + 0.02);
  expect(travel['moto-modern']!).toBeGreaterThan(travel['moto-telelever']! + 0.02);

  // Back to the car in one click; its default suspension returns.
  await view(page, 'follow');
  await toggle.click();
  await expect.poll(async () => (await state(page)).vehicleId, { timeout: 120_000 }).toBe('gt-coupe');
  expect((await state(page)).suspensionId).toMatch(/macpherson|double-wishbone|multilink/);
  await expect(page.locator('.sl-telemetry-panel-corner')).toHaveCount(4);

  const appErrors = await page.evaluate(() => globalThis.__app!.errors);
  console.log('[05-03] app errors', JSON.stringify(appErrors), 'console', JSON.stringify(consoleErrors));
  expect([...appErrors, ...consoleErrors].filter((e) => /moto|cafe|motorcycle|bike|camera|telemetry|insight|attract|overlay/i.test(e))).toEqual([]);
});
