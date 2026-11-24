import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSimulation } from '../../src/sim-core/index';
import { captureConsole, expectHealthyBoot } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/04-02-shots';
mkdirSync(SHOTS, { recursive: true });

const sim = createSimulation({
  catalog: { track: () => undefined, vehicle: () => undefined, suspension: () => undefined },
  trackId: 'proving-loop',
  vehicleId: 'gt-coupe',
  suspensionId: 'double-wishbone',
});
const carousel = sim.track.sections.find((s) => s.id === 'carousel')!;
const APEX = sim.lapTimeAt((carousel.s0 + carousel.s1) / 2).toFixed(3);
const BOOT = `/?e2e=1&quality=low&paused=1&t=${APEX}`;

const state = (page: Page) => page.evaluate(() => globalThis.__app!.state());
const camber = (page: Page) => page.evaluate(() => globalThis.__app!.frame().corners.map((c) => c.camber));
/** Renders one deterministic frame (SwiftShader frames take seconds; never wait on wall-clock animation). */
const advance = (page: Page) => page.evaluate(() => globalThis.__app!.advance(1 / 60));

async function boxes(page: Page, selectors: readonly string[]) {
  return page.evaluate((sels) => {
    const out: { sel: string; x: number; y: number; w: number; h: number }[] = [];
    for (const sel of sels)
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none') out.push({ sel, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    return out;
  }, selectors);
}

/** Visible HUD pieces must not overlap each other or the other bottom-left/overlay UI. */
async function expectNoOverlap(page: Page) {
  const b = await boxes(page, ['.sl-controls-tag', '.sl-controls-tr', '.sl-controls-bc', '.sl-controls-br', '.sl-controls-amp', '.sl-engineer', '.sl-live-lab']);
  const vw = page.viewportSize()!;
  for (const x of b) {
    expect(x.x, `${x.sel} inside viewport`).toBeGreaterThanOrEqual(0);
    expect(x.x + x.w, `${x.sel} inside viewport`).toBeLessThanOrEqual(vw.width);
    expect(x.y + x.h, `${x.sel} inside viewport`).toBeLessThanOrEqual(vw.height);
  }
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) {
      const p = b[i]!;
      const q = b[j]!;
      const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
      expect(overlap, `${p.sel} overlaps ${q.sel}`).toBe(false);
    }
}

test.describe('04-02 HUD controls', () => {
  test.setTimeout(300_000);

  test('loading overlay shows progress and leaves after the first frame', async ({ page }) => {
    const errors = captureConsole(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BOOT);
    const loading = page.locator('.sl-controls-loading');
    await expect(loading).toBeVisible({ timeout: 30_000 });
    await expect(loading.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '100');
    await page.screenshot({ path: join(SHOTS, '04-02-loading.png') });
    await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
    await expect(loading).toHaveCount(0, { timeout: 30_000 });
    await expectHealthyBoot(page, errors);
  });

  test('one click or one key swaps suspension and view; time, amplification and HUD keys work', async ({ page }) => {
    const errors = captureConsole(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BOOT);
    await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
    await expect(page.locator('.sl-controls-loading')).toHaveCount(0, { timeout: 30_000 });

    const susp = page.getByRole('radiogroup', { name: 'Süspansiyon' });
    await expect(susp.getByRole('radio')).toHaveText([/MacPherson dikme/, /Çift salıncak/, /Çok bağlantılı/]);
    await expect(susp.getByRole('radio', { name: 'Çift salıncak' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.sl-controls-name')).toHaveText('GT kupe');
    await expect(page.locator('.sl-controls-sub')).toContainText('Temsili parametreler');

    // one click: store and the simulated frame change
    await advance(page);
    const before = await camber(page);
    await susp.getByRole('radio', { name: 'MacPherson dikme' }).click();
    expect((await state(page)).suspensionId).toBe('macpherson');
    await advance(page);
    expect(await camber(page)).not.toEqual(before);
    await expect(page.locator('.sl-controls-descriptor')).toHaveText('Kompakt ve hafif. Kamber gövdenin yatmasını izler.');

    // keys
    await page.keyboard.press('3');
    expect((await state(page)).suspensionId).toBe('multilink');
    await expect(susp.getByRole('radio', { name: 'Çok bağlantılı' })).toHaveAttribute('aria-checked', 'true');
    // arrow keys inside the radiogroup (roving tabindex)
    await susp.getByRole('radio', { name: 'Çok bağlantılı' }).focus();
    await page.keyboard.press('ArrowLeft');
    expect((await state(page)).suspensionId).toBe('double-wishbone');
    await expect(susp.getByRole('radio', { name: 'Çift salıncak' })).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await page.keyboard.press('c');
    expect((await state(page)).view).toBe('closeup');
    await page.getByRole('radiogroup', { name: 'Kamera' }).getByRole('radio', { name: 'Keşfet' }).click();
    expect((await state(page)).view).toBe('explore');
    await page.keyboard.press('f');
    expect((await state(page)).view).toBe('follow');
    await page.keyboard.press('x');
    expect((await state(page)).xray).toBe(true);
    await page.keyboard.press('x');

    // amplification is always labelled; one tap back to true scale
    await page.keyboard.press('a');
    expect((await state(page)).amplification).toBe(2.5);
    const amp = page.locator('.sl-controls-amp');
    await expect(amp).toBeVisible();
    await expect(amp).toContainText('Hareket ×2.5 · değerler gerçek ölçekte');
    await page.keyboard.press('h'); // the chip survives a hidden HUD
    await expect(amp).toBeVisible();
    await expect(page.locator('.sl-controls-tag')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Kontrolleri göster' })).toBeVisible();
    await page.keyboard.press('h');
    await expect(page.locator('.sl-controls-tag')).toBeVisible();
    await amp.getByRole('button', { name: 'Gerçek ölçek' }).click();
    expect((await state(page)).amplification).toBe(1);
    await expect(amp).toBeHidden();

    // time: paused boot is off the live clock; Space plays, S slows, Live rejoins
    const live = page.locator('.sl-controls-live');
    await expect(live).toHaveText('Canlıya dön');
    await page.keyboard.press(' ');
    expect((await state(page)).paused).toBe(false);
    await page.keyboard.press('s');
    let s = await state(page);
    expect([s.timeScale, s.clock]).toEqual([0.25, 'local']);
    await expect(page.locator('.sl-controls-slow')).toHaveAttribute('aria-pressed', 'true');
    await live.click();
    s = await state(page);
    expect([s.paused, s.timeScale, s.clock]).toEqual([false, 1, 'live']);
    await expect(live).toHaveText('Canlı');
    const t0 = (await page.evaluate(() => globalThis.__app!.frame())).lapTime;
    await expect.poll(async () => (await page.evaluate(() => globalThis.__app!.frame())).lapTime, { timeout: 60_000 }).not.toBe(t0);
    await page.keyboard.press(' ');
    expect((await state(page)).paused).toBe(true);
    await expect(page.getByRole('button', { name: 'Oynat' })).toBeVisible();

    // shortcut card
    await page.keyboard.press('?');
    const help = page.getByRole('region', { name: 'Klavye kısayolları' });
    await expect(help).toBeVisible();
    await help.getByRole('button', { name: /İç görünüm/ }).click();
    expect((await state(page)).xray).toBe(true);
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    // vehicle toggle only when another vehicle class is registered
    const toggle = page.locator('.sl-controls-vehicle');
    if (await toggle.isVisible()) {
      const id = (await state(page)).vehicleId;
      await page.keyboard.press('v');
      expect((await state(page)).vehicleId).not.toBe(id);
    } else {
      await page.keyboard.press('v');
      expect((await state(page)).vehicleId).toBe('gt-coupe');
    }

    await expectHealthyBoot(page, errors);
  });

  for (const vp of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    test(`layout ${vp.width}x${vp.height}: nothing overlaps; screenshot`, async ({ page }) => {
      const errors = captureConsole(page);
      await page.setViewportSize(vp);
      await page.goto(BOOT);
      await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
      await expect(page.locator('.sl-controls-loading')).toHaveCount(0, { timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => globalThis.__app!.set('amplification', 2.5)); // show every HUD piece
      await advance(page);
      await expectNoOverlap(page);
      await page.screenshot({ path: join(SHOTS, `04-02-hud-${vp.width}x${vp.height}.png`) });
      await expectHealthyBoot(page, errors);
    });
  }

  test('credits panel: reachable in one click, exact DB11 and Chrono notices, Esc closes', async ({ page }) => {
    const errors = captureConsole(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BOOT);
    await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
    await expect(page.locator('.sl-controls-loading')).toHaveCount(0, { timeout: 30_000 });
    await page.locator('.sl-controls-tag').getByRole('button', { name: 'Katkıda bulunanlar' }).click();
    const panel = page.getByRole('dialog', { name: 'Katkıda bulunanlar' });
    await expect(panel).toBeVisible();
    expect((await state(page)).creditsOpen).toBe(true);
    await expect(panel).toContainText(
      '"Aston Martin db11" — Black Snow (https://sketchfab.com/BlackSnow02). CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/) koşullarıyla lisanslanmıştır. Kaynak: https://sketchfab.com/3d-models/aston-martin-db11-0ce56f01b1ff40b3a4e36bc56873dbc7. Değişiklikler: optimize edildi ve sıkıştırıldı (meshopt), çokgen sayısı azaltıldı, malzemeler yenilendi, logolar gizlendi.',
    );
    await expect(panel).toContainText('Copyright (c) 2016, Project Chrono Development Team');
    await expect(panel).toContainText('Neither the name of the nor the names of its contributors');
    await expect(panel.getByRole('button', { name: 'Katkıda bulunanları kapat' })).toBeFocused();
    await advance(page);
    await page.screenshot({ path: join(SHOTS, '04-02-credits.png') });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    expect((await state(page)).creditsOpen).toBe(false);
    await expectHealthyBoot(page, errors);
  });
});
