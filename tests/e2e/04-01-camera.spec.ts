/**
 * 04-01: camera views and attract mode in the real app. Reduced motion is emulated so view switches are fade-cuts
 * (blends are covered frame by frame in tests/features/camera.test.ts; SwiftShader renders a frame per second or so).
 * The camera pose is read through three's devtools hook (renderer.render wrapper) and expressed in the car body frame.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/04-01-shots';
mkdirSync(SHOTS, { recursive: true });
test.use({ deviceScaleFactor: 1, viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
test.setTimeout(900_000);

declare global {
  var __THREE_DEVTOOLS__: EventTarget | undefined;
  var __scene0401: { scene: any; renderer: any; camera: any } | undefined;
}

async function installHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hook = new EventTarget();
    const found: { scene: any; renderer: any; camera: any } = { scene: null, renderer: null, camera: null };
    globalThis.__scene0401 = found;
    hook.addEventListener('observe', (e) => {
      const o = (e as CustomEvent).detail;
      if (o?.isScene && !found.scene) found.scene = o;
      if (o && typeof o.render === 'function' && o.domElement && !found.renderer) {
        found.renderer = o;
        const render = o.render.bind(o);
        o.render = (scene: any, camera: any) => {
          if (scene === found.scene && camera?.isPerspectiveCamera) found.camera = camera;
          return render(scene, camera);
        };
      }
    });
    globalThis.__THREE_DEVTOOLS__ = hook;
  });
}

/** Waits for n rendered frames. */
const frames = (page: Page, n: number) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let k = 0;
        const f = () => (++k >= count ? resolve() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

/** Camera position in the car body frame (x forward, y up, z right) and its FOV. */
const cameraInBody = (page: Page) =>
  page.evaluate(() => {
    const { scene, camera } = globalThis.__scene0401!;
    const body = scene.getObjectByName('vehicle:db11').getObjectByName('body');
    body.updateMatrixWorld(true);
    const p = body.worldToLocal(camera.position.clone());
    return { x: p.x as number, y: p.y as number, z: p.z as number, fov: camera.fov as number };
  });

async function settled(page: Page): Promise<void> {
  await frames(page, 2);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.sl-camera-fade, .sl-attract-fade')].every((e) => Number(e.style.opacity || 0) === 0), undefined, { timeout: 120_000 });
}

const shot = async (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `04-01-${name}.png`) });

/** Errors recorded against this plan's features (other features are being built in parallel). */
const ownErrors = (page: Page) =>
  page.evaluate(() => {
    const app = globalThis.__app!;
    const mine = app.features().filter((f) => f.id === 'camera' || f.id === 'attract');
    return {
      enabled: mine.map((f) => `${f.id}:${f.enabled}`),
      errors: [...mine.flatMap((f) => (f.error ? [f.error] : [])), ...app.errors.filter((e) => /camera|attract|CameraControls/i.test(e))],
      others: app.errors,
    };
  });

test('views: chase behind the car, orbit by drag, close-up into the wheel well with x-ray', async ({ page }) => {
  const consoleErrors = captureConsole(page);
  await installHook(page);
  await page.goto('/?e2e=1&quality=low&paused=1&t=24');
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 180_000 });

  // Follow (default): behind and above the car, looking at it.
  await settled(page);
  const chase = await cameraInBody(page);
  console.info('[04-01] chase', chase);
  expect(chase.x).toBeLessThan(-4);
  expect(chase.x).toBeGreaterThan(-10);
  expect(chase.y).toBeGreaterThan(1);
  expect(Math.abs(chase.z)).toBeLessThan(2.5);
  await shot(page, 'chase');

  // Explore: drag on the canvas orbits around the car.
  await page.evaluate(() => globalThis.__app!.set('view', 'explore'));
  await settled(page);
  const before = await cameraInBody(page);
  const box = (await page.locator('#stage canvas').first().boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width * (0.5 - i * 0.045), box.y + box.height * (0.5 - i * 0.01));
  await page.mouse.up();
  await frames(page, 12);
  const orbit = await cameraInBody(page);
  console.info('[04-01] orbit', before, '->', orbit);
  const azimuth = (p: { x: number; z: number }) => Math.atan2(p.z, p.x);
  expect(Math.abs(azimuth(orbit) - azimuth(before))).toBeGreaterThan(0.3);
  // Still orbiting the car, not wandering off.
  expect(Math.hypot(orbit.x, orbit.y, orbit.z)).toBeLessThan(15);
  await shot(page, 'orbit');

  // Close-up front-left: ahead of the front axle, above the hub on the left (three -z), x-ray switched on.
  await page.evaluate(() => {
    globalThis.__app!.set('focusCorner', 'fl');
    globalThis.__app!.set('view', 'closeup');
  });
  await settled(page);
  const close = await cameraInBody(page);
  console.info('[04-01] closeup fl', close);
  expect(await page.evaluate(() => globalThis.__app!.state().xray)).toBe(true);
  expect(close.x).toBeGreaterThan(2.3);
  expect(close.z).toBeLessThan(0);
  expect(close.y).toBeGreaterThan(0.6);
  expect(close.y).toBeLessThan(1.3);
  await frames(page, 4); // x-ray fade (0.4 s; instant under reduced motion)
  await shot(page, 'closeup-xray');

  // Rear-right via the camera:focus request (the AI engineer and presenter path).
  await page.evaluate(() => globalThis.__app!.set('focusCorner', 'rr'));
  await settled(page);
  const rear = await cameraInBody(page);
  console.info('[04-01] closeup rr', rear);
  expect(rear.x).toBeLessThan(-2.3);
  expect(rear.z).toBeGreaterThan(0);

  // Leaving the close-up restores x-ray.
  await page.evaluate(() => globalThis.__app!.set('view', 'follow'));
  await settled(page);
  expect(await page.evaluate(() => globalThis.__app!.state().xray)).toBe(false);

  const own = await ownErrors(page);
  if (own.others.length) console.info('[04-01] errors from other features (not asserted):', own.others);
  expect(own.enabled.sort()).toEqual(['attract:true', 'camera:true']);
  expect(own.errors).toEqual([]);
  expect(consoleErrors.filter((e) => /camera|attract/i.test(e))).toEqual([]);
});

test('attract: storyboard drives captions, shots and the store; any input restores the visitor state', async ({ page }) => {
  await installHook(page);
  await page.goto('/?e2e=1&quality=low&paused=1&t=60&view=explore');
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 180_000 });
  const before = await page.evaluate(() => globalThis.__app!.state());

  await page.evaluate(() => globalThis.__app!.set('attract', true));
  const caption = page.locator('.sl-attract-caption');
  await expect(caption).toHaveText('Her tümsek bir geometri problemidir.', { timeout: 60_000 });
  await expect(page.locator('.sl-attract-title')).toBeVisible();
  const during = await page.evaluate(() => globalThis.__app!.state());
  expect(during.paused).toBe(false);
  expect(during.view).toBe('follow');
  await settled(page);
  await shot(page, 'attract-hero');

  // Beat 2 starts after 8 s of wall-clock frames: seek to the bump strip, close-up with x-ray.
  await expect(caption).toHaveText('Tümsekte bağlantıların nasıl çalıştığını izleyin.', { timeout: 600_000 });
  const beat2 = await page.evaluate(() => ({ state: globalThis.__app!.state(), frame: globalThis.__app!.frame() }));
  console.info('[04-01] beat 2', beat2.frame.sectionId, beat2.frame.lapTime.toFixed(2));
  expect(beat2.state.xray).toBe(true);
  expect(beat2.state.clock).toBe('local');
  await settled(page);
  await frames(page, 3);
  await shot(page, 'attract-closeup');

  // Any input exits and restores every key attract touched.
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => globalThis.__app!.state().attract === false, undefined, { timeout: 60_000 });
  await expect(page.locator('.sl-attract')).toBeHidden();
  const after = await page.evaluate(() => globalThis.__app!.state());
  for (const key of ['view', 'focusCorner', 'xray', 'overlay', 'amplification', 'timeScale', 'paused', 'suspensionId'] as const) expect(after[key]).toEqual(before[key]);
  const own = await ownErrors(page);
  expect(own.errors).toEqual([]);
});
