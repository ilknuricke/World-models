/**
 * 04-04: teaching overlays. With store.overlay = 'engineer' the construction and ghost batches appear; the camber
 * trace appears only in close-up and keeps the previous suspension faint. Close-up defaults the layer on, and
 * nothing logs an error. Saves front-view evidence screenshots per suspension type.
 *
 * Test-only camera (same trick as 03-03): three.js announces renderer/scene to `window.__THREE_DEVTOOLS__`; the
 * spec wraps renderer.render and places the camera in the CAR frame (x forward, y up, z right) while `__shot` is set.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/04-04-shots';
mkdirSync(SHOTS, { recursive: true });
test.use({ deviceScaleFactor: 1 });
test.setTimeout(600_000);

declare global {
  var __THREE_DEVTOOLS__: EventTarget | undefined;
  var __shot: { eye: [number, number, number]; look: [number, number, number]; fov: number } | null | undefined;
  var __three: { scene: any; renderer: any } | undefined;
}

async function installShotCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hook = new EventTarget();
    const found: { scene: any; renderer: any } = { scene: null, renderer: null };
    globalThis.__three = found;
    hook.addEventListener('observe', (e) => {
      const o = (e as CustomEvent).detail;
      if (o?.isScene && !found.scene) found.scene = o;
      if (o && typeof o.render === 'function' && o.domElement && !found.renderer) {
        found.renderer = o;
        const render = o.render.bind(o);
        o.render = (scene: any, camera: any) => {
          const shot = globalThis.__shot;
          const body = found.scene?.getObjectByName('vehicle:db11')?.getObjectByName('body');
          if (shot && body && camera?.isPerspectiveCamera && scene === found.scene) {
            body.updateMatrixWorld(true);
            camera.position.set(...shot.eye);
            body.localToWorld(camera.position);
            const look = camera.position.clone().set(...shot.look);
            body.localToWorld(look);
            camera.up.set(0, 1, 0);
            camera.lookAt(look);
            if (camera.fov !== shot.fov) {
              camera.fov = shot.fov;
              camera.updateProjectionMatrix();
            }
            camera.updateMatrixWorld(true);
          }
          return render(scene, camera);
        };
      }
    });
    globalThis.__THREE_DEVTOOLS__ = hook;
  });
}

/** Overlay objects as the scene holds them: visibility and drawn segment count per layer, all positions finite. */
function overlayState(page: Page) {
  return page.evaluate(() => {
    const g = globalThis.__three!.scene.getObjectByName('teaching-overlays');
    if (!g) return null;
    const layers = g.children.map((o: any) => {
      const n = o.geometry.instanceCount;
      const arr = o.geometry.attributes.instanceStart.data.array as Float32Array;
      let finite = true;
      for (let i = 0; i < n * 6; i++) if (!Number.isFinite(arr[i]!)) finite = false;
      return { name: o.name as string, visible: o.visible as boolean, count: n as number, finite };
    });
    const panel = document.querySelector('.sl-teaching-overlays-trace') as HTMLElement | null;
    return { visible: g.visible as boolean, layers, panel: !!panel && !panel.hidden };
  });
}

async function frame(page: Page): Promise<void> {
  await page.evaluate(() => globalThis.__app!.advance(0.05));
  await page.waitForTimeout(200);
}

async function shot(page: Page, name: string): Promise<void> {
  await frame(page);
  await page.screenshot({ path: join(SHOTS, `04-04-${name}.png`), timeout: 300_000 });
}

const FRONT_VIEW = { eye: [6.5, 0.62, 0] as [number, number, number], look: [1.43, 0.42, 0] as [number, number, number], fov: 24 };

test('engineer overlay: construction lines per suspension, trace keeps the previous type, close-up defaults it on', async ({ page }) => {
  const consoleErrors = captureConsole(page);
  await installShotCamera(page);
  await page.goto('/?e2e=1&quality=low&paused=1&t=20&amp=2.5&suspension=macpherson');
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 240_000 });

  // Off by default (clean layer).
  expect((await overlayState(page))?.visible).toBe(false);

  await page.evaluate(() => {
    globalThis.__app!.set('overlay', 'engineer');
    globalThis.__app!.set('xray', true);
  });
  await page.evaluate((s) => (globalThis.__shot = s), FRONT_VIEW);
  await frame(page);
  const on = await overlayState(page);
  console.log('[04-04] overlay', JSON.stringify(on));
  expect(on?.visible).toBe(true);
  expect(on?.panel).toBe(false); // The global 3D layer does not open a close-up readout in Follow.
  for (const l of on!.layers) {
    expect(l.count, l.name).toBeGreaterThan(20);
    expect(l.finite, l.name).toBe(true);
  }

  for (const id of ['macpherson', 'double-wishbone', 'multilink']) {
    await page.evaluate((s) => globalThis.__app!.set('suspensionId', s), id);
    await frame(page);
    expect(await page.evaluate(() => globalThis.__app!.state().suspensionId)).toBe(id);
    const st = await overlayState(page);
    expect(st!.layers.every((l: { finite: boolean; count: number }) => l.finite && l.count > 0)).toBe(true);
    await shot(page, `front-${id}`);
  }
  // Chase view: the rear axle is nearest the camera and drawn strongest.
  await page.evaluate(() => (globalThis.__shot = { eye: [-7, 1.7, 1.2], look: [0, 0.45, 0], fov: 32 }));
  await shot(page, 'chase-multilink');
  // After two swaps the close-up trace shows multilink with double wishbone faint.
  await page.evaluate(() => globalThis.__app!.set('view', 'closeup'));
  await frame(page);
  expect((await overlayState(page))?.panel).toBe(true);
  await page.locator('.sl-teaching-overlays-trace').screenshot({ path: join(SHOTS, '04-04-trace-after-swap.png'), timeout: 300_000 });

  // Leaving close-up removes the readout without changing the visitor's global 3D layer selection.
  for (const view of ['follow', 'explore'] as const) {
    await page.evaluate((v) => globalThis.__app!.set('view', v), view);
    await frame(page);
    const state = await overlayState(page);
    expect(state?.panel, `${view}: close-up readout hidden`).toBe(false);
    expect(state?.visible, `${view}: 3D engineer layer preserved`).toBe(true);
    expect(await page.evaluate(() => globalThis.__app!.state().overlay)).toBe('engineer');
  }

  // Clean layer hides everything; entering close-up switches the engineer layer back on.
  await page.evaluate(() => globalThis.__app!.set('overlay', 'clean'));
  await frame(page);
  const off = await overlayState(page);
  expect(off?.visible).toBe(false);
  expect(off?.panel).toBe(false);
  await page.evaluate(() => globalThis.__app!.set('view', 'closeup'));
  expect(await page.evaluate(() => globalThis.__app!.state().overlay)).toBe('engineer');
  await frame(page);
  expect((await overlayState(page))?.panel).toBe(true);

  await expectHealthyBoot(page, consoleErrors);
});
