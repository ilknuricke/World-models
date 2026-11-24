/**
 * 12-03 Race Engineer while driving (ARCH-M2 §12.4), endpoint mocked with page.route: a provoked slide on the steering
 * circle makes the panel offer questions about THAT event; the request carries the drive block built at the event
 * (detected label, captured values, inputs before it, the station); model actions that would take the car away from
 * the driver (seek, slow motion, swap) are skipped while the close-up is applied; offline gives the labelled local
 * rule answer for the same event. Analytics is off in e2e (no /api/event request).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { EngineerRequest, EngineerResponse } from '../../src/contracts/engineer';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/12-03-shots';
mkdirSync(SHOTS, { recursive: true });

const intent = (page: Page, i: Record<string, number> | null) => page.evaluate((x) => globalThis.__app!.driveIntent(x), i);
const mode = (page: Page) => page.evaluate(() => globalThis.__app!.state().driveMode);

test.describe('12-03 engineer while driving', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(420_000);

  test('a detected slide grounds the chips, the request and the offline answer; no seeks while driving', async ({ page }) => {
    const errors = captureConsole(page);
    await page.addInitScript(() => setInterval(() => window.dispatchEvent(new Event('pointerdown')), 1000));
    const sent: EngineerRequest[] = [];
    let offline = false;
    let events = 0;
    await page.route('**/api/event', (route) => ((events += 1), route.fulfill({ status: 204 })));
    await page.route('**/api/engineer', async (route) => {
      sent.push(route.request().postDataJSON() as EngineerRequest);
      if (offline) return route.abort();
      const res: EngineerResponse = {
        text: 'Lifting off moved load onto the front tyres, so the lighter rear lost grip and the car rotated.',
        actions: [
          { tool: 'jump_to_section', args: { section: 'carousel' } },
          { tool: 'set_view', args: { view: 'closeup', corner: 'rl' } },
        ],
        source: 'model',
      };
      await route.fulfill({ json: res });
    });

    await waitForReady(page, '/?e2e=1&quality=low&drive=manual&spawn=steering-pad');
    test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'no Manual Drive plant in this build');
    await expect.poll(() => mode(page), { timeout: 60_000 }).toBe('manual');

    // before any event: general driving chips
    await page.getByRole('button', { name: 'Mühendise sor' }).click();
    await expect(page.locator('.sl-engineer-chip').first()).toHaveText('Değiştirince ne değişti?');
    await page.getByRole('button', { name: 'Mühendise sor' }).click();

    // provoke a slide (as the 11-02 coach spec): launch with the assists on, then assists off, full lock, throttle off
    await intent(page, { throttle: 0.5 });
    await page.waitForFunction(() => globalThis.__app!.drive().u > 18, undefined, { timeout: 300_000, polling: 100 });
    await page.evaluate(() => globalThis.__app!.set('driveAids', { abs: false, traction: false, stability: false, steering: false }));
    await intent(page, { steer: 1, throttle: 0 });
    await expect(page.locator('.sl-engineer')).toHaveClass(/is-fresh/, { timeout: 120_000 }); // quiet ring, nothing pops up
    await expect(page.locator('.sl-engineer-panel')).toBeHidden();

    await page.getByRole('button', { name: 'Mühendise sor' }).click();
    const chips = page.locator('.sl-engineer-chip');
    const first = (await chips.first().textContent()) ?? '';
    expect(first).toMatch(/^(Neden spin attım|Arka taraf neden kaydı|Neden virajın dışına açıldı)\?$/);
    const lapBefore = await page.evaluate(() => globalThis.__app!.frame().lapTime);
    await chips.first().click();
    await expect(page.locator('.sl-engineer-text')).toHaveText(/lighter rear lost grip/);
    await page.screenshot({ path: join(SHOTS, '12-03-model-answer.png') });

    const t = sent[0]!.telemetry;
    expect(sent[0]!.question).toBe(first);
    expect(t.drive).toBeDefined();
    expect(t.drive!.mode).toBe('manual');
    expect(t.drive!.detected).toMatch(/slide/);
    expect(t.drive!.detected).not.toMatch(/\d/);
    expect(t.section).toBe('steering-pad');
    expect(t.section_name).toBe('Dairesel sürüş');
    expect(t.event).toMatch(/assists off \(anti-lock, traction, stability, steering help\)/);
    expect(t.derived.event_age_s).toBeGreaterThanOrEqual(0);
    expect(t.derived.throttle_before_pct).toBeGreaterThanOrEqual(0);
    expect(t.drive!.surface).toMatch(/asfalt/i);
    console.log(`[12-03] chip "${first}" -> detected "${t.drive!.detected}", ${t.speed_kmh} km/h, sideslip ${t.drive!.sideslip_deg} deg, throttle before ${t.derived.throttle_before_pct} %`);

    // actions: the close-up applies; the seek is skipped while driving
    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().view)).toBe('closeup');
    expect(await mode(page)).toBe('manual');
    const lapAfter = await page.evaluate(() => globalThis.__app!.frame().lapTime);
    expect(Math.abs(lapAfter - lapBefore)).toBeLessThan(5); // no jump to the carousel

    // offline: the local rule answer for the same event, labelled
    offline = true;
    await page.getByRole('button', { name: 'Bunu neden yaptı?' }).click();
    await expect(page.locator('.sl-engineer-badge')).toHaveText('Çevrimdışı · kural tabanlı yanıt');
    const rule = (await page.locator('.sl-engineer-text').textContent()) ?? '';
    expect(rule).toMatch(/lastik|tutuş/);
    expect(sent[1]!.telemetry.drive!.detected).toBe(t.drive!.detected);
    console.log(`[12-03] offline rule answer: "${rule}"`);
    await page.screenshot({ path: join(SHOTS, '12-03-offline-rule.png') });

    await intent(page, null);
    expect(events).toBe(0); // analytics off in e2e
    // the one aborted request is ours (offline); anything else fails the boot check
    const aborted = errors.filter((e) => /net::ERR_FAILED/.test(e));
    expect(aborted.length).toBeLessThanOrEqual(1);
    await expectHealthyBoot(page, errors.filter((e) => !aborted.includes(e)));
  });
});
