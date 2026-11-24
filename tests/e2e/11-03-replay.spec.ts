/**
 * 11-03 replays (ARCHITECTURE-M2 §7.10 F/G, MD-43, MD-50): record a ~10 s drive, share it, open the generated `#r=`
 * link in a new page: it plays as "Shared run", ends in manual with the identical full-state CRC and the same
 * __app.drive() state (within one render interpolation step: both pages are paused at different points between two
 * fixed steps); moment replay (Q) plays the last seconds at quarter speed and ends at exactly the pre-replay state;
 * an older-model link plays labelled; another vehicle and a damaged link are refused with a note, no errors.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { decodeFragment, encodeFragment, fragmentOf } from '../../src/features/replay/link';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/11-03-shots';
mkdirSync(SHOTS, { recursive: true });
const MANUAL = '/?e2e=1&quality=low&t=40&drive=manual';
const VIEWER = '/?e2e=1&quality=low&paused=1&t=5';
const DT = 1 / 240;

const drive = (page: Page) => page.evaluate(() => globalThis.__app!.drive());
const advance = (page: Page, s: number) => page.evaluate((x) => globalThis.__app!.advance(x), s);
const mode = (page: Page) => page.evaluate(() => globalThis.__app!.state().driveMode);
const pause = (page: Page) => page.evaluate(() => globalThis.__app!.set('paused', true));
const intent = (page: Page, i: Record<string, number> | null) => page.evaluate((x) => globalThis.__app!.driveIntent(x), i);
const data = (page: Page, sel: string, key: string) => page.evaluate(([s, k]) => (document.querySelector(s!) as HTMLElement | null)?.dataset[k!] ?? null, [sel, key]);

/** waitForReady with a longer boot budget (a second page on the software renderer). */
async function open(page: Page, path: string): Promise<void> {
  await page.goto('about:blank'); // a hash-only change would not reload the app
  await page.goto(path);
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 60_000 });
}

/** Manual, paused, then a scripted ~10 s drive in fixed steps. */
async function recordDrive(page: Page): Promise<void> {
  await waitForReady(page, MANUAL);
  await expect.poll(() => mode(page)).toBe('manual');
  await pause(page);
  const script: [Record<string, number>, number][] = [
    [{ throttle: 0.8 }, 2.5],
    [{ throttle: 0.5, steer: 0.4 }, 2],
    [{ throttle: 0.3, steer: -0.5 }, 2],
    [{ brake: 0.6 }, 1],
    [{ throttle: 0.7, steer: 0.2 }, 2.5],
  ];
  for (const [i, s] of script) {
    await intent(page, i);
    await advance(page, s);
  }
  await intent(page, null);
}

/** In a paused viewer that is replaying: step exactly to the replay's last tick. */
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

test.describe('11-03 replays', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(300_000);

  test('record, share, open the link elsewhere: same end state; older model labelled; mismatch and damage refused', async ({ page, context }) => {
    const errors = captureConsole(page);
    await recordDrive(page);
    test.skip(!(await drive(page)).available, 'no Manual Drive plant in this build');
    const chip = page.locator('.sl-replay');
    await expect(chip).toBeVisible();
    await expect(chip.locator('[data-row="record"]')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, '11-03-recording.png') });

    await chip.locator('[data-action="share"]').click();
    const input = page.locator('.sl-replay-link');
    await expect(input).not.toHaveValue('');
    const link = await input.inputValue();
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.hash.startsWith('#r=')).toBe(true);
    const crc = await data(page, '.sl-replay-share', 'crc');
    const ticks = Number(await data(page, '.sl-replay-share', 'ticks'));
    console.log(`[11-03] e2e link: ${ticks / 240} s run, ${link.length} chars, fragment ${url.hash.length - 3}`);
    expect(ticks).toBeGreaterThanOrEqual(240 * 9.9);
    const ending = await drive(page);
    await page.screenshot({ path: join(SHOTS, '11-03-share.png') });
    await expectHealthyBoot(page, errors);
    await page.close(); // one WebGL page at a time on the software renderer

    // the viewer: a new page, paused Auto elsewhere on the lap, opens the link
    const viewer = await context.newPage();
    const vErrors = captureConsole(viewer);
    await open(viewer, `${VIEWER}${url.hash}`);
    await expect.poll(() => mode(viewer)).toBe('replay');
    await expect(viewer.locator('.sl-replay [data-row="play"]')).toBeVisible();
    await expect(viewer.locator('.sl-replay-label')).toHaveText('Paylaşılan sürüş');
    await expect(viewer.locator('[data-action="drive"]')).toHaveText('Kendiniz sürün');
    await pause(viewer);
    await advance(viewer, 3);
    await viewer.screenshot({ path: join(SHOTS, '11-03-shared-playback.png') });
    await toEnd(viewer);
    expect(await mode(viewer)).toBe('manual');
    expect(await data(viewer, '.sl-replay', 'endCrc')).toBe(crc);
    const seen = await drive(viewer);
    const step = Math.hypot(ending.u, ending.v) * DT + 0.01;
    console.log(`[11-03] e2e end: recorder (${ending.x.toFixed(3)}, ${ending.y.toFixed(3)}) ${ending.speed.toFixed(3)} m/s, viewer (${seen.x.toFixed(3)}, ${seen.y.toFixed(3)}) ${seen.speed.toFixed(3)} m/s, crc ${crc}`);
    expect(Math.abs(seen.x - ending.x)).toBeLessThanOrEqual(step);
    expect(Math.abs(seen.y - ending.y)).toBeLessThanOrEqual(step);
    expect(Math.abs(seen.speed - ending.speed)).toBeLessThan(0.05);
    expect(seen.gear).toBe(ending.gear);
    await expect(viewer.locator('.sl-replay-note')).toContainText('Sıra sizde');
    await expectHealthyBoot(viewer, vErrors);

    // the same run labelled as recorded with an older model; another vehicle; a damaged link
    const decoded = await decodeFragment(fragmentOf(url.hash)!);
    if (!('replay' in decoded)) throw new Error('link did not decode in Node');
    const older = await encodeFragment({ ...decoded.replay, header: { ...decoded.replay.header, simVersion: 'm2.0' } });
    const other = await encodeFragment({ ...decoded.replay, header: { ...decoded.replay.header, vehicleId: 'cafe-racer' } });
    const v2 = await context.newPage();
    const v2Errors = captureConsole(v2);
    await viewer.close();
    await open(v2, `${VIEWER}#r=${older}`);
    await expect.poll(() => mode(v2)).toBe('replay');
    await expect(v2.locator('.sl-replay-note')).toContainText('Eski bir modelle');
    await pause(v2);
    await v2.screenshot({ path: join(SHOTS, '11-03-older-model.png') });
    await v2.locator('[data-action="drive"]').click();
    await advance(v2, 0.1);
    expect(await mode(v2)).toBe('manual');
    await open(v2, `${VIEWER}#r=${other}`);
    await expect(v2.locator('.sl-replay-note')).toContainText('başka bir araçla');
    expect(await mode(v2)).toBe('auto');
    await open(v2, `${VIEWER}#r=${older.slice(0, 60)}xx${older.slice(62, 200)}`);
    await expect(v2.locator('.sl-replay-note')).toContainText('bozuk');
    expect(await mode(v2)).toBe('auto');
    await v2.screenshot({ path: join(SHOTS, '11-03-damaged.png') });
    await expectHealthyBoot(v2, v2Errors);
  });

  test('moment replay (Q): last seconds at quarter speed, then manual at exactly the pre-replay state', async ({ page }) => {
    const errors = captureConsole(page);
    await recordDrive(page);
    test.skip(!(await drive(page)).available, 'no Manual Drive plant in this build');
    // the pre-replay state's CRC (the share panel records it), then close the panel
    await page.locator('[data-action="share"]').click();
    const before = await data(page, '.sl-replay-share', 'crc');
    await page.keyboard.press('Escape');
    await page.locator('#stage').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('KeyQ');
    await expect.poll(() => mode(page)).toBe('replay');
    expect(await page.evaluate(() => globalThis.__app!.state().timeScale)).toBe(0.25);
    await expect(page.locator('.sl-replay-label')).toHaveText('Tekrar oynat');
    await expect(page.locator('.sl-replay-tag')).toBeVisible();
    await pause(page);
    await advance(page, 1.5);
    await page.screenshot({ path: join(SHOTS, '11-03-moment.png') });
    await toEnd(page);
    expect(await mode(page)).toBe('manual');
    expect(await data(page, '.sl-replay', 'endCrc')).toBe(before);
    expect(await page.evaluate(() => globalThis.__app!.state().timeScale)).toBe(1);
    await expectHealthyBoot(page, errors);
  });
});
