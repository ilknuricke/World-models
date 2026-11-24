import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { EngineerRequest, EngineerResponse } from '../../src/contracts/engineer';
import { createSimulation } from '../../src/sim-core/index';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/06-02-shots';
mkdirSync(SHOTS, { recursive: true });

const sim = createSimulation({
  catalog: { track: () => undefined, vehicle: () => undefined, suspension: () => undefined },
  trackId: 'proving-loop',
  vehicleId: 'gt-coupe',
  suspensionId: 'macpherson',
});
const carousel = sim.track.sections.find((s) => s.id === 'carousel')!;
const APEX = sim.lapTimeAt((carousel.s0 + carousel.s1) / 2).toFixed(3);
const BOOT = `/?e2e=1&paused=1&t=${APEX}&suspension=macpherson`;

async function open(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Mühendise sor' }).click();
  await expect(page.locator('.sl-engineer-panel')).toBeVisible();
}

// Phase gate against the deployed site: ENGINEER_E2E_LIVE=1 PLAYWRIGHT_BASE_URL=<live> runs only the live check.
const mocked = process.env.ENGINEER_E2E_LIVE !== '1';

test.describe('race engineer (mocked endpoint)', () => {
  test.skip(!mocked, 'mocked specs are skipped in the live phase-gate run');

  test('chips follow the section; a model answer is shown as text and its actions drive the app', async ({ page }) => {
    const errors = captureConsole(page);
    let sent: { body: EngineerRequest; clientId: string | undefined } | undefined;
    await page.route('**/api/engineer', async (route) => {
      sent = { body: route.request().postDataJSON() as EngineerRequest, clientId: route.request().headers()['x-client-id'] };
      const res: EngineerResponse = {
        text: 'The strut adds little camber in bump, so the outside front wheel leans with the body. <b>not html</b>',
        actions: [
          { tool: 'switch_suspension', args: { id: 'double-wishbone' } },
          { tool: 'set_view', args: { view: 'closeup', corner: 'fl' } },
        ],
        source: 'model',
      };
      await route.fulfill({ json: res });
    });
    await waitForReady(page, BOOT);
    await open(page);
    const chips = page.locator('.sl-engineer-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(1)).toHaveText('Yalpa merkezi nedir?');

    await chips.first().click();
    const text = page.locator('.sl-engineer-text');
    await expect(text).toHaveText(/leans with the body\. <b>not html<\/b>$/); // rendered as text, never as markup
    await expect(page.locator('.sl-engineer-badge')).toBeHidden();
    await page.screenshot({ path: join(SHOTS, '06-02-model-answer.png') });

    expect(sent!.clientId).toMatch(/^[\w-]{8,64}$/);
    const t = sent!.body.telemetry;
    expect(sent!.body.question).toBe('Burada neden daha fazla yatıyor?');
    expect(t).toMatchObject({ vehicle_class: 'car', vehicle: 'gt-coupe', suspension: 'macpherson', section: 'carousel', section_name: 'Eğimli yarım daire' });
    expect(t.event).toBe('mid-corner, right-hander, outside (left) wheels loaded');
    expect(t.lat_g).toBeLessThan(-0.5);
    expect(Object.keys(t.corners)).toEqual(['fl', 'fr', 'rl', 'rr']);
    expect(t.derived.roll_centre_front_mm).toBeGreaterThan(50);

    await expect.poll(() => page.evaluate(() => globalThis.__app!.state().suspensionId)).toBe('double-wishbone');
    const st = await page.evaluate(() => globalThis.__app!.state());
    expect(st.view).toBe('closeup');
    expect(st.focusCorner).toBe('fl');

    // The second question carries the first exchange as history.
    await page.locator('.sl-engineer-input').fill('And the rear?');
    await page.locator('.sl-engineer-input').press('Enter');
    await expect.poll(() => sent!.body.history.length).toBe(2);
    await expectHealthyBoot(page, errors);
  });

  test('busy (429) and offline show the local rule-based answer, labelled', async ({ page }) => {
    let status = 429;
    await page.route('**/api/engineer', (route) => (status ? route.fulfill({ status, json: { error: 'busy' } }) : route.abort('internetdisconnected')));
    await waitForReady(page, BOOT);
    await open(page);
    await page.getByRole('button', { name: 'Bunu neden yaptı?' }).click();
    await expect(page.locator('.sl-engineer-badge')).toHaveText('Mühendis meşgul · kural tabanlı yanıt');
    await expect(page.locator('.sl-engineer-text')).toHaveText(/^Çember virajda \d\.\d+ g yanal ivmeyle gövde/);
    await page.screenshot({ path: join(SHOTS, '06-02-busy.png') });

    status = 0;
    await page.locator('.sl-engineer-input').fill('Hangi süspansiyon daha iyi?');
    await page.locator('.sl-engineer-input').press('Enter');
    await expect(page.locator('.sl-engineer-badge')).toHaveText('Çevrimdışı · kural tabanlı yanıt');
    await expect(page.locator('.sl-engineer-text')).toHaveText(/^Her koşulda en iyi olan bir tür yoktur/);
    expect(await page.evaluate(() => globalThis.__app!.errors)).toEqual([]);
  });

  test('Escape closes the panel and returns focus to the toggle', async ({ page }) => {
    await waitForReady(page, BOOT);
    await open(page);
    await page.locator('.sl-engineer-input').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.sl-engineer-panel')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Mühendise sor' })).toBeFocused();
  });
});

test('live endpoint answers with a grounded caption (phase gate: ENGINEER_E2E_LIVE=1)', async ({ page }) => {
  test.skip(mocked, 'runs only against a deployed site');
  await waitForReady(page, BOOT);
  await open(page);
  await page.getByRole('button', { name: 'Bunu neden yaptı?' }).click();
  await expect(page.locator('.sl-engineer-answer')).not.toHaveClass(/is-busy/, { timeout: 20_000 });
  const text = await page.locator('.sl-engineer-text').textContent();
  expect(text!.length).toBeGreaterThan(20);
  await page.screenshot({ path: join(SHOTS, '06-02-live.png') });
});
