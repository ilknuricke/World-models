/**
 * 11-05: the driving layout keeps the car clear. In Manual at 1280x720 and 1920x1080 the bottom-centre HUD is one slim
 * row (the union of bottom-centre boxes is at most 15 % of the viewport height, with or without the control hint), no
 * two HUD boxes overlap (also with every aid lamp lit and with the coach line up), and the tyre contact points of the
 * car in the default chase view are not covered by any HUD box. Touch-driving on a landscape phone (844x390) and a
 * tablet (1024x768): nothing overlaps the steering slider or the pedals, the telemetry card folds (tablet) or rests
 * (phone), and a long coach line stays readable below the top-right controls.
 * Screenshots go to SHOTS_DIR (software renderer).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/features/proving-ground/index'; // declares __screenContacts
import { captureConsole, expectHealthyBoot } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/11-05-shots';
mkdirSync(SHOTS, { recursive: true });

const HUD = [
  '.sl-controls-tag',
  '.sl-controls-tr',
  '.sl-controls-amp',
  '.sl-controls-bc',
  '.sl-controls-br',
  '.sl-narration',
  '.sl-telemetry-panel',
  '.sl-engineer',
  '.sl-teaching-overlays-trace',
  '.sl-coach-caption',
  '.sl-insights-caption',
  '.sl-drive-pill',
  '.sl-drive-hint',
  '.sl-drive-actions',
  '.sl-drive-steer',
  '.sl-drive-pedals',
];
const LONG_LINE = 'Viraj ortasında gazı bırakmak yükü ön lastiklere aktardı; hafifleyen arka taraf tutunmayı kaybetti ve araç döndü.';

interface Box {
  sel: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxes = (page: Page): Promise<Box[]> =>
  page.evaluate((sels) => {
    const out: Box[] = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1) out.push({ sel, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return out;
  }, HUD);

function overlaps(list: readonly Box[], vp: { width: number; height: number }): string[] {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (a.x < -0.5 || a.y < -0.5 || a.x + a.w > vp.width + 0.5 || a.y + a.h > vp.height + 0.5) out.push(`${a.sel} leaves the screen`);
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 0.5 && iy > 0.5) out.push(`${a.sel} × ${b.sel} (${Math.round(ix)}×${Math.round(iy)} px)`);
    }
  }
  return out;
}

const fmt = (list: readonly Box[]) => list.map((b) => `${b.sel} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}`).join(' | ');

/** Boxes whose centre is in the middle 40 % of the width and lower half of the screen: the bottom-centre stack. */
function bottomCentre(list: readonly Box[], vp: { width: number; height: number }): number {
  const mid = list.filter((b) => Math.abs(b.x + b.w / 2 - vp.width / 2) < vp.width * 0.2 && b.y + b.h / 2 > vp.height / 2);
  if (mid.length === 0) return 0;
  return Math.max(...mid.map((b) => b.y + b.h)) - Math.min(...mid.map((b) => b.y));
}

async function showCoach(page: Page, text: string | null): Promise<void> {
  await page.evaluate((t) => {
    const caption = document.querySelector<HTMLElement>('.sl-coach-caption')!;
    caption.hidden = t === null;
    caption.style.animation = 'none';
    caption.querySelector('.sl-coach-text')!.textContent = t ?? '';
    const chip = caption.querySelector<HTMLElement>('.sl-coach-chip')!;
    chip.hidden = t === null;
    chip.textContent = 'Hız 64 km/h';
  }, text);
}

/** waitForReady with a longer boot allowance (software rendering at 1920x1080 can take over 20 s). */
async function boot(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
}

const raf = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test.describe('11-05 driving layout (desktop)', () => {
  test.setTimeout(480_000);
  for (const vp of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    test(`Manual at ${vp.width}x${vp.height}: one slim bottom row, nothing over the tyres`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport: vp, deviceScaleFactor: 1 })).newPage();
      const errors = captureConsole(page);
      await boot(page, '/?e2e=1&quality=low&paused=1&drive=manual&spawn=steering-pad');
      test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');
      await page.evaluate(() => globalThis.__app!.advance(1));
      await raf(page);
      const tag = `${vp.width}x${vp.height}`;
      const report: string[] = [];

      // with the control hint (right after the takeover) and after it has faded (6 s)
      for (const phase of ['hint', 'settled'] as const) {
        if (phase === 'settled') {
          // the control hint (6 s of frames) fades; software-rendered frames are slow, so poll
          await expect.poll(() => page.evaluate(() => document.querySelector('.sl-drive-hint')!.classList.contains('is-shown')), { timeout: 180_000 }).toBe(false);
          await expect.poll(async () => (await boxes(page)).some((b) => b.sel === '.sl-drive-hint'), { timeout: 60_000 }).toBe(false);
        }
        const list = await boxes(page);
        const sels = list.map((b) => b.sel);
        expect(sels).toContain('.sl-drive-pill');
        const kind = await page.evaluate(() => document.querySelector<HTMLElement>('.sl-drive-hint')!.dataset.kind);
        if (phase === 'hint') expect(sels).toContain('.sl-drive-hint');
        else expect(sels, `hint ${kind} still up`).not.toContain('.sl-drive-hint');
        const tall = bottomCentre(list, vp);
        report.push(`${phase}: bottom-centre ${tall.toFixed(0)} px (${((100 * tall) / vp.height).toFixed(1)} %) — ${fmt(list)}`);
        expect.soft(overlaps(list, vp), `${tag} ${phase}`).toEqual([]);
        expect.soft(tall, `${tag} ${phase}: bottom-centre height`).toBeLessThanOrEqual(0.15 * vp.height);
        const contacts = await page.evaluate(() => globalThis.__screenContacts!());
        report.push(`contacts ${contacts.map((c) => `${c.x.toFixed(0)},${c.y.toFixed(0)}`).join(' ')}`);
        expect(contacts.filter((c) => c.x > 0 && c.x < vp.width && c.y > 0 && c.y < vp.height)).toHaveLength(4);
        for (const c of contacts) {
          const over = list.filter((b) => c.x >= b.x - 8 && c.x <= b.x + b.w + 8 && c.y >= b.y - 8 && c.y <= b.y + b.h + 8);
          expect.soft(over.map((b) => b.sel), `${tag} ${phase}: contact ${c.x.toFixed(0)},${c.y.toFixed(0)} uncovered`).toEqual([]);
        }
        if (phase === 'settled') await page.screenshot({ path: join(SHOTS, `11-05-manual-${tag}.png`) });
      }

      // A long coach line below the top-right controls and every lamp lit: no overlap, tyres still clear.
      await showCoach(page, LONG_LINE);
      await page.evaluate(() => {
        for (const l of document.querySelectorAll<HTMLElement>('.sl-drive-lamp')) l.hidden = false;
        document.querySelector('.sl-drive-lamps')!.classList.add('is-lit');
      });
      await raf(page);
      const list = await boxes(page);
      report.push(`coach + lamps: ${fmt(list)}`);
      expect(list.map((b) => b.sel)).toContain('.sl-coach-caption');
      expect.soft(overlaps(list, vp), `${tag} coach + lamps`).toEqual([]);
      expect.soft(bottomCentre(list, vp)).toBeLessThanOrEqual(0.15 * vp.height);
      for (const c of await page.evaluate(() => globalThis.__screenContacts!())) {
        expect.soft(list.filter((b) => c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h).map((b) => b.sel)).toEqual([]);
      }
      await page.screenshot({ path: join(SHOTS, `11-05-manual-coach-${tag}.png`) });
      console.log(`[11-05] ${tag}\n${report.join('\n')}`);
      await showCoach(page, null);
      await expectHealthyBoot(page, errors);
    });
  }
});

for (const [name, viewport, isMobile] of [
  ['phone', { width: 844, height: 390 }, true],
  ['tablet', { width: 1024, height: 768 }, false],
] as const) {
  test.describe(`11-05 touch-driving layout (${name})`, () => {
    test.use({ viewport, hasTouch: true, isMobile, deviceScaleFactor: 1 });
    test.setTimeout(300_000);

    test(`${viewport.width}x${viewport.height}: nothing over the slider or the pedals; captions a sensible width`, async ({ page }) => {
      const errors = captureConsole(page);
      await boot(page, '/?e2e=1&quality=low&paused=1&t=40');
      test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');
      await page.locator('.sl-drive-toggle').tap();
      await expect.poll(() => page.evaluate(() => globalThis.__app!.state().driveMode)).toBe('manual');
      await expect(page.locator('.sl-drive-touch')).toBeVisible();
      await page.waitForTimeout(1000);
      await raf(page);
      let list = await boxes(page);
      const report = [`driving: ${fmt(list)}`];
      expect.soft(overlaps(list, viewport), `${name} driving`).toEqual([]);
      const tele = list.find((b) => b.sel === '.sl-telemetry-panel');
      if (name === 'phone') expect(tele).toBeUndefined();
      else expect(tele!.w).toBeLessThan(200); // folded to the g-g and its two numbers

      if (name === 'phone') {
        const notes = page.locator('.sl-narration-notes');
        const camera = page.getByRole('button', { name: 'Görünüm seçenekleri', exact: true });
        await expect(notes).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('.sl-controls-br')).toBeHidden();
        await notes.tap();
        await camera.tap();
        await expect(notes).toHaveAttribute('aria-expanded', 'true');
        await expect(camera).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.sl-controls-br')).toBeVisible();
      }

      await showCoach(page, LONG_LINE);
      await raf(page);
      list = await boxes(page);
      report.push(`coach: ${fmt(list)}`);
      const coach = list.find((b) => b.sel === '.sl-coach-caption')!;
      expect(coach).toBeDefined();
      await page.screenshot({ path: join(SHOTS, `11-05-touch-${name}.png`) });
      expect.soft(overlaps(list, viewport), `${name} coach`).toEqual([]);
      expect(coach.w).toBeGreaterThanOrEqual(280); // a readable card rather than a narrow strip over the car
      expect(coach.w).toBeLessThanOrEqual(316);
      expect(coach.h).toBeLessThanOrEqual(140);
      const controls = list.find((b) => b.sel === '.sl-controls-br')!;
      expect(coach.y).toBeGreaterThan(controls.y + controls.h);
      expect(coach.x + coach.w).toBeLessThanOrEqual(viewport.width - (name === 'phone' ? 10 : 16));
      console.log(`[11-05] ${name}\n${report.join('\n')}`);
      if (name === 'phone') {
        await page.locator('.sl-narration-notes').tap();
        await page.getByRole('button', { name: 'Görünüm seçenekleri', exact: true }).tap();
        await expect(page.locator('.sl-narration-notes')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('.sl-coach-caption')).toBeHidden();
        await expect(page.locator('.sl-controls-br')).toBeHidden();
      }
      await showCoach(page, null);
      await expectHealthyBoot(page, errors);
    });
  });
}

test.describe('11-05 phone station information after rotation', () => {
  test.use({ viewport: { width: 400, height: 840 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  test.setTimeout(300_000);

  test('landscape moves station information below the drive pill and keeps the scene above it', async ({ page }) => {
    const errors = captureConsole(page);
    await boot(page, '/?e2e=1&quality=low&paused=1&t=40');
    test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');

    // Select an actual experiment: ?spawn alone does not show the visitor's station information.
    await page.locator('.sl-drive-stations-btn').tap();
    await page.locator('#sl-drive-stations-panel [data-station="steering-pad"]').tap();
    const hint = page.locator('.sl-drive-hint');
    await expect(hint).toHaveAttribute('data-kind', 'station');
    await expect(hint).toHaveClass(/is-shown/);
    await expect(page.locator('.sl-drive-touch')).toBeVisible();

    const geometry = () => page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
      };
      return {
        stage: rect('#stage'), drive: rect('.sl-drive'), pill: rect('.sl-drive-pill'), hint: rect('.sl-drive-hint'),
        reserve: Number.parseFloat(getComputedStyle(document.querySelector('#stage')!).bottom),
      };
    });

    expect((await geometry()).reserve, 'portrait keeps its existing full scene').toBe(0);
    await page.setViewportSize({ width: 844, height: 390 });
    await raf(page);
    await expect(hint).toHaveAttribute('data-kind', 'station');
    await expect(hint).toBeVisible();
    await expect.poll(async () => (await geometry()).reserve, { message: 'rotation reserves space for the driving information' }).toBeGreaterThan(0);
    const landscape = await geometry();
    expect(landscape.hint.top, 'station information is below the drive pill').toBeGreaterThanOrEqual(landscape.pill.bottom);
    expect(landscape.hint.bottom).toBeLessThanOrEqual(390);
    expect(landscape.hint.left).toBeGreaterThanOrEqual(0);
    expect(landscape.hint.right).toBeLessThanOrEqual(844);
    expect(landscape.stage.bottom, 'the vehicle scene ends above the entire driving bar').toBeLessThanOrEqual(landscape.drive.top - 1);
    await page.screenshot({ path: join(SHOTS, '11-05-station-landscape.png') });

    // The same mounted layout must restore its space on rotation and HUD/mode changes.
    await page.setViewportSize({ width: 400, height: 840 });
    await expect.poll(async () => (await geometry()).reserve).toBe(0);
    await page.setViewportSize({ width: 667, height: 376 });
    await expect.poll(async () => (await geometry()).reserve).toBeGreaterThan(0);
    await page.evaluate(() => globalThis.__app!.set('hudVisible', false));
    await expect.poll(async () => (await geometry()).reserve, { message: 'a hidden HUD leaves no stale scene gap' }).toBe(0);
    await page.getByRole('button', { name: 'Kontrolleri göster', exact: true }).tap();
    await expect.poll(async () => (await geometry()).reserve).toBeGreaterThan(0);
    await page.locator('.sl-controls-live').tap();
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().driveMode)).toBe('auto');
    await expect.poll(async () => (await geometry()).reserve, { message: 'returning to Auto releases the manual driving bar space' }).toBe(0);
    await expectHealthyBoot(page, errors);
  });
});

test.describe('11-05 annex budget (high tier)', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  test.setTimeout(400_000);

  test('the stations stay within 1.5 M triangles and 250 draw calls (coarse loop ribbon from the annex)', async ({ page }) => {
    const errors = captureConsole(page);
    const out: string[] = [];
    for (const query of ['t=14', 'drive=manual&spawn=ride-street', 'drive=manual&spawn=steering-pad', 'drive=manual&spawn=braking-platform']) {
      await boot(page, `/?e2e=1&quality=high&paused=1&${query}`);
      await page.evaluate(() => globalThis.__app!.advance(0.5));
      await raf(page);
      const s = (await page.evaluate(() => globalThis.__app!.stats()))!;
      out.push(`${query}: ${s.calls} calls / ${s.triangles} triangles`);
      expect.soft(s.triangles, query).toBeLessThanOrEqual(1_500_000);
      expect.soft(s.calls, query).toBeLessThanOrEqual(250);
    }
    console.log(`[11-05] high tier\n${out.join('\n')}`);
    await expectHealthyBoot(page, errors);
  });
});
