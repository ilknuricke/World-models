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
  '.sl-narration-toggle',
  '.sl-narration-notes',
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

const LANDSCAPE_HUD = [
  '.sl-landscape-strip', '.sl-drive-mode-control',
  '.sl-controls-tag', '.sl-controls-tr', '.sl-controls-br', '.sl-controls-bc', '.sl-controls-amp', '.sl-controls-help', '.sl-controls-restore',
  '.sl-narration', '.sl-insights', '.sl-coach', '.sl-engineer-toggle', '.sl-engineer-panel', '.sl-telemetry-toggle', '.sl-telemetry-panel',
  '.sl-drive-pill', '.sl-drive-hint', '.sl-drive-actions', '.sl-drive-panel', '.sl-drive-steer', '.sl-drive-pedals',
  '.sl-teaching-overlays-trace', '.sl-ghost-lab', '.sl-ghost-lab-note', '.sl-replay-share', '.sl-replay-note', '.sl-credits',
];

/** Use the actual resized scene, not test-only contact projections based on the full viewport. */
async function expectLandscapeSceneClear(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate((selectors) => {
    const stage = document.querySelector('#stage')!.getBoundingClientRect();
    if (stage.height <= 0 || stage.width <= 0) return ['scene has no visible area'];
    return [...document.querySelectorAll<HTMLElement>(selectors.join(','))].filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (el.hidden || rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') return false;
      return rect.left < stage.right - 1 && rect.right > stage.left + 1 && rect.top < stage.bottom - 1 && rect.bottom > stage.top + 1;
    }).map((el) => el.className);
  }, LANDSCAPE_HUD), { message: 'every visible landscape menu or driving control stays outside the vehicle scene' }).toEqual([]);
}

async function expectModeBesideNarration(page: Page): Promise<void> {
  await expect(page.locator('.sl-drive-toggle')).toHaveCount(1);
  await expect(page.locator('.sl-drive-mode-control .sl-drive-toggle')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>('.sl-landscape-strip')!;
    const voice = document.querySelector<HTMLElement>('.sl-narration-toggle')!;
    const host = document.querySelector<HTMLElement>('.sl-drive-mode-control')!;
    const toggle = host.querySelector<HTMLElement>('.sl-drive-toggle')!;
    const s = strip.getBoundingClientRect(), v = voice.getBoundingClientRect(), t = toggle.getBoundingClientRect();
    return {
      adjacent: voice.nextElementSibling === host,
      sameRow: Math.abs(v.top + v.height / 2 - t.top - t.height / 2) <= 2,
      initialVoiceVisible: v.width > 0 && v.left >= s.left - 1 && v.right <= s.right + 1,
      initialModeVisible: t.width > 0 && t.left >= s.left - 1 && t.right <= Math.min(s.right, innerWidth) + 1,
      startsWithoutPanning: Math.abs(strip.scrollLeft) <= 1,
    };
  }), { message: 'voice and the full Auto/Manual control initially share the top row, immediately adjacent without panning' }).toEqual({
    adjacent: true, sameRow: true, initialVoiceVisible: true, initialModeVisible: true, startsWithoutPanning: true,
  });
}

async function expectSpeedInsideScene(page: Page): Promise<void> {
  await expect(page.locator('.sl-drive-readout')).toHaveCount(1);
  await expect(page.locator('.sl-drive-speed-hud > .sl-drive-readout')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stage = document.querySelector('#stage')!.getBoundingClientRect();
    const badge = document.querySelector('.sl-drive-speed-hud')!.getBoundingClientRect();
    return {
      topInset: Math.abs(badge.top - stage.top - 8) <= 1,
      insideScene: badge.left >= stage.left && badge.top >= stage.top && badge.right <= stage.right && badge.bottom <= stage.bottom,
      upperLeft: badge.left - stage.left < 40 && badge.width < 160,
    };
  }), { message: 'the read-only speed badge sits compactly at the upper-left of the actual vehicle scene' }).toEqual({
    topInset: true, insideScene: true, upperLeft: true,
  });
}

test.describe('11-05 phone station information after rotation', () => {
  test.use({ viewport: { width: 400, height: 840 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  test.setTimeout(300_000);

  for (const landscapeSize of [{ width: 844, height: 390 }, { width: 568, height: 320 }]) {
  test(`${landscapeSize.width}x${landscapeSize.height}: landscape keeps scenario information and touch controls outside the scene`, async ({ page }) => {
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
        stage: rect('#stage'), drive: rect('.sl-drive'), pill: rect('.sl-drive-pill:not(.sl-drive-mode-control)'), hint: rect('.sl-drive-hint'),
        reserve: Number.parseFloat(getComputedStyle(document.querySelector('#stage')!).bottom),
        topReserve: Number.parseFloat(getComputedStyle(document.querySelector('#stage')!).top),
      };
    });

    expect((await geometry()).reserve, 'portrait keeps its existing full scene').toBe(0);
    await page.setViewportSize(landscapeSize);
    await raf(page);
    await expect(hint).toHaveAttribute('data-kind', 'station');
    await expect(hint).toBeVisible();
    await expect.poll(async () => (await geometry()).reserve, { message: 'rotation reserves space for the driving information' }).toBeGreaterThan(0);
    const landscape = await geometry();
    if (landscape.pill.height > 0) expect(landscape.hint.top, 'station information is below any remaining drive notices').toBeGreaterThanOrEqual(landscape.pill.bottom);
    else expect(Math.abs(landscape.drive.height - landscape.hint.height), 'without notices, only scenario instructions occupy the bottom driving row').toBeLessThanOrEqual(1);
    expect(landscape.hint.bottom).toBeLessThanOrEqual(landscapeSize.height);
    expect(landscape.hint.left).toBeGreaterThanOrEqual(0);
    expect(landscape.hint.right).toBeLessThanOrEqual(landscapeSize.width);
    expect(landscape.stage.bottom, 'the vehicle scene ends above the entire driving bar').toBeLessThanOrEqual(landscape.drive.top - 1);
    expect(landscape.topReserve, 'top menus also have their own space').toBeGreaterThan(0);
    await expectLandscapeSceneClear(page);
    await expectModeBesideNarration(page);
    await expectSpeedInsideScene(page);
    const display = page.getByRole('button', { name: 'Görünüm seçenekleri', exact: true });
    await display.tap();
    await expect(page.locator('.sl-controls-br')).toBeVisible();
    await expectLandscapeSceneClear(page);
    await display.tap();
    const pedals = await page.locator('.sl-drive-pedals').boundingBox();
    expect(pedals!.height, 'compact landscape pedals stay in their reserved band').toBeLessThanOrEqual(113);
    const originalPill = page.locator('.sl-drive > .sl-drive-pill:not(.sl-drive-mode-control)');
    const noNotices = await originalPill.evaluate((el) => !el.matches('.is-returning, .is-off-lap') && !el.querySelector('.sl-drive-lamps.is-lit'));
    if (noNotices) await expect(originalPill).toBeHidden();

    const initialSpeed = Number(await page.locator('.sl-drive-speed-hud .sl-drive-speed').textContent());
    await page.evaluate(() => {
      globalThis.__app!.driveIntent({ throttle: 0.6 });
      globalThis.__app!.advance(1);
      globalThis.__app!.driveIntent(null);
      globalThis.__app!.set('paused', true);
    });
    await expect.poll(async () => Number(await page.locator('.sl-drive-speed-hud .sl-drive-speed').textContent()), { message: 'the existing speed value continues updating in its new HUD parent' }).toBeGreaterThan(initialSpeed);
    expect(Number(await page.locator('.sl-drive-speed-hud .sl-drive-speed').textContent())).toBe(await page.evaluate(() => Math.round(globalThis.__app!.drive().speed * 3.6)));
    await expectSpeedInsideScene(page);
    await page.screenshot({ path: join(SHOTS, `11-05-station-landscape-${landscapeSize.width}.png`) });

    // These are the original working controls moved to the top, not a visual copy.
    const mode = page.locator('.sl-drive-mode-control .sl-drive-toggle');
    await mode.tap();
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().driveMode), { timeout: 20_000 }).toBe('auto');
    await expect(mode).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.sl-drive-speed-hud')).toBeHidden();
    await mode.tap();
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().driveMode)).toBe('manual');
    await expect(mode).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sl-drive-touch')).toBeVisible();
    await expectModeBesideNarration(page);
    await expectSpeedInsideScene(page);
    await expectLandscapeSceneClear(page);

    // The same mounted layout must restore its space on rotation and HUD/mode changes.
    await page.setViewportSize({ width: 400, height: 840 });
    await expect.poll(async () => (await geometry()).reserve).toBe(0);
    await expect.poll(async () => (await geometry()).topReserve).toBe(0);
    await expect(page.locator('.sl-landscape-strip')).toBeHidden();
    await expect(page.locator('.sl-drive-pill:not(.sl-drive-mode-control) > .sl-drive-toggle')).toHaveCount(1);
    await expect(page.locator('.sl-drive-pill:not(.sl-drive-mode-control) > .sl-drive-readout')).toHaveCount(1);
    await expect(page.locator('.sl-drive-speed-hud')).toHaveCount(0);
    await page.setViewportSize({ width: 667, height: 376 });
    await expect.poll(async () => (await geometry()).reserve).toBeGreaterThan(0);
    await page.evaluate(() => globalThis.__app!.set('hudVisible', false));
    // Touch controls intentionally remain usable with the HUD hidden, and still need their own space.
    await expectLandscapeSceneClear(page);
    await page.getByRole('button', { name: 'Kontrolleri göster', exact: true }).tap();
    await expect.poll(async () => (await geometry()).reserve).toBeGreaterThan(0);
    await page.locator('.sl-controls-live').tap();
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().driveMode)).toBe('auto');
    await expectLandscapeSceneClear(page);
    await expect.poll(async () => (await geometry()).reserve, { message: 'Auto keeps its bottom suspension and launcher dock clear' }).toBeGreaterThan(0);
    await expectHealthyBoot(page, errors);
  });

  test(`${landscapeSize.width}x${landscapeSize.height}: landscape keeps camera, physics, notes and requested sheets outside the scene`, async ({ page }) => {
    const errors = captureConsole(page);
    await boot(page, '/?e2e=1&quality=low&paused=1&t=40');
    await page.setViewportSize(landscapeSize);
    await expectLandscapeSceneClear(page);
    await expectModeBesideNarration(page);

    await page.locator('.sl-drive-stations-btn').tap();
    await expect(page.locator('.sl-drive-stations-panel')).toBeVisible();
    await expectLandscapeSceneClear(page);
    await page.locator('.sl-drive-stations-btn').press('Escape');
    await expect(page.locator('.sl-drive-stations-panel')).toBeHidden();

    const display = page.getByRole('button', { name: 'Görünüm seçenekleri', exact: true });
    await display.tap();
    await expect(page.locator('.sl-controls-br')).toBeVisible();
    await expectLandscapeSceneClear(page);
    await page.getByRole('radio', { name: 'Yakın plan', exact: true }).tap();
    await display.tap();
    const physics = page.getByRole('button', { name: 'Fizik katmanları', exact: true });
    await physics.tap();
    await display.tap(); // Readouts yield to the open camera menu; they return when it closes.
    await expect(page.locator('.sl-teaching-overlays-trace')).toBeVisible();
    await expectLandscapeSceneClear(page);
    await display.tap();
    await physics.tap();
    await page.getByRole('radio', { name: 'Takip', exact: true }).tap();

    await page.locator('.sl-telemetry-toggle').tap();
    await expect(page.locator('.sl-telemetry-panel')).toBeVisible();
    await expectLandscapeSceneClear(page);
    await page.locator('.sl-telemetry-close').tap();
    await page.getByRole('button', { name: 'Mühendise sor', exact: true }).tap();
    await expect(page.locator('.sl-engineer-panel')).toBeVisible();
    await expectLandscapeSceneClear(page);
    await page.locator('.sl-engineer-close').tap();

    await page.locator('.sl-narration-notes').tap();
    await showCoach(page, LONG_LINE);
    await expectLandscapeSceneClear(page);
    await showCoach(page, null);
    await page.screenshot({ path: join(SHOTS, `11-05-landscape-clear-scene-${landscapeSize.width}.png`) });
    await expectHealthyBoot(page, errors);
  });

  test(`${landscapeSize.width}x${landscapeSize.height}: the speed badge yields when combined menus leave too little scene space`, async ({ page }) => {
    const errors = captureConsole(page);
    await boot(page, '/?e2e=1&quality=low&paused=1&drive=manual&spawn=steering-pad');
    test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');
    await page.setViewportSize(landscapeSize);
    await expectSpeedInsideScene(page);
    const display = page.getByRole('button', { name: 'Görünüm seçenekleri', exact: true });
    await display.tap();
    await page.locator('.sl-drive-stations-btn').tap();
    await expect(page.locator('.sl-controls-br')).toBeVisible();
    await expect(page.locator('.sl-drive-stations-panel')).toBeVisible();
    await expectLandscapeSceneClear(page);
    await expect.poll(() => page.evaluate(() => {
      const stage = document.querySelector('#stage')!.getBoundingClientRect();
      const badge = document.querySelector('.sl-drive-speed-hud')!;
      return getComputedStyle(badge).visibility === (stage.height < 44 ? 'hidden' : 'visible');
    }), { message: 'the read-only speed badge yields only when its scene is too short' }).toBe(true);
    await page.locator('.sl-drive-stations-btn').press('Escape');
    await display.tap();
    await expectSpeedInsideScene(page);
    await expectLandscapeSceneClear(page);
    await expectHealthyBoot(page, errors);
  });
  }
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
