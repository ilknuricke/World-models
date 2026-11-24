/**
 * 11-04 same line, different suspension (MD-44; ARCHITECTURE-M2 §7.14, §13.3): drive a few laps of the steering pad
 * and a slalom by scripted intents, press Compare: the panel shows traces, the verdict sentence and the driver-model
 * caption; the run replays with a translucent ghost of another suspension in lockstep (within the draw budget); the
 * control run (same suspension) shows the autopilot's repeat error; a hand-back clears it all; no console errors.
 * The measured A/A repeat error and A/B differences are printed ([11-04 e2e] lines).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/11-04-shots';
mkdirSync(SHOTS, { recursive: true });

const mode = (page: Page) => page.evaluate(() => globalThis.__app!.state().driveMode);
const advance = (page: Page, s: number) => page.evaluate((x) => globalThis.__app!.advance(x), s);
const intent = (page: Page, i: Record<string, number> | null) => page.evaluate((x) => globalThis.__app!.driveIntent(x), i);
const result = (page: Page) =>
  page.evaluate(() => {
    const r = (document.querySelector('.sl-ghost-lab') as HTMLElement | null)?.dataset.result;
    return r
      ? (JSON.parse(r) as Record<string, unknown> & {
          channels: Record<string, { floor: number; peakDiff: number; aPeak: number; bPeak: number; significant: boolean }>;
        })
      : null;
  });

async function openStation(page: Page, spawn: string, suspension: string): Promise<void> {
  await page.goto(`/?e2e=1&quality=low&suspension=${suspension}&drive=manual&spawn=${spawn}`);
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 60_000 });
  await expect.poll(() => mode(page)).toBe('manual');
  await page.evaluate(() => globalThis.__app!.set('paused', true));
}

async function script(page: Page, steps: readonly [Record<string, number>, number][]): Promise<void> {
  for (const [i, s] of steps) {
    await intent(page, i);
    await advance(page, s);
  }
  await intent(page, null);
}

const DEG = 180 / Math.PI;
function report(label: string, r: NonNullable<Awaited<ReturnType<typeof result>>>): string {
  const ch = Object.entries(r.channels)
    .map(([c, s]) => {
      const k = c === 'offset' ? 100 : DEG;
      const u = c === 'offset' ? 'cm' : '°';
      return `${c} floor ${(s.floor * k).toFixed(2)}${u} A ${(s.aPeak * k).toFixed(2)} B ${(s.bPeak * k).toFixed(2)} Δ ${(s.peakDiff * k).toFixed(2)}${s.significant ? '*' : ''}`;
    })
    .join('; ');
  const line = `[11-04 e2e] ${label}: ${r.own} vs ${r.target}, ${(r.seconds as number).toFixed(1)} s / ${(r.metres as number).toFixed(0)} m, A/A ${((r.aaOffset as number) * 100).toFixed(1)} cm, B ${((r.bOffset as number) * 100).toFixed(1)} cm off line, steer effort ${((r.steerEffort as number) * 100).toFixed(1)} %, ${r.verdict}\n  ${ch}`;
  console.log(line);
  return line;
}

/** Compare (G), the replay with the ghost, screenshots; returns the A/B result. */
async function compareAndWatch(page: Page, name: string, shotAt: number) {
  const chip = page.locator('.sl-ghost-lab-chip');
  await expect(chip).toBeVisible();
  await page.keyboard.press('g');
  const panel = page.locator('.sl-ghost-lab');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(panel).toHaveAttribute('data-verdict', /refused|lost|same|different/);
  await expect(panel.locator('.sl-ghost-lab-disclosure')).toContainText('aynı otomatik sürücü');
  await advance(page, 0.05);
  await expect.poll(() => mode(page)).toBe('replay');
  // the ghost visual loads asynchronously (a second instance of the car visual)
  await expect.poll(() => page.evaluate(() => (document.querySelector('.sl-ghost-lab') as HTMLElement).dataset.draws ?? ''), { timeout: 60_000 }).not.toBe('');
  const draws = await panel.getAttribute('data-draws');
  expect(Number(draws)).toBeLessThanOrEqual(40);
  await advance(page, shotAt);
  await expect.poll(() => chip.getAttribute('data-ghost')).toBe('on');
  await expect(panel.locator('.sl-ghost-lab-disclosure')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `11-04-${name}-ghost.png`) });
  const ab = (await result(page))!;
  await panel.screenshot({ path: join(SHOTS, `11-04-${name}-ab-panel.png`) });
  return { ab, draws: Number(draws) };
}

test.describe('11-04 ghost', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(300_000);

  test('steering pad: compare with the next suspension, the control run, hand-back clears', async ({ page }) => {
    const errors = captureConsole(page);
    // macpherson: the default A/B target is then double wishbone; multi-link is picked below
    await openStation(page, 'steering-pad', 'macpherson');
    test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');
    await script(page, [
      [{ throttle: 0.7, steer: 0.16 }, 5],
      [{ throttle: 0.32, steer: 0.17 }, 13],
    ]);
    const { ab, draws } = await compareAndWatch(page, 'pad', 6);
    const lines = [report('steering pad (default target)', ab), `draw calls ${draws}`];
    expect(ab.verdict).not.toBe('refused');
    expect(ab.aaOffset as number).toBeLessThan(0.25);

    const panel = page.locator('.sl-ghost-lab');
    await panel.locator('[data-target="multilink"]').click();
    await expect(panel).toHaveAttribute('data-target', 'multilink');
    await advance(page, 6);
    await expect.poll(() => page.locator('.sl-ghost-lab-chip').getAttribute('data-ghost')).toBe('on');
    const ml = (await result(page))!;
    lines.push(report('steering pad multilink', ml));
    await page.screenshot({ path: join(SHOTS, '11-04-pad-multilink-ghost.png') });
    await panel.screenshot({ path: join(SHOTS, '11-04-pad-multilink-panel.png') });
    // later in the run the paths part: the orbit view shows the ghost beside the car
    await advance(page, 7);
    await page.evaluate(() => globalThis.__app!.set('view', 'explore'));
    await advance(page, 0.5);
    await expect.poll(() => page.locator('.sl-ghost-lab-chip').getAttribute('data-ghost')).toBe('on');
    await page.screenshot({ path: join(SHOTS, '11-04-pad-multilink-explore.png') });
    await page.evaluate(() => globalThis.__app!.set('view', 'follow'));

    await panel.locator('[data-target="same"]').click();
    await expect(panel).toHaveAttribute('data-target', 'same');
    await expect(panel.locator('.sl-ghost-lab-sentence')).toContainText('Kontrol denemesi');
    await advance(page, 6);
    const aa = (await result(page))!;
    lines.push(report('steering pad control (A/A)', aa));
    await page.screenshot({ path: join(SHOTS, '11-04-pad-control-ghost.png') });
    await panel.screenshot({ path: join(SHOTS, '11-04-pad-aa-panel.png') });

    // the replay ends in manual: the traces stay, the ghost goes
    await advance(page, 30);
    await expect.poll(() => mode(page)).toBe('manual');
    await expect(panel).toBeVisible();
    await expect.poll(() => page.locator('.sl-ghost-lab-chip').getAttribute('data-ghost')).toBe('off');
    // hand-back clears the comparison
    await page.evaluate(() => globalThis.__app!.set('paused', false));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page)).not.toBe('manual');
    await expect(panel).toBeHidden();
    console.log(lines.join('\n'));
    await expectHealthyBoot(page, errors);
  });

  test('slalom: compare multi-link against the strut', async ({ page }) => {
    const errors = captureConsole(page);
    await openStation(page, 'slalom', 'multilink');
    test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');
    // run-up, then a weave through the cones (25 m apart at ~14 m/s: a steer reversal every ~1.8 s)
    const weave: [Record<string, number>, number][] = [[{ throttle: 0.75 }, 3.2]];
    for (let k = 0; k < 6; k++) weave.push([{ throttle: 0.3, steer: k % 2 === 0 ? 0.2 : -0.2 }, k === 0 ? 0.9 : 1.8]);
    weave.push([{ throttle: 0.3 }, 1.5]);
    await script(page, weave);
    const { ab } = await compareAndWatch(page, 'slalom', 5);
    const lines = [report('slalom multilink -> macpherson', ab)];
    expect(ab.verdict).not.toBe('refused');
    const panel = page.locator('.sl-ghost-lab');
    await panel.locator('[data-target="same"]').click();
    await expect(panel).toHaveAttribute('data-target', 'same');
    lines.push(report('slalom control (A/A)', (await result(page))!));
    await panel.screenshot({ path: join(SHOTS, '11-04-slalom-aa-panel.png') });
    // a reset clears it
    await page.evaluate(() => globalThis.__app!.set('paused', false));
    await page.locator('.sl-ghost-lab-close').click();
    await expect(panel).toBeHidden();
    console.log(lines.join('\n'));
    await expectHealthyBoot(page, errors);
  });
});
