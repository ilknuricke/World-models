/**
 * 04-05: one coherent HUD. No two HUD elements overlap and every one stays on screen at 1280×720 and 1920×1080 in
 * follow, close-up, with the engineer panel open and on a presenter big screen with a live room (code card, presence
 * line, poll). Empty screen stays canvas: nothing outside the HUD boxes takes pointer input, and an orbit drag works
 * with every panel open. The big screen runs `?screen=1&debug=1` (e2e mode keeps the room offline, §6.6).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/04-05-shots';
const PREFIX = process.env.SHOTS_PREFIX ?? '04-05';
mkdirSync(SHOTS, { recursive: true });

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

/** Every HUD element that owns a region of the screen (help card and credits sheet are transient popovers). */
const HUD = [
  '.sl-controls-tag',
  '.sl-controls-tr',
  '.sl-controls-amp',
  '.sl-controls-bc',
  '.sl-controls-br',
  '.sl-narration',
  '.sl-live-lab',
  '.sl-presenter',
  '.sl-poll',
  '.sl-telemetry-panel',
  '.sl-engineer',
  '.sl-insights-caption',
  '.sl-teaching-overlays-trace',
  '.sl-debug-stats',
  // drive (08-03, 09-05): the pill (lamps and Assists button inside it), its hint, the action row, the Assists popover
  '.sl-drive-pill',
  '.sl-drive-hint',
  '.sl-drive-actions',
  '.sl-drive-aids-panel',
  // phone driver card (12-04, ?screen=1 only)
  '.sl-phone-drive',
];

/** Deliberate stacking inside one feature: the Assists popover opens over the drive hint / action row above the pill. */
const ALLOWED_OVERLAP = new Set(['.sl-drive-aids-panel|.sl-drive-hint', '.sl-drive-aids-panel|.sl-drive-actions']);
const allowed = (a: string, b: string) => ALLOWED_OVERLAP.has(`${a}|${b}`) || ALLOWED_OVERLAP.has(`${b}|${a}`);

interface Box {
  sel: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxes(page: Page): Promise<Box[]> {
  return page.evaluate((sels) => {
    const out: Box[] = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        out.push({ sel, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return out;
  }, HUD);
}

/**
 * Lets entry animations and the HUD fade settle (CSS time) and a few software frames land, so a view switch (a cut
 * under reduced motion, with a 0.25 s dip) is on screen.
 */
const settle = (page: Page) => page.waitForTimeout(2500);

async function expectClean(page: Page, label: string, mustShow: readonly string[]): Promise<Box[]> {
  await settle(page);
  const list = await boxes(page);
  const vp = page.viewportSize()!;
  console.info(`[04-05] ${label}`, list.map((b) => `${b.sel} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}`).join(' | '));
  for (const sel of mustShow) expect.soft(list.map((b) => b.sel), `${label}: ${sel} visible`).toContain(sel);
  const overlaps: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (a.x < 0 || a.y < 0 || a.x + a.w > vp.width + 0.5 || a.y + a.h > vp.height + 0.5) overlaps.push(`${a.sel} leaves the screen`);
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 0.5 && iy > 0.5 && !allowed(a.sel, b.sel)) overlaps.push(`${a.sel} × ${b.sel} (${Math.round(ix)}×${Math.round(iy)} px)`);
    }
  }
  expect.soft(overlaps, label).toEqual([]);
  return list;
}

/**
 * Points outside every HUD box must hit the canvas (no invisible overlay child swallows input). Probe columns and rows
 * come from the measured boxes: a coarse grid plus the middle of every gap between consecutive box edges, so the
 * probes follow the layout instead of fixed coordinates.
 */
async function expectCanvasReachable(page: Page, list: readonly Box[], label: string): Promise<void> {
  const blocked = await page.evaluate((hud) => {
    const out: string[] = [];
    const inside = (x: number, y: number) => hud.some((b) => x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2);
    const probes = (size: number, edges: number[]) => {
      const e = [0, size, ...edges].map((v) => Math.min(size, Math.max(0, v))).sort((a, b) => a - b);
      const at = new Set<number>();
      for (let g = 0.04; g < 0.98; g += 0.08) at.add(Math.round(g * size));
      for (let i = 1; i < e.length; i++) if (e[i]! - e[i - 1]! > 8) at.add(Math.round((e[i]! + e[i - 1]!) / 2));
      return [...at];
    };
    const xs = probes(innerWidth, hud.flatMap((b) => [b.x, b.x + b.w]));
    const ys = probes(innerHeight, hud.flatMap((b) => [b.y, b.y + b.h]));
    for (const x of xs) {
      for (const y of ys) {
        if (inside(x, y)) continue;
        const el = document.elementFromPoint(x, y);
        if (!(el instanceof HTMLCanvasElement) || !el.closest('#stage')) out.push(`${Math.round(x)},${Math.round(y)}: ${el?.className || el?.tagName}`);
      }
    }
    return out;
  }, list);
  expect.soft(blocked, `${label}: canvas reachable outside the HUD`).toEqual([]);
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: join(SHOTS, `${PREFIX}-${name}.png`) });
}

async function boot(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
}

const set = (page: Page, key: string, value: unknown) =>
  page.evaluate(([k, v]) => globalThis.__app!.set(k as never, v as never), [key, value] as const);

test('desktop: follow, close-up and engineer-open layouts never overlap; the canvas stays reachable', async ({ browser }) => {
  test.setTimeout(420_000);
  const page = await (await browser.newContext({ viewport: SIZES[0], deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
  const errors = captureConsole(page);
  await boot(page, '/?e2e=1&quality=low&paused=1&t=20&amp=2.5');
  await set(page, 'overlay', 'engineer');

  for (const size of SIZES) {
    await page.setViewportSize(size);
    const tag = `${size.width}x${size.height}`;
    await set(page, 'view', 'follow');
    await set(page, 'engineerOpen', false);
    // Long explanations and their chip remain in the right column, below the controls and narration toggle.
    await page.evaluate(() => {
      const caption = document.querySelector<HTMLElement>('.sl-insights-caption')!;
      caption.hidden = false;
      caption.querySelector('.sl-insights-text')!.textContent = 'MacPherson dikme → Çift salıncak: uzun dairesel viraj boyunca dış tekerlek daha fazla negatif kamber korur';
      const chip = caption.querySelector<HTMLElement>('.sl-insights-chip')!;
      chip.hidden = false;
      chip.textContent = 'KAMBER SA −0.2° → −0.9°';
    });
    await shot(page, `follow-${tag}`);
    let list = await expectClean(page, `follow ${tag}`, ['.sl-controls-tag', '.sl-telemetry-panel', '.sl-engineer', '.sl-controls-amp', '.sl-insights-caption']);
    await expect(page.locator('.sl-teaching-overlays-trace')).toBeHidden();
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.sl-insights-caption')!.hidden = true;
    });
    await expectCanvasReachable(page, list, `follow ${tag}`);

    await set(page, 'view', 'closeup');
    await page.waitForFunction(() => globalThis.__app!.state().xray === true);
    await shot(page, `closeup-${tag}`);
    list = await expectClean(page, `closeup ${tag}`, ['.sl-telemetry-panel', '.sl-teaching-overlays-trace']);

    await set(page, 'view', 'follow');
    await set(page, 'engineerOpen', true);
    await shot(page, `engineer-${tag}`);
    list = await expectClean(page, `engineer ${tag}`, ['.sl-engineer']);
    await expect(page.locator('.sl-teaching-overlays-trace')).toBeHidden();
    await expectCanvasReachable(page, list, `engineer ${tag}`);
  }

  // Manual Drive (08-03, 09-05): the driving pill with its Assists popover open keeps clear of every other HUD box.
  if (await page.evaluate(() => globalThis.__app!.drive().available)) {
    await set(page, 'view', 'follow');
    await set(page, 'engineerOpen', false);
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().driveMode)).toBe('manual');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const tag = `${size.width}x${size.height}`;
      const aids = page.locator('.sl-drive-aids-btn');
      if ((await aids.getAttribute('aria-expanded')) !== 'true') await aids.click();
      await expect(page.locator('.sl-drive-aids-panel')).toBeVisible();
      await shot(page, `manual-aids-${tag}`);
      const list = await expectClean(page, `manual aids ${tag}`, ['.sl-drive-pill', '.sl-drive-aids-panel', '.sl-telemetry-panel']);
      await expectCanvasReachable(page, list, `manual aids ${tag}`);
    }
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().driveMode)).toBe('auto');
  }

  // Close-up keeps x-ray on: X is explained there instead of turning the body back on in front of the camera.
  await set(page, 'view', 'closeup');
  await page.keyboard.press('x');
  expect((await page.evaluate(() => globalThis.__app!.state())).xray).toBe(true);
  await set(page, 'xray', false);
  await expect.poll(async () => (await page.evaluate(() => globalThis.__app!.state())).xray).toBe(true);

  // Orbit drag with every panel open (engineer panel, trace, telemetry, amp chip).
  await page.setViewportSize(SIZES[0]);
  await set(page, 'view', 'explore');
  await set(page, 'engineerOpen', true);
  await settle(page);
  const canvas = page.locator('#stage canvas').first();
  const box = (await canvas.boundingBox())!;
  const shotBefore = await page.screenshot({ clip: { x: box.x + box.width * 0.35, y: box.y + box.height * 0.3, width: box.width * 0.3, height: box.height * 0.3 } });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width * (0.6 - i * 0.04), box.y + box.height * 0.45);
  await page.mouse.up();
  await page.evaluate(() => globalThis.__app!.advance(0.5));
  await settle(page);
  const shotAfter = await page.screenshot({ clip: { x: box.x + box.width * 0.35, y: box.y + box.height * 0.3, width: box.width * 0.3, height: box.height * 0.3 } });
  expect(shotAfter.equals(shotBefore), 'the drag moved the camera').toBe(false);
  await expectHealthyBoot(page, errors);
});

test('big screen with a live room: tag, presence line, join card, telemetry, poll and engineer all fit', async ({ browser }) => {
  test.setTimeout(420_000);
  const screen = await (await browser.newContext({ viewport: SIZES[0], deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
  const errors = captureConsole(screen);
  await boot(screen, '/?screen=1&quality=low&debug=1&amp=2.5');
  const card = screen.locator('.sl-presenter');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(screen.locator('.sl-live-lab')).toBeVisible({ timeout: 30_000 });
  const code = (await card.locator('.sl-presenter-code').textContent())!;
  const { hostKey } = await screen.evaluate(() => JSON.parse(sessionStorage.getItem('sl-live-lab-screen-room')!) as { hostKey: string });

  // Presenter phone opens a poll so the bars card is on screen too.
  const host = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await host.goto(`/remote.html?room=${code}#k=${hostKey}`);
  await expect(host.locator('.rm-header')).toHaveAttribute('data-status', 'live', { timeout: 30_000 });
  await host.getByRole('button', { name: 'Anketi aç', exact: true }).click();
  await expect(screen.locator('.sl-poll')).toBeVisible({ timeout: 20_000 });
  await set(screen, 'overlay', 'engineer');

  const all = ['.sl-controls-tag', '.sl-live-lab', '.sl-presenter', '.sl-poll', '.sl-telemetry-panel', '.sl-engineer', '.sl-debug-stats', '.sl-phone-drive'];
  for (const size of SIZES) {
    await screen.setViewportSize(size);
    const tag = `${size.width}x${size.height}`;
    await set(screen, 'view', 'follow');
    await set(screen, 'engineerOpen', false);
    await shot(screen, `screen-${tag}`);
    const list = await expectClean(screen, `screen ${tag}`, all);
    await expect(screen.locator('.sl-teaching-overlays-trace')).toBeHidden();
    await expectCanvasReachable(screen, list, `screen ${tag}`);
    await set(screen, 'view', 'closeup');
    await shot(screen, `screen-closeup-${tag}`);
    await expectClean(screen, `screen closeup ${tag}`, ['.sl-presenter', '.sl-poll', '.sl-teaching-overlays-trace']);
    await set(screen, 'view', 'follow');
    await set(screen, 'engineerOpen', true);
    await shot(screen, `screen-engineer-${tag}`);
    await expectClean(screen, `screen engineer ${tag}`, ['.sl-presenter', '.sl-engineer']);
    await expect(screen.locator('.sl-teaching-overlays-trace')).toBeHidden();
  }
  await expectHealthyBoot(screen, errors);
});
