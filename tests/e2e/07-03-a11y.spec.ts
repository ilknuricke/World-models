/**
 * 07-03: keyboard and assistive-tech walkthrough of the HUD. Tab reaches every visible control once (a radiogroup
 * is one stop, arrows move inside it) and each has a name; the focus ring is visible; live regions carry captions
 * only; HUD text measures >= 4.5:1 against what is actually behind it; reduced motion and higher contrast are
 * honoured; at 1024x768 with touch every button has a 44 px target and one-finger orbit moves the camera; the phone
 * remote's targets are >= 44 px; the sound toggle is muted by default, never creates an AudioContext before a
 * gesture, and remembers its state. Targeted assertions (axe is not a dependency).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/07-03-shots';
mkdirSync(SHOTS, { recursive: true });
const BOOT = '/?e2e=1&quality=low&paused=1&t=40';

const advance = (page: Page) => page.evaluate(() => globalThis.__app!.advance(1 / 60));

async function boot(page: Page, path = BOOT): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 90_000 });
  await page.locator('.sl-controls-loading').waitFor({ state: 'detached', timeout: 20_000 });
  await advance(page);
}

/** Counts AudioContext constructions (installed before any app script runs). */
async function countAudioContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __acCount: number; AudioContext?: typeof AudioContext };
    w.__acCount = 0;
    const Base = w.AudioContext;
    if (Base)
      w.AudioContext = class extends Base {
        constructor(options?: AudioContextOptions) {
          super(options);
          w.__acCount++;
        }
      };
  });
}
const acCount = (page: Page) => page.evaluate(() => (globalThis as unknown as { __acCount: number }).__acCount);

/** Visible, enabled, tabbable controls in the overlay, tagged with data-a11y-i; returns their names. */
function tagTabbables(page: Page) {
  return page.evaluate(() => {
    const out: { i: number; name: string; role: string }[] = [];
    const sel = 'button, input, select, textarea, a[href], [tabindex]';
    let i = 0;
    for (const el of document.querySelectorAll<HTMLElement>(`#overlay :is(${sel})`)) {
      if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      el.dataset.a11yI = String(i);
      const by = (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      const name = (el.getAttribute('aria-label') || by || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
      out.push({ i: i++, name, role: el.getAttribute('role') ?? el.tagName.toLowerCase() });
    }
    return out;
  });
}

/** Tabs from the top of the document until focus repeats; returns the data-a11y-i sequence. */
async function tabWalk(page: Page, max = 80): Promise<number[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: number[] = [];
  for (let k = 0; k < max; k++) {
    await page.keyboard.press('Tab');
    const i = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.a11yI ?? null);
    if (i === null) {
      if (seen.length > 0) break; // left the overlay (browser chrome / body): one full lap done
      continue;
    }
    if (seen.includes(Number(i))) break;
    seen.push(Number(i));
  }
  return seen;
}

function luminance([r, g, b]: readonly number[]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Contrast of every visible HUD text run against the pixels actually behind it: text is made transparent (its halo
 * stays), the page is captured, and the 95th-percentile-brightest backdrop pixel of each text box is the background.
 */
async function measureContrast(page: Page) {
  const runs = await page.evaluate(() => {
    const out: { sel: string; color: number[]; x: number; y: number; w: number; h: number; large: boolean }[] = [];
    const walker = document.createTreeWalker(document.getElementById('overlay')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent?.trim() || el.closest('.sl-visually-hidden, .sl-controls-loading, [aria-hidden="true"]')) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      const color = cs.color.match(/[\d.]+/g)!.map(Number);
      const px = parseFloat(cs.fontSize) * (parseFloat(getComputedStyle(document.querySelector('.sl-controls-hud') ?? el).zoom) || 1);
      const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      out.push({ sel: `${el.className || el.tagName}: ${n.textContent.trim().slice(0, 24)}`, color, x: r.x, y: r.y, w: r.width, h: r.height, large });
    }
    // CSSOM, not a <style> tag: the CSP (07-02) blocks inline style elements.
    for (const el of document.querySelectorAll<HTMLElement | SVGElement>('#overlay *')) {
      if (el instanceof SVGSVGElement) el.style.setProperty('visibility', 'hidden', 'important');
      else el.style.setProperty('color', 'transparent', 'important');
    }
    return out;
  });
  const png = (await page.screenshot()).toString('base64');
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement | SVGElement>('#overlay *')) {
      el.style.removeProperty('color');
      if (el instanceof SVGSVGElement) el.style.removeProperty('visibility');
    }
  });
  const backs = await page.evaluate(
    async ({ b64, boxes }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return boxes.map((b) => {
        const d = g.getImageData(Math.floor(b.x), Math.floor(b.y), Math.max(1, Math.ceil(b.w)), Math.max(1, Math.ceil(b.h))).data;
        const px: [number, number, number, number][] = [];
        for (let i = 0; i < d.length; i += 4) px.push([0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!, d[i]!, d[i + 1]!, d[i + 2]!]);
        px.sort((p, q) => p[0] - q[0]);
        const p = px[Math.min(px.length - 1, Math.floor(px.length * 0.95))]!;
        return [p[1], p[2], p[3]];
      });
    },
    { b64: png, boxes: runs },
  );
  return runs.map((r, i) => {
    const bg = backs[i]!;
    // composite semi-transparent text colour over its backdrop
    const a = r.color[3] ?? 1;
    const fg = [0, 1, 2].map((k) => r.color[k]! * a + bg[k]! * (1 - a));
    return { sel: r.sel, ratio: ratio(luminance(fg), luminance(bg)), need: r.large ? 3 : 4.5, bg };
  });
}

test.describe('07-03 accessibility', () => {
  test.describe.configure({ timeout: 600_000 }); // SwiftShader on a loaded machine: ~1 frame/s

  test('keyboard: every control reachable and named, focus ring, radiogroups, live regions, contrast', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const errors = captureConsole(page);
    await countAudioContexts(page);
    await boot(page);

    const tabbables = await tagTabbables(page);
    expect(tabbables.length).toBeGreaterThan(10);
    for (const t of tabbables) expect(t.name, `control ${t.i} (${t.role}) has a name`).not.toBe('');
    const walk = await tabWalk(page);
    expect([...walk].sort((a, b) => a - b), 'Tab reaches every visible control exactly once').toEqual(tabbables.map((t) => t.i));

    // Each radiogroup is one tab stop: the checked radio.
    const radios = await page.evaluate(() =>
      [...document.querySelectorAll('[role="radiogroup"]')].map((g) => [...g.querySelectorAll<HTMLElement>('[role="radio"]')].map((r) => [r.tabIndex, r.getAttribute('aria-checked')])),
    );
    for (const g of radios) expect(g.filter(([ti]) => ti === 0)).toEqual([[0, 'true']]);

    // Focus ring on the suspension control (keyboard focus), then arrows move the selection with focus.
    const susp = page.locator('.sl-controls-susp [role="radio"][aria-checked="true"]');
    const target = Number(await susp.getAttribute('data-a11y-i'));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let k = 0; k <= walk.indexOf(target); k++) await page.keyboard.press('Tab');
    await expect(susp).toBeFocused();
    const ring = await susp.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor, visible: el.matches(':focus-visible') };
    });
    expect(ring).toMatchObject({ style: 'solid', visible: true });
    expect(ring.width).toBeGreaterThanOrEqual(2);
    await advance(page);
    await page.locator('.sl-controls-bc').screenshot({ path: join(SHOTS, '07-03-focus-suspension.png') });
    const before = await page.evaluate(() => globalThis.__app!.state().suspensionId);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().suspensionId)).not.toBe(before);
    await expect(page.locator('.sl-controls-susp [role="radio"][aria-checked="true"]')).toBeFocused();

    // The canvas is one named image; numbers never sit in a live region.
    await expect(page.locator('#stage')).toHaveAttribute('role', 'img');
    await expect(page.locator('#stage')).toHaveAttribute('aria-label', /3D view.*suspension/);
    expect(await page.locator('.sl-insights[aria-live], .sl-telemetry-panel [aria-live], .sl-telemetry-panel[aria-live]').count()).toBe(0);
    const live = await page.evaluate(() => [...document.querySelectorAll('[aria-live]')].map((e) => [e.className, e.getAttribute('aria-live')]));
    for (const [cls, mode] of live) expect(mode, `${cls} is polite`).toBe('polite');

    // Contrast of HUD text against what is behind it (sky, asphalt, car), in follow and explore views.
    for (const view of ['follow', 'explore', 'help card'] as const) {
      if (view === 'help card') await page.keyboard.press('?');
      else await page.evaluate((v) => globalThis.__app!.set('view', v), view);
      await advance(page);
      await advance(page);
      const results = await measureContrast(page);
      expect(results.length).toBeGreaterThan(8);
      const low = results.filter((r) => r.ratio < r.need).map((r) => `${r.sel} ${r.ratio.toFixed(2)} on rgb(${r.bg.join(',')})`);
      console.log(`[07-03] ${view}: ${results.length} text runs, min ratio ${Math.min(...results.map((r) => r.ratio)).toFixed(2)}`);
      expect(low, `${view}: text below 4.5:1`).toEqual([]);
    }
    await page.keyboard.press('Escape');

    // Sound: muted by default, no AudioContext before a gesture; M turns it on (pressed, persisted).
    const mute = page.locator('.sl-audio-btn');
    await expect(mute).toBeVisible();
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await expect(mute).toHaveAccessibleName('Sound');
    expect(await acCount(page)).toBe(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('m');
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    expect(await acCount(page)).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('sl-audio'))).toBe('on');
    await advance(page);
    await page.locator('.sl-controls-tr').screenshot({ path: join(SHOTS, '07-03-mute-toggle.png') });
    await page.keyboard.press('?');
    await expect(page.locator('.sl-controls-help')).toContainText('Sesi aç / kapat');
    await page.keyboard.press('Escape');

    // Reload: remembered as on, but still no AudioContext until the visitor's first gesture.
    await boot(page);
    await expect(page.locator('.sl-audio-btn')).toHaveAttribute('aria-pressed', 'true');
    expect(await acCount(page)).toBe(0);
    await page.mouse.click(640, 400);
    await expect.poll(() => acCount(page)).toBe(1);
    await page.locator('.sl-audio-btn').click();
    await expect(page.locator('.sl-audio-btn')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => localStorage.getItem('sl-audio'))).toBe('off');
    await expectHealthyBoot(page, errors);
  });

  test('reduced motion and higher contrast', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = captureConsole(page);
    await boot(page);
    const s = await page.evaluate(() => globalThis.__app!.state());
    expect(s.reducedMotion).toBe(true);
    expect(s.attract).toBe(false);
    await page.keyboard.press('?');
    const motion = await page.evaluate(() => ({
      thumb: getComputedStyle(document.querySelector('.sl-controls-thumb')!).transitionDuration,
      help: getComputedStyle(document.querySelector('.sl-controls-help')!).animationDuration,
      hud: getComputedStyle(document.querySelector('.sl-controls-hud')!).transitionDuration,
    }));
    expect(motion.thumb.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
    expect(parseFloat(motion.help)).toBe(0);
    expect(motion.hud.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
    await page.keyboard.press('Escape');

    const glass = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass').trim());
    const normal = await glass();
    await page.emulateMedia({ contrast: 'more' });
    expect(await glass()).not.toBe(normal); // denser glass (the build minifies the colour, so compare)
    await expectHealthyBoot(page, errors);
    await context.close();
  });

  test('tablet 1024x768 with touch: 44 px targets, no overlaps, one-finger orbit', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = captureConsole(page);
    await boot(page, `${BOOT}&amp=2.5`);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#overlay button, #overlay input')]
        .filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
        .map((el) => {
          const r = el.getBoundingClientRect();
          const after = getComputedStyle(el, '::after');
          const w = Math.max(r.width, parseFloat(after.width) || 0);
          const h = Math.max(r.height, parseFloat(after.height) || 0);
          return { name: el.getAttribute('aria-label') || el.textContent?.trim() || el.className, w, h };
        })
        .filter((t) => t.w < 44 || t.h < 44),
    );
    expect(small, 'touch targets under 44 px').toEqual([]);

    const HUD = ['.sl-controls-tag', '.sl-controls-tr', '.sl-controls-amp', '.sl-controls-bc', '.sl-controls-br', '.sl-telemetry-panel', '.sl-engineer', '.sl-teaching-overlays-trace'];
    const boxes = await page.evaluate((sels) => {
      const out: { sel: string; x: number; y: number; w: number; h: number }[] = [];
      for (const sel of sels)
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
          const r = el.getBoundingClientRect();
          if (r.width >= 1 && r.height >= 1) out.push({ sel, x: r.x, y: r.y, w: r.width, h: r.height });
        }
      return out;
    }, HUD);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i]!;
        const q = boxes[j]!;
        expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `${p.sel} overlaps ${q.sel}`).toBe(false);
      }
    for (const b of boxes) expect(b.x + b.w, `${b.sel} on screen`).toBeLessThanOrEqual(1024);
    await advance(page);
    await page.screenshot({ path: join(SHOTS, '07-03-tablet-1024x768.png') });

    // Explore view: a one-finger drag on the canvas orbits the camera.
    await page.locator('.sl-controls-view [data-id="explore"]').tap();
    await advance(page);
    await advance(page);
    const view = await page.evaluate(() => globalThis.__app!.state().view);
    expect(view).toBe('explore');
    const canvas = page.locator('#stage canvas').first();
    const before = await canvas.screenshot();
    const cdp = await context.newCDPSession(page);
    const pts = [
      [520, 420],
      [600, 420],
      [680, 425],
      [760, 430],
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0]![0]!, y: pts[0]![1]! }] });
    for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x!, y: y! }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    for (let k = 0; k < 6; k++) await page.evaluate(() => globalThis.__app!.advance(0.1));
    const after = await canvas.screenshot();
    expect(after.equals(before), 'the camera moved after a one-finger drag').toBe(false);
    await expectHealthyBoot(page, errors);
    await context.close();
  });

  test('phone remote: every target at least 44 px', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto('/remote.html?room=ZZZZZ');
    await page.locator('button, input').first().waitFor();
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, input, a[href]')]
        .filter((el) => el.checkVisibility())
        .map((el) => ({ name: el.getAttribute('aria-label') || el.textContent?.trim() || el.className, ...el.getBoundingClientRect().toJSON() }) as { name: string; width: number; height: number })
        .filter((r) => r.width < 44 || r.height < 44),
    );
    expect(small).toEqual([]);
    await context.close();
  });
});
