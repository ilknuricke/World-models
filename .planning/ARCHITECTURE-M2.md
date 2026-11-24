# Suspension Lab — Architecture Addendum M2: Manual Drive

**Status:** BINDING for every M2 planner and executor. Written 2026-11-21 from `.planning/research/m2/SUMMARY.md`
(binding decisions), research m2/01–24, the M1 contract `.planning/ARCHITECTURE.md` and the code as it stands after
phase 7 (read where precision mattered: contracts, sim-core, kernel, camera, controls, room DO).
**Authority:** research/m2/SUMMARY.md > this addendum > ARCHITECTURE.md > research files. Where this addendum is silent,
ARCHITECTURE.md applies unchanged (layering, naming, Ponytail rules §19, deploy §17, honesty §14 …).
**Change control:** the code blocks under headings `### C<n>` (contracts) and `### F<n>` (registration file) are created
VERBATIM by plan 08-01 and are then FROZEN; the `### W<n>` blocks (worker frozen files) are created verbatim by plan
12-01. Any further change is an R4 architectural change: stop, report, and the orchestrator runs it as its own plan in
its own wave. `tests/arch/contracts-verbatim.test.ts` is extended (08-01, then 12-01) so that an M2 block supersedes the
M1 §5 / §9.1 / §12.1 / §12.2 block for the same file (§5.0 below).

Contents: §0 decisions · §1 stack and lifted code · §2 layering · §3 tree and ownership · §4 signs · §5 contract source ·
§6 kernel · §7 sim-core Manual Drive (plant, tyre, compliance, powertrain, aids, drivers, modes, determinism, safety,
replay, ghost, content) · §8 GroundWorld and the proving-ground annex · §9 features · §10 experience spec · §11 validation
matrix · §12 Cloudflare · §13 honesty · §14 budgets · §15 risks, fallbacks, cut order · §16 open questions

---

## 0. Decisions (binding summary)

1. **Auto is untouched.** In mode `auto` the simulation runs exactly the M1 code path (`stateAt(t)` rails, live clock,
   pre-roll seeks). The M1 golden hashes (`tests/sim-core/golden.test.ts`, moto goldens) must not change in any M2 plan;
   a plan that changes one stops (R4) with an analysis.
2. **One car, one plant.** Manual Drive is a 14-DOF plant built INSIDE the existing car model: planar x, y, yaw + the
   unchanged `ride7dof` + 4 wheel spins, reading the same `CarDefinition`, `prepareCarSuspension` tables, `createRideModel`
   and `peakMu()`. Suspension type changes the driven car only through the tables (camber, toe/steer, RC/IC lines,
   anti-pitch, motion ratio), the per-type extras (strut friction, unsprung delta) and compliance derived from the same
   hardpoints with ONE shared bushing table. No per-type handling constant exists anywhere.
3. **Modes** `auto | manual | returning | replay` live in sim-core (`Simulation.drive`); the kernel is the only caller of
   mode changes and mirrors the mode into `store.driveMode`; features request changes on the bus.
4. **Drivers** produce a `DriveCommand` every fixed step: `HumanDriver` (conditioned, quantised device intents latched at
   60 Hz) and `PathDriver` (Stanley + curvature feed-forward + profile speed + 5-state recovery). Returning = PathDriver on
   a detached lap clock, then a latch back to the rails; "Rejoin live" is the M1 live seek behind a short fade.
5. **Ground** is one pure-TS analytic `GroundWorld` (loop corridor via projection onto the existing `roadHeight`, world
   zones, terrain) used by the plant AND by the renderer. The annex lies north of the real loop (§8).
6. **Determinism:** no transcendental `Math.*` (and no non-integer `**`) anywhere in `src/sim-core` once 09-03 lands;
   own kernels in `sim-core/math/det.ts`. Same build ⇒ bit-identical in Node and Chromium (CI). Firefox/WebKit are not
   installed in this environment: documented gap; replays carry keyframe CRCs and resync snapshots.
7. **Replays** are quantised intents (60 Hz) + a float64 start snapshot + events + keyframe CRCs; fragment links for
   ≤ 60 s, D1 for longer. Moment replay and the A/B ghost are built on the same re-simulation.
8. **Car first.** The motorcycle stays Auto-only in M2 (`drive.available === false`).
9. **No new npm dependencies.** Lifted code is small, permissively licensed and credited (§1).
10. **Experiments, not competition.** No timers, scores or rankings anywhere (product rule).

## 1. Stack and lifted code

No `package.json` change in M2. Platform APIs used: `CompressionStream('deflate-raw')`, `Uint8Array.prototype.toBase64`
(feature-detected, `btoa` fallback), Gamepad API, Pointer Events, DeviceMotion (phone remote), Screen Wake Lock (phone
remote), Turnstile script `https://challenges.cloudflare.com/turnstile/v0/api.js` (CSP change in 12-01).

| Source (verify LICENSE at lift time) | Licence | What may be lifted | Into |
|---|---|---|---|
| stdlib-js `@stdlib/math/base/special/{kernel-sin,kernel-cos,kernel-tan,atan,atan2,asin,acos,exp,ln,pow,tanh}` (fdlibm ports) | Apache-2.0 + Sun fdlibm notice | polynomial kernels and argument reduction (Cody–Waite for abs(x) ≤ 2^20·π/2; larger arguments are never passed — assert) | `sim-core/math/det.ts` (08-02) |
| Jolt Physics `VehicleTransmission.cpp`, `VehicleDifferential.cpp` | MIT (Jorrit Rouwe) | shift state machine shape, LSD ratio formula | `sim-core/drive/powertrain.ts` (08-02, 09-02) |
| Godot-Easy-Vehicle-Physics `vehicle.gd`/`wheel.gd` | MIT (D. Shoemaker, Dechode) — re-verify | aid/steering shapes only if code is lifted; ideas otherwise | `sim-core/drive/{aids,human-driver}.ts` |
| PythonRobotics `stanley_control.py`, `pure_pursuit.py` | MIT (Atsushi Sakai) | Stanley law structure | `sim-core/drive/path-driver.ts` (10-01) |
| icurtis1/raycast-vehicle `src/main.js` | MIT (Ian Curtis) | chase decay constants pattern | `features/camera` (08-04) |
| brunosimon/folio-2025 `Tracks.js` | MIT | skid-ribbon ring-buffer pattern | `features/tyre-vfx` (11-01) |
| Project Chrono (`ChPac02Tire`, `ChFialaTire`) | BSD-3-Clause | MF/Fiala structure ideas; low-speed epsilon idea | `sim-core/drive/tyre.ts` (09-01) |

Ideas only (never copy): VDrift, Speed Dreams (GPL), LibreCorsa (AGPL), Gaffer on Games, Slow Roads, books, MATLAB docs,
CommonRoad (licence unverified), AirConsole. Every lift: a header comment with source URL, copyright line and SPDX id;
the executor lists it in its SUMMARY; 13-01 consolidates `CREDITS.md` and `src/features/credits/code-credits.ts`.

## 2. Layering changes (enforced by `.dependency-cruiser.cjs`, edited by 08-01)

- `sim-core-pure`: sim-core may import `src/contracts/(units|suspension|vehicle|track|telemetry|sim|drive|world).ts`
  (adds `drive`, `world`). New pathNot: `'^src/(sim-core/|contracts/(units|suspension|vehicle|track|telemetry|sim|drive|world)\\.ts$)'`.
- Features may import any `src/sim-core/**` module by path (already allowed; M2 uses `sim-core/replay/format.ts`,
  `sim-core/ghost/ghost.ts`, `sim-core/world/*`, `sim-core/drive/script.ts`). Features still never import each other.
- `worker/` may import `src/contracts/{drive,world}.ts` and `src/sim-core/replay/format.ts` (pure). No change to the rule
  text is needed (only client layers are forbidden).
- New arch test `tests/arch/det-math.test.ts` (08-02 creates for `src/sim-core/{drive,world}/**` and `math/det.ts`;
  09-03 widens it to all of `src/sim-core`): fails on `/\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/`
  and on `**` whose right operand is not an integer literal (`/\*\*\s*(?![-+]?\d+\b(?!\.))/`), with a self-check like
  `purity.test.ts`. `Math.sqrt|abs|min|max|floor|ceil|round|trunc|sign|fround|imul` stay allowed (exact in IEEE-754).
- New arch test `tests/arch/no-type-tuning.test.ts` (08-02): no suspension content id
  (`macpherson|double-wishbone|multilink|moto-[a-z]+`) and no `suspension.id`/`.id ===` comparison appears in
  `src/sim-core/drive/**`, `src/sim-core/world/**` or the handling content files.

## 3. Directory tree additions and file ownership

Owner = plan that creates the file; `→` later owners (different waves/phases only). A plan edits only files it owns
(ROADMAP-M2 lists them per plan); within a wave owned sets are disjoint. `(x)` = existing M1 file that M2 changes.

```
src/
├─ app/features.ts (x)                 08-01            29 lines (§F1)
├─ contracts/
│  ├─ drive.ts                         08-01  frozen    §C1
│  ├─ world.ts                         08-01  frozen    §C2
│  └─ sim.ts telemetry.ts vehicle.ts store.ts events.ts app.ts services.ts net.ts engineer.ts (x)   08-01 frozen §C3–C11
├─ kernel/ (x) app.ts loop.ts sim-host.ts flags.ts registry.ts test-hooks.ts   08-01
├─ sim-core/
│  ├─ index.ts (x)                     08-01 (export runDriveScript)
│  ├─ math/det.ts                      08-02            deterministic kernels
│  ├─ math/{interp,mat,quat,rng,vec3,linsolve}.ts (x)   09-03 (det sweep)
│  ├─ world/terrain.ts                 08-02            M1 terrain height moved from features/track (verbatim maths)
│  ├─ world/project.ts                 08-02            loop projection (Frenet)
│  ├─ world/ground.ts                  08-02 → 10-02    buildGroundWorld (loop + terrain; zones, field, bounds in 10-02)
│  ├─ world/zones.ts                   10-02            rect/path footprints, zone-local features, patches, blends
│  ├─ drive/script.ts                  08-01            seeded scripted drive + state hash (test hook, CI)
│  ├─ drive/types.ts                   08-02 → 09-04    DriveCommand, PlantView, Driver, QuantIntent (§7.1)
│  ├─ drive/human-driver.ts            08-02 → 09-04    conditioning, reverse logic, steering assist
│  ├─ drive/tyre.ts                    08-02 → 09-01    tyre force model (§7.4)
│  ├─ drive/compliance.ts              09-01            hardpoint-derived compliance (§7.5)
│  ├─ drive/powertrain.ts              08-02 → 09-02    engine, automatic gearbox, LSD (§7.7)
│  ├─ drive/aids.ts                    09-02            ABS, traction, stability (§7.8)
│  ├─ drive/plant.ts                   08-02 → 09-04    VehiclePlant: the per-step algorithm (§7.2)
│  ├─ drive/events.ts                  08-02 (mode/reset/fault/zone only) → 11-02 (detectors)
│  ├─ drive/control.ts                 08-02 → 09-04 → 10-01 → 11-03   DriveControl: modes, latching, recorder, replay
│  ├─ drive/reference.ts               10-01            ReferenceLine (loop line, recorded line)
│  ├─ drive/path-driver.ts             10-01            PathDriver + recovery machine
│  ├─ replay/format.ts                 11-03            encode/decode, paramsHash, checksum, SIM_VERSION
│  ├─ replay/recorder.ts               11-03            in-memory recorder with keyframe snapshots
│  ├─ ghost/ghost.ts                   11-04            headless line-following runs + incremental ghost
│  ├─ car/car-model.ts (x)             08-02 → 09-04    Auto path unchanged; exposes the plant (§7.9)
│  ├─ ride/ride7dof.ts (x)             08-02 → 09-04    exportState/importState; optional linkVertical (§7.9)
│  ├─ ride/tyre.ts (x)                 09-03            det sweep only (peakMu unchanged)
│  ├─ vehicle-models.ts (x)            08-02 → 09-04    VehicleModel gains `plant?`, setSuspension(keepState)
│  ├─ simulation.ts (x)                08-02 → 09-04 → 10-01 → 11-03   drive control wiring
│  ├─ track/** kinematics/** path/** moto/** (x)        09-03 (det sweep, goldens unchanged)
│  └─ content/
│     ├─ gt-coupe.ts (x)               08-02            + `handling: gtCoupeHandling`
│     ├─ gt-coupe-handling.ts          08-02            composes tyres + powertrain + brakes/steering/compliance
│     ├─ gt-coupe-tyres.ts             08-02 → 09-01    TyreHandling front/rear + bushing table
│     ├─ gt-coupe-powertrain.ts        08-02 → 09-02    CarPowertrain + CarBrakes
│     ├─ proving-ground.ts             10-02            WorldDefinition (§8)
│     └─ proving-loop.ts, susp-*.ts, cafe-racer.ts, moto-*.ts, gt-geometry.ts (x)   09-03 (det sweep)
├─ features/
│  ├─ drive/                           08-01 stub → 08-03 → 09-05 → 10-04
│  ├─ proving-ground/                  08-01 stub → 10-03
│  ├─ tyre-vfx/                        08-01 stub → 11-01
│  ├─ coach/                           08-01 stub → 11-02
│  ├─ replay/                          08-01 stub → 11-03 → 12-05
│  ├─ ghost-lab/                       08-01 stub → 11-04
│  ├─ phone-drive/                     08-01 stub → 12-04
│  ├─ live-ghosts/                     08-01 stub → 12-07 [S]
│  └─ M1 extensions: controls/ attract/ (08-03), camera/ (08-04), telemetry-panel/ (09-05), track/ (10-03),
│     insights/ audio/ (11-02), engineer/ analytics/ (12-03), live-lab/ (12-04), credits/ (13-01)
├─ remote/ (x)                         12-04            driver panel (tilt + touch), pairing via #d=
worker/
├─ index.ts (x)                        12-01  frozen    §W2
├─ routes/replays.ts                   12-01            POST/GET /api/replays (D1)
├─ routes/insight.ts                   12-01 (501 stub) → 12-06 [S]
├─ schemas/replay.ts                   12-01
├─ migrations/0001_replays.sql         12-01
├─ secrets.d.ts                        12-01            `interface Env { TURNSTILE_SECRET?: string; AE_SQL_TOKEN?: string }`
├─ room.ts room-logic.ts schemas/room.ts routes/rooms.ts (x)   08-01 (compile shim) → 12-02 (driver role) → 12-07 [S]
├─ routes/event.ts schemas/event.ts (x)                08-01 (new event kinds) → 12-03
└─ engineer/** routes/engineer.ts schemas/engineer.ts (x)        12-03
wrangler.jsonc (x)                     12-01  frozen    §W1
worker-configuration.d.ts (x)          12-01  (`npm run typegen`)
public/_headers (x)                    12-01  (CSP: Turnstile)
tests/arch/contracts-verbatim.test.ts (x)   08-01 → 12-01
tests/arch/det-math.test.ts            08-02 → 09-03 → 09-04
tests/arch/no-type-tuning.test.ts      08-02
tests/arch/world-copy.test.ts          10-02
```
Tests are named `tests/<area>/<subject>.test.ts` and owned by the plan that creates them (ROADMAP-M2 lists each);
fixtures `tests/fixtures/<plan>-<name>.*`; e2e `tests/e2e/<plan>-<topic>.spec.ts`.

## 4. Frames, units and signs (additions; ARCHITECTURE §4 still binding)

- **DriveIntent / DriveFrame.steerDemand:** −1…1, **+ = steer LEFT** (as every steer in this project). Device adapters
  map ← / left stick left / slider left / phone tilt left to **+**.
- **Planar state:** CG ground point (X, Y) in the world frame; heading stored as the unit vector (cψ, sψ), yaw ψ = atan2
  (only for display/telemetry, via `datan2`); body-frame velocity u (forward), v (left); yaw rate r (+ CCW).
- **Corners:** order fl, fr, rl, rr; `side = [1, −1, 1, −1]`; contact-point positions (cxᵢ, cyᵢ) = the car model's design
  contact patches (vehicle frame) — the same numbers the ride model uses.
- **Wheel steer δᵢ** (+ left) = −sideᵢ · toeᵢ where toeᵢ is the table toe at (travelᵢ, ±rack) (it includes rack steer
  and bump steer) plus compliance toe (§7.5). This is car-model's existing `STEER` relation.
- **Wheel-frame velocity** of contact point i: v_xᵢ = u − r·cyᵢ, v_yᵢ = v + r·cxᵢ (vehicle frame);
  v_wx = v_x·cosδ + v_y·sinδ, v_wy = −v_x·sinδ + v_y·cosδ (wheel frame, x along the wheel heading).
- **Slip:** κ = ux/σx (deflection form, steady state (Rω − v_wx)/|v_wx|, + driving); tanα = uy/σy (steady state
  v_wy/|v_wx|, + = contact patch sliding LEFT). Restoring force Fy = −Cα·tanα (Pacejka's α has the opposite sign).
- **Tyre forces** (Fx, Fy) in the wheel frame; vehicle frame: Fxv = Fx·cosδ − Fy·sinδ, Fyv = Fx·sinδ + Fy·cosδ.
- **Inclination** εᵢ = sideᵢ · γᵢ (rad, + = top of the wheel leaning toward +y/LEFT), γᵢ = camber to road (− = top inboard).
  Camber thrust acts toward the lean: equivalent slip tanα_eq = tanα − k_γ·ε.
- **Wheel spin** ω + = rolling forward; effective rolling radius R = unloaded `tyre.radius` (shortcut: no load-dependent
  radius, comment it).
- **Compliance:** Fy_inᵢ = −sideᵢ·Fyᵢ (+ = toward the car centre), toe + = toe-in, camber compliance + = top outboard
  under inboard force (RACE convention, research m2/23 §1); stored in rad/N.
- **Base plane** (§7.2 step 4) slopes: g = ∂z/∂x_v (+ = nose up), c = ∂z/∂y_v (+ = left side higher). Plane pitch
  = −atan g (ISO pitch + = nose down), plane roll = +atan c (roll + = left side up).
- Non-SI names carry a suffix: `engineRpm`, `speedKmh`, `*_deg`, `*_pct` (wire).

## 5. Contract source (create VERBATIM in plan 08-01; W1–W2 in plan 12-01)

### 5.0 How the verbatim test is extended (08-01 owns `tests/arch/contracts-verbatim.test.ts`)
Replace the test with exactly this file (verified by the architect against this document on a scratch copy of the
tree with the C/F blocks applied, and with `'CFW'` and the W blocks applied):
```ts
/** Frozen files equal their ARCHITECTURE blocks byte for byte: M1 §5/§9.1/§12.1/§12.2, superseded by the
 * M2 addendum's C<n> (contracts), F<n> (registration) and, from plan 12-01, W<n> (worker) blocks. */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const m1 = read('.planning/ARCHITECTURE.md');
const m2 = read('.planning/ARCHITECTURE-M2.md');

/** First fenced block of `lang` after the heading line that starts with `heading`. */
function blockAfter(md: string, heading: string, lang: string): string {
  const start = md.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const open = md.indexOf(`\n\`\`\`${lang}\n`, start);
  const close = md.indexOf('\n```\n', open + 1);
  return `${md.slice(open + lang.length + 5, close)}\n`;
}

interface Block { readonly doc: string; readonly heading: string; readonly path: string; readonly lang: string }
/** Block kinds of the addendum that are live: 'CF' from 08-01; 12-01 changes it to 'CFW'. */
const M2_KINDS = 'CF';
const m2Blocks: Block[] = [...m2.matchAll(/^### ([A-Z])(\d+) `([^`]+)`$/gm)]
  .filter((m) => M2_KINDS.includes(m[1]!))
  .map((m) => ({ doc: m2, heading: `### ${m[1]!}${m[2]!} `, path: m[3]!, lang: m[3]!.endsWith('.jsonc') ? 'jsonc' : 'ts' }));
const m1Contracts = [...m1.matchAll(/^### (5\.\d+) `([^`]+)`$/gm)];
const m1Blocks: Block[] = [
  ...m1Contracts.map((m) => ({ doc: m1, heading: `### ${m[1]!} `, path: m[2]!, lang: 'ts' })),
  { doc: m1, heading: '### 9.1 ', path: 'src/app/features.ts', lang: 'ts' },
  { doc: m1, heading: '### 12.1 ', path: 'wrangler.jsonc', lang: 'jsonc' },
  { doc: m1, heading: '### 12.2 ', path: 'worker/index.ts', lang: 'ts' },
];
const blocks = [...m1Blocks.filter((b) => !m2Blocks.some((n) => n.path === b.path)), ...m2Blocks];
const CONTRACTS = ['units', 'suspension', 'vehicle', 'track', 'telemetry', 'sim', 'events', 'store', 'app', 'services', 'net', 'engineer', 'drive', 'world'];

describe('contracts verbatim', () => {
  it('finds the twelve M1 contract blocks', () => expect(m1Contracts).toHaveLength(12));

  it('has exactly the fourteen contract files, each with a block', () => {
    const files = readdirSync(new URL('src/contracts/', root)).filter((f) => f.endsWith('.ts')).sort();
    expect(files).toEqual(CONTRACTS.map((n) => `${n}.ts`).sort());
    for (const n of CONTRACTS) expect(blocks.some((b) => b.path === `src/contracts/${n}.ts`)).toBe(true);
  });

  it.each(blocks)('$path equals its block ($heading)', ({ doc, heading, path, lang }) => {
    expect(read(path)).toBe(blockAfter(doc, heading, lang));
  });

  it('registers 29 features, each pointing at an existing folder', () => {
    const lines = [...read('src/app/features.ts').matchAll(/^export \{ default as \w+ \} from '\.\.\/features\/([a-z-]+)\/index';$/gm)];
    expect(lines).toHaveLength(29);
    for (const [, id] of lines) expect(read(`src/features/${id}/index.ts`)).toContain(`id: '${id}'`);
  });
});
```
Assertions: every path in `blocks` equals its block byte for byte; the M1 regex still finds twelve §5 blocks; the
contract files on disk are exactly the fourteen paths `src/contracts/{units,suspension,vehicle,track,telemetry,sim,
events,store,app,services,net,engineer,drive,world}.ts`; `src/app/features.ts` registers **29** features, each pointing
at an existing folder whose `index.ts` contains `id: '<id>'`. The M1 ARCHITECTURE.md §5 blocks are NOT edited
(history); superseded blocks are simply no longer compared.

Contract files unchanged by M2: `units.ts`, `suspension.ts`, `track.ts`.

### C1 `src/contracts/drive.ts`

Amended by 11-05 (orchestrator-approved): `DriveEvent` kinds `strike` and `hard-stop`, raised by the plant's per-step detectors.

```ts
/**
 * Manual Drive (M2): who drives, driver intents, aids, per-frame drive telemetry, drive events and the replay format.
 * Shared by sim-core (plant, drivers, replay), the kernel (mode mirror), features (devices, HUD, VFX, coach, replay,
 * ghost) and the worker (replay validation). SI units; signs as in units.ts (ISO 8855): steer + = LEFT,
 * yaw + = left (CCW from above), wheel spin + = rolling forward, slip ratio + = driving, v + = sliding left.
 */
import type { AxleId } from './units';

/**
 * auto      = M1 behaviour: the car follows the precomputed lap (stateAt), optionally on the shared live clock.
 * manual    = the visitor drives the plant (HumanDriver).
 * returning = the autopilot drives the SAME plant back onto the driving line on a detached lap clock, then the
 *             simulation latches back to auto.
 * replay    = recorded intents drive the plant from a recorded start state.
 */
export type DriveMode = 'auto' | 'manual' | 'returning' | 'replay';

export type DriveSource = 'keyboard' | 'gamepad' | 'touch' | 'phone' | 'replay' | 'autopilot';

/** Latest-wins intent from an input device. The simulation latches it every CONTROL_TICKS steps and quantises it. */
export interface DriveIntent {
  /** -1..1, + = steer LEFT (1 = full lock demand). */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1. Held at standstill it selects reverse (sim-core HumanDriver). */
  brake: number;
  /** 0..1 */
  handbrake: number;
  /** true for on/off devices (keyboard, touch buttons): the simulation applies rise/fall ramps. */
  digital: boolean;
  source: DriveSource;
}

/** Fixed steps per control sample (240 Hz / 4 = 60 Hz). Live driving and replays latch intents on the same ticks. */
export const CONTROL_TICKS = 4;
/** A latched intent is quantised to these integer ranges (replays store exactly these integers). */
export const INTENT_QUANT = { steer: 1024, pedal: 255 } as const;
/** Index of each DriveSource in the replay flags byte (bits 1-3). */
export const DRIVE_SOURCES = ['keyboard', 'gamepad', 'touch', 'phone', 'replay', 'autopilot'] as const satisfies readonly DriveSource[];

export function neutralIntent(source: DriveSource = 'keyboard'): DriveIntent {
  return { steer: 0, throttle: 0, brake: 0, handbrake: 0, digital: true, source };
}

/** Driver aids. Every aid is a labelled, simplified model ("Assist"), never a manufacturer system. */
export interface DriveAids {
  readonly abs: boolean;
  readonly traction: boolean;
  readonly stability: boolean;
  /** Speed-sensitive steering limit and countersteer help (input conditioning in sim-core). */
  readonly steering: boolean;
}

export const DEFAULT_AIDS: DriveAids = { abs: true, traction: true, stability: true, steering: true };

/** Per-frame drive telemetry (TRUE values, SI), written by sim-core sample() in every mode. */
export interface DriveFrame {
  mode: DriveMode;
  /** The current vehicle has a Manual Drive plant (a car with handling data). */
  available: boolean;
  /** Source of the last latched intent; null in auto. */
  source: DriveSource | null;
  /** CG ground point in the sim world frame (m) and yaw (rad, CCW from +X, wrapped to (-pi, pi]). */
  x: number;
  y: number;
  yaw: number;
  /** Body-frame CG velocity, m/s: u forward, v left. */
  u: number;
  v: number;
  /** Sideslip at the CG, rad: atan2(v, |u|); 0 below 1 m/s. */
  beta: number;
  /** Conditioned demands actually applied this step (post aids): steer -1..1 (+ left), pedals 0..1. */
  steerDemand: number;
  throttle: number;
  brake: number;
  handbrake: number;
  /** -1 reverse, 0 neutral, 1..n forward gear. */
  gear: number;
  engineRpm: number;
  /** An aid intervened during the last step. */
  absActive: boolean;
  tractionActive: boolean;
  stabilityActive: boolean;
  aids: DriveAids;
  /** Ground under the CG: 'loop', 'terrain', 'field' or a WorldDefinition zone id. */
  zone: string;
  /** Offset from the driving line (m, + left) and heading error (rad); NaN off the loop corridor. */
  lineOffset: number;
  headingError: number;
  /** Simulated seconds since the last non-neutral latched intent (0 in auto). */
  idle: number;
  /** Outside the model's validated domain: |ay| > 0.85 mu g, |beta| > 10 deg or |slip ratio| > 0.3 on any wheel. */
  approximate: boolean;
  /** The lap clock left the shared live lap with the last manual excursion (cleared by a live seek). */
  detached: boolean;
  /** Last-good-state restores since the simulation was created (NaN containment). */
  faults: number;
}

export function createDriveFrame(): DriveFrame {
  return {
    mode: 'auto',
    available: false,
    source: null,
    x: 0,
    y: 0,
    yaw: 0,
    u: 0,
    v: 0,
    beta: 0,
    steerDemand: 0,
    throttle: 0,
    brake: 0,
    handbrake: 0,
    gear: 0,
    engineRpm: 0,
    absActive: false,
    tractionActive: false,
    stabilityActive: false,
    aids: DEFAULT_AIDS,
    zone: 'loop',
    lineOffset: Number.NaN,
    headingError: Number.NaN,
    idle: 0,
    approximate: false,
    detached: false,
    faults: 0,
  };
}

/** Discrete drive events (sim-core detectors), forwarded by the kernel as bus 'drive:event'. Never per frame. */
export type DriveEvent = { readonly simTime: number } & (
  | { readonly kind: 'mode'; readonly mode: DriveMode; readonly previous: DriveMode; readonly cut: boolean }
  | { readonly kind: 'reset'; readonly spawn: string | null }
  /** An axle went past its peak slip: front = understeer, rear = oversteer. `lift` = throttle released < 0.5 s before. */
  | { readonly kind: 'slide'; readonly axle: AxleId; readonly lift: boolean }
  | { readonly kind: 'lockup'; readonly corner: number }
  | { readonly kind: 'wheelspin'; readonly corner: number }
  | { readonly kind: 'aid'; readonly aid: 'abs' | 'traction' | 'stability' }
  /** A wheel struck a kerb (`kerb`) or a bump: a fast compression well above its recent travel (11-05). */
  | { readonly kind: 'strike'; readonly corner: number; readonly kerb: boolean }
  /** Braking from `from` m/s to a standstill with a high mean deceleration (11-05). */
  | { readonly kind: 'hard-stop'; readonly from: number }
  | { readonly kind: 'zone'; readonly zone: string; readonly entered: boolean }
  | { readonly kind: 'out-of-bounds' }
  /** Returning reached the driving line and the simulation latched back to auto. */
  | { readonly kind: 'converged' }
  | { readonly kind: 'fault'; readonly count: number }
);

/** Mode-change and run control the simulation exposes (Simulation.drive). Only the kernel calls request/reset/play. */
export interface DriveControl {
  /** The current vehicle has a plant. */
  readonly available: boolean;
  readonly mode: DriveMode;
  /** Latest-wins device intent (features: the DRIVE service owner only). Ignored outside manual. */
  setIntent(intent: Readonly<DriveIntent>): void;
  /** Applied at the next fixed step. 'auto' from manual = returning; with `immediate` = release now (a cut). */
  request(mode: 'auto' | 'manual', immediate?: boolean): void;
  setAids(aids: DriveAids): void;
  /** Manual only: at rest on the nearest driving-line point (or a station spawn), heading along the line. */
  reset(spawn?: string): void;
  /** Start replaying from the recorded start state (mode 'replay'). False if the replay does not fit this simulation. */
  play(replay: DecodedReplay): boolean;
  /** The current manual or replay run since it started (newest REPLAY_LIMITS.maxSeconds), or null in auto. */
  recording(): DecodedReplay | null;
  /** Delivers and clears events queued since the last call (the kernel calls it once per render frame). */
  drainEvents(handler: (event: DriveEvent) => void): void;
}

// ---------------------------------------------------------------- replay format

export const REPLAY_FORMAT = 1;

export const REPLAY_LIMITS = {
  /** Longest run kept by the recorder, s. */
  maxSeconds: 600,
  /** Runs up to this long are shared in the URL fragment; longer ones go to the server. */
  fragmentSeconds: 60,
  /** Fixed steps between keyframe checksums (5 s). */
  keyframeTicks: 1200,
  /** Encoded and compressed size cap, bytes. */
  maxBytes: 65536,
} as const;

export interface ReplayHeader {
  readonly format: typeof REPLAY_FORMAT;
  /** APP_VERSION of the build that recorded it. */
  readonly simVersion: string;
  /** Hash (8 hex) of the vehicle, suspension and world definitions used (sim-core replay/format.ts). */
  readonly paramsHash: string;
  readonly trackId: string;
  readonly worldId: string | null;
  readonly vehicleId: string;
  readonly suspensionId: string;
  /** Fixed steps recorded (240 Hz). */
  readonly ticks: number;
}

export interface ReplayEventRecord {
  readonly tick: number;
  readonly kind: 'suspension' | 'aids' | 'reset';
  /** Suspension id; aids as 'abs,traction,stability,steering' subset; reset spawn id or ''. */
  readonly value: string;
}

export interface DecodedReplay {
  readonly header: ReplayHeader;
  /** Plant + ride state at tick 0 (sim-core PLANT_SNAPSHOT layout, float64). */
  readonly start: Float64Array;
  /** One latched intent per CONTROL_TICKS steps, 5 integers each: steer (+-INTENT_QUANT.steer), throttle, brake,
   * handbrake (0..INTENT_QUANT.pedal), flags (bit 0 digital, bits 1-3 DRIVE_SOURCES index). */
  readonly intents: Int16Array;
  readonly events: readonly ReplayEventRecord[];
  /** CRC32 of the rounded state every REPLAY_LIMITS.keyframeTicks steps (divergence detection). */
  readonly keyframes: Uint32Array;
}
```

### C2 `src/contracts/world.ts`
```ts
/**
 * The drivable world (M2): ground zones beside the proving loop, their surfaces, stations and props, and the runtime
 * GroundWorld that sim-core builds from them. ONE analytic ground for physics AND rendering (they never disagree).
 * World frame as units.ts (X east, Y north, Z up). Zone-local coordinates: u along the zone heading from its start
 * edge, w + LEFT of the zone axis (the same convention as a track's s and l, so RoadFeature can be reused).
 */
import type { RoadFeature, RoughnessClass, TrackPrimitive } from './track';

export type SurfaceKind = 'asphalt' | 'asphalt-wet' | 'kerb' | 'pave' | 'grass' | 'ceramic-wet';

export interface SurfaceProps {
  readonly kind: SurfaceKind;
  /** Display name, no digits. */
  readonly label: string;
  /** Peak friction scale relative to dry asphalt. APPROXIMATE model input, never displayed as data. */
  readonly muScale: number;
  /** Rolling-resistance coefficient (force / load). */
  readonly rollingResistance: number;
  readonly wet: boolean;
}

/** Research m2/11 §c2 and m2/04 §9: the wet-tile value follows published test-facility figures, the rest are estimates. */
export const SURFACES: Readonly<Record<SurfaceKind, SurfaceProps>> = {
  asphalt: { kind: 'asphalt', label: 'Kuru asfalt', muScale: 1, rollingResistance: 0.012, wet: false },
  'asphalt-wet': { kind: 'asphalt-wet', label: 'Islak asfalt', muScale: 0.65, rollingResistance: 0.014, wet: true },
  kerb: { kind: 'kerb', label: 'Bordür', muScale: 0.9, rollingResistance: 0.015, wet: false },
  pave: { kind: 'pave', label: 'Arnavut kaldırımı', muScale: 0.85, rollingResistance: 0.015, wet: false },
  grass: { kind: 'grass', label: 'Çim', muScale: 0.45, rollingResistance: 0.06, wet: false },
  'ceramic-wet': { kind: 'ceramic-wet', label: 'Islak seramik zemin', muScale: 0.13, rollingResistance: 0.015, wet: true },
};

/** Zone footprint. rect: (x, y) is the centre of the START edge, the zone runs `length` along `heading`. path: a
 * ribbon of `width` along line/arc/clothoid primitives integrated from the start pose (spurs). */
export type ZoneShape =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly heading: number; readonly length: number; readonly width: number }
  | {
      readonly kind: 'path';
      readonly x: number;
      readonly y: number;
      readonly heading: number;
      readonly primitives: readonly TrackPrimitive[];
      readonly width: number;
    };

/** A sub-area of a zone with its own surface (braking-platform lanes, split-mu). */
export interface ZonePatch {
  readonly u: readonly [u0: number, u1: number];
  readonly w: readonly [w0: number, w1: number];
  readonly surface: SurfaceKind;
}

export interface ZoneDefinition {
  /** kebab-case, unique within the world. */
  readonly id: string;
  /** Display name, no digits. */
  readonly name: string;
  readonly shape: ZoneShape;
  readonly surface: SurfaceKind;
  /** Base height: flat, or linear along u from z0 to z1 (ends eased over ZONE_EASE m in sim-core). */
  readonly z: number | readonly [z0: number, z1: number];
  /** ISO 8608 class of the seeded roughness (default: none). */
  readonly roughness?: RoughnessClass;
  /** Closed-form features in zone-local coordinates (RoadFeature s = u, l = w). */
  readonly features?: readonly RoadFeature[];
  readonly patches?: readonly ZonePatch[];
  /** Higher wins where footprints overlap; the loop corridor is priority 0. */
  readonly priority: number;
}

export type WorldProp =
  | { readonly kind: 'cone'; readonly x: number; readonly y: number }
  /** Painted circle (steering pad). */
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly radius: number }
  /** Station signboard facing `heading`. */
  | { readonly kind: 'sign'; readonly x: number; readonly y: number; readonly heading: number; readonly station: string };

export type StationPhenomenon =
  | 'ride-resonance'
  | 'harshness'
  | 'single-wheel-bump'
  | 'steady-state-roll'
  | 'roll-reversal'
  | 'lane-change'
  | 'braking'
  | 'split-mu'
  | 'low-grip';

/** An experiment place ("try this"), never a challenge: no times, no scores. */
export interface StationDefinition {
  readonly id: string;
  /** Display name, no digits. */
  readonly name: string;
  /** One line: what to look at. No digits. */
  readonly caption: string;
  /** One line: what to try, e.g. "Hold a steady speed round the circle, then swap suspension". No digits. */
  readonly experiment: string;
  readonly zone: string;
  /** Where R / the station list places the car (at rest), world frame. */
  readonly spawn: { readonly x: number; readonly y: number; readonly heading: number };
  readonly phenomenon: StationPhenomenon;
  /** false = a tyre-grip demonstration, labelled as such (not a suspension lesson). */
  readonly suspension: boolean;
}

export interface WorldDefinition {
  readonly id: string;
  /** The track this world surrounds. */
  readonly trackId: string;
  readonly name: string;
  readonly zones: readonly ZoneDefinition[];
  readonly stations: readonly StationDefinition[];
  readonly props: readonly WorldProp[];
  /** Flat field ('field' zone, grass) the zones sit on; blended into the terrain over `blend` m outside the rectangle. */
  readonly field: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number; readonly z: number; readonly blend: number };
}

// ---------------------------------------------------------------- runtime (sim-core world/ground.ts builds it)

export interface GroundHit {
  /** Full surface height incl. roughness and features, m. */
  h: number;
  /** Smooth reference height: loop = swell + bank (no vertical curves, no roughness); zones = base plane; m. */
  base: number;
  surface: SurfaceKind;
  /** 'loop', 'terrain', 'field' or a zone id. */
  zone: string;
  /** Loop projection when within the loop corridor (|l| <= LOOP_CORRIDOR), else NaN. */
  s: number;
  l: number;
}

/** Projection of a world point onto the loop centreline. */
export interface Frenet {
  /** Arc length, m, wrapped to [0, length). */
  s: number;
  /** Signed lateral offset, m, + left of the centreline. */
  l: number;
  /** Centreline heading and curvature at s. */
  heading: number;
  curvature: number;
  /** false when the warm-started Newton step did not converge and the strided search was used. */
  converged: boolean;
}

export interface GroundWorld {
  readonly def: WorldDefinition | null;
  /** Ground at world (x, y). `hint` = a nearby loop s (warm start; NaN = unknown). Allocation-free. */
  sample(x: number, y: number, hint: number, out: GroundHit): GroundHit;
  /** Height of the terrain mesh at (x, y): the loop runoff blend, the far field and the world field. */
  terrainHeight(x: number, y: number): number;
  /** Nearest loop centreline point. Allocation-free. */
  project(x: number, y: number, hint: number, out: Frenet): Frenet;
  /** Inside the drivable region (loop corridor, field and zones with their margins). */
  inBounds(x: number, y: number): boolean;
  station(id: string): StationDefinition | undefined;
}
```

### C3 `src/contracts/sim.ts`
```ts
import type { DriveControl } from './drive';
import type { SuspensionDefinition, VehicleKinematics } from './suspension';
import type { TelemetryFrame } from './telemetry';
import type { BuiltTrack, TrackDefinition } from './track';
import type { VehicleDefinition } from './vehicle';
import type { GroundWorld, WorldDefinition } from './world';

/** Lookup the simulation uses to resolve ids (the kernel passes registry getters). */
export interface SimCatalog {
  track(id: string): TrackDefinition | undefined;
  vehicle(id: string): VehicleDefinition | undefined;
  suspension(id: string): SuspensionDefinition | undefined;
  /** The world registered around a track (M2); absent = the loop and the terrain only. */
  world?(trackId: string): WorldDefinition | undefined;
}

export interface SimulationOptions {
  readonly catalog: SimCatalog;
  readonly trackId: string;
  readonly vehicleId: string;
  readonly suspensionId: string;
  /** Initial lap time, s (default 0). */
  readonly lapTime?: number;
}

/** Kinematic path state: a PURE function of lap time for a given (track, vehicle). Suspension-independent. */
export interface PathState {
  lapTime: number;
  /** m along centreline. */
  s: number;
  /** Driving-line lateral offset, m (+ left). */
  l: number;
  /** m/s. */
  v: number;
  /** m/s^2 (path tangent / normal, + forward / + left). */
  ax: number;
  ay: number;
  /** Curvature of the driving line (centreline curvature + offset correction), 1/m. */
  curvature: number;
  /** Heading of the driving line, rad. */
  heading: number;
  /** World position of the driving line on the road surface at (s, l) (sim frame). */
  x: number;
  y: number;
  z: number;
  bank: number;
  grade: number;
  sectionIndex: number;
}

export type SimEvent =
  | { readonly kind: 'lap'; readonly lap: number; readonly duration: number }
  | { readonly kind: 'section'; readonly index: number; readonly id: string }
  | { readonly kind: 'bump-stop'; readonly corner: number }
  | { readonly kind: 'liftoff'; readonly corner: number }
  | { readonly kind: 'grip-limit'; readonly corner: number };

export interface Simulation {
  readonly track: BuiltTrack;
  readonly vehicle: VehicleDefinition;
  readonly suspension: SuspensionDefinition;
  /** Manual Drive control (M2). Absent only in test fakes; `drive.available` is false for vehicles without a plant. */
  readonly drive?: DriveControl;
  /** The analytic ground (loop + world zones + terrain) shared by the plant and the renderer (M2). */
  readonly world?: GroundWorld;
  /** Duration of one lap for the current vehicle, s (speed profile; identical for all suspension types). */
  readonly lapDuration: number;
  /** Lap time of the CURRENT fixed step, s. Outside auto it is the detached clock: lapTimeAt(projected s) while the
   * car is within the loop corridor, else held. */
  readonly lapTime: number;
  readonly simTime: number;

  /** Advance exactly one fixed step. The kernel always passes SIM_DT; determinism is guaranteed only for SIM_DT. */
  step(dt: number): void;
  /**
   * Interpolate between the previous and current fixed step (alpha in [0,1]) and evaluate kinematics.
   * Returns the simulation-owned preallocated frame (valid until the next sample()/setVehicle()).
   * `amplification` (>= 1) scales roll, pitch, heave and wheel travel in POSE fields only.
   */
  sample(alpha: number, amplification?: number): TelemetryFrame;
  /** Swap suspension (same vehicle class). Path position is kept; ride state continues. Throws on class mismatch.
   * Outside auto the plant state (pose, velocities, ride state) is kept and only tables/extras change (no pre-roll). */
  setSuspension(id: string): void;
  /** Swap vehicle (+ optional suspension, default vehicle.defaultSuspension). Allocates a new frame; keeps lap phase
   * fraction. Outside auto it first releases the plant (mode auto, a cut). */
  setVehicle(id: string, suspensionId?: string): void;
  /** Jump to lap time: path set from stateAt(), ride model initialised at equilibrium and pre-rolled for SEEK_SETTLE_S.
   * Outside auto it first releases the plant (mode auto, a cut). */
  seek(lapTime: number): void;
  /** PURE: path state at a lap time (no side effects). Same answer on every device for the same vehicle. */
  stateAt(lapTime: number, out: PathState): PathState;
  /** PURE inverse: lap time at which the driving line passes arc length s (e.g. a section start). */
  lapTimeAt(s: number): number;
  /** Precomputed curves + design summaries for the current suspension on the current vehicle. */
  kinematics(): VehicleKinematics;
  /** World points (pointOrder of that corner) at ZERO travel with the current body pose and steer: the "ghost" rest pose. */
  restPose(cornerIndex: number, out: Float64Array): Float64Array;
  /** Delivers and clears events queued since the last call (kernel calls once per render frame). */
  drainEvents(handler: (event: SimEvent) => void): void;
}

export type CreateSimulation = (options: SimulationOptions) => Simulation;

/** Ride-model pre-roll after seek(), s. */
export const SEEK_SETTLE_S = 1.5;
```

### C4 `src/contracts/telemetry.ts`
```ts
import { createDriveFrame, type DriveFrame } from './drive';
import type { VehicleClass } from './suspension';
import type { AxleId, CornerId, XYZ, XYZW } from './units';
import type { SurfaceKind } from './world';

/**
 * Preallocated per-corner telemetry. Written by sim-core `sample()`, read by everything else.
 * TRUE fields are physical values and are NEVER amplified.
 * POSE fields (marked) are for rendering and include the display amplification factor.
 */
export interface CornerFrame {
  readonly id: CornerId;
  readonly axle: AxleId;
  /** +1 left, -1 right, 0 centreline (motorcycle). */
  readonly side: 1 | -1 | 0;
  /** Point names for `points`, defined by the active suspension (car: AxleLinkage.points keys incl. arm points; motorcycle: fixed per model kind). */
  pointOrder: readonly string[];

  // ---- TRUE values (SI) ----
  /** m, + bump, from static ride height. */
  travel: number;
  /** m/s, + compressing. */
  travelRate: number;
  /** rad, wheel camber relative to the ROAD plane (- = top inboard). */
  camber: number;
  /** rad, camber relative to the body. */
  camberBody: number;
  /** rad, + toe-in: static + bump steer (excludes steering input). */
  toe: number;
  /** rad, road-wheel steer about vehicle +Z, + left (car: Ackermann per wheel; motorcycle front: steer about steering axis). */
  steer: number;
  /** N, tyre vertical load, >= 0 (0 = wheel off the ground). */
  load: number;
  /** N along the spring axis, + compression. */
  springForce: number;
  /** N along the damper axis, + while resisting compression. */
  damperForce: number;
  /** d(spring length)/d(travel) at the current travel. */
  motionRatio: number;
  /** Model estimate of tyre force used / available, 0..~1.2. Label as "model" in UI. */
  gripUse: number;
  /** 0..1 bump-stop (or rebound-stop) engagement. */
  stop: number;
  /** N, tyre force in the WHEEL frame (x along the wheel heading, y left). Auto: the demand estimate behind gripUse. */
  fx: number;
  fy: number;
  /** N, model peak force available (peak mu at this load and camber x surface scale x load). Label "model". */
  capacity: number;
  /** Tangent of the contact-patch slip angle (+ = patch sliding left of the wheel heading). 0 in auto. */
  slipAngle: number;
  /** Longitudinal slip ratio (+ = driving). 0 in auto. */
  slipRatio: number;
  /** rad/s, wheel spin rate (+ = rolling forward). */
  omega: number;
  /** Surface under the contact patch. */
  surface: SurfaceKind;

  // ---- POSE (world, sim frame, amplified) ----
  readonly wheelPosition: XYZ;
  /** Wheel orientation incl. steer/camber/toe, excluding spin. */
  readonly wheelRotation: XYZW;
  /** rad, accumulated rolling angle about the axle (wrapped to [0, 2pi)). */
  spin: number;
  readonly contactPatch: XYZ;
  /** Front-view instant centre (car) / swingarm instant centre (motorcycle rear). */
  readonly instantCentre: XYZ;
  /** World xyz triples for `pointOrder` (length = 3 * pointOrder.length; capacity MAX_POINTS * 3). */
  readonly points: Float64Array;
  /** Current spring length, m (pose). */
  springLength: number;
}

export interface AxleFrame {
  readonly id: AxleId;
  /** TRUE kinematic roll-centre height above the road, m (car; NaN for motorcycle). */
  rollCentreHeight: number;
  /** TRUE anti-dive/anti-squat fraction at the current state. */
  antiPitch: number;
  /** POSE: roll centre in world (car). */
  readonly rollCentre: XYZ;
}

export interface TelemetryFrame {
  vehicleClass: VehicleClass;
  vehicleId: string;
  suspensionId: string;

  // ---- time & path (TRUE) ----
  /** s since simulation start (monotonic, includes seeks' pre-roll). */
  simTime: number;
  /** s within the current lap, [0, lapDuration). */
  lapTime: number;
  lap: number;
  /** m along the centreline. */
  s: number;
  sectionIndex: number;
  sectionId: string;
  /** m/s. */
  speed: number;
  /** Vehicle-frame accelerations, m/s^2 (ax + forward, ay + left). */
  ax: number;
  ay: number;
  yawRate: number;

  // ---- body (TRUE, relative to the local road plane) ----
  /** rad, + left side up (car body roll; motorcycle lean angle). */
  roll: number;
  /** rad, + nose down. */
  pitch: number;
  /** m, + up, from static ride height. */
  heave: number;
  /** rad: mean front road-wheel steer (car) / handlebar steer angle (motorcycle). */
  steer: number;
  /** m, live wheelbase. */
  wheelbase: number;
  /** m, live mechanical trail of the steered axle. */
  trail: number;

  // ---- body POSE (world, sim frame, amplified) ----
  readonly bodyPosition: XYZ;
  readonly bodyRotation: XYZW;
  /** Factor applied to POSE fields this frame (1 = true scale). */
  amplification: number;

  readonly corners: CornerFrame[];
  readonly axles: AxleFrame[];
  /** Manual Drive telemetry (M2); in auto it mirrors the path (mode 'auto'). */
  readonly drive: DriveFrame;
}

/** Maximum named points per corner (capacity of CornerFrame.points). */
export const MAX_POINTS = 32;

export interface CornerLayout {
  readonly id: CornerId;
  readonly axle: AxleId;
  readonly side: 1 | -1 | 0;
}

const xyz = (): XYZ => ({ x: 0, y: 0, z: 0 });

/** Allocates a zeroed frame. Called by sim-core only when the vehicle (layout) changes. */
export function createTelemetryFrame(vehicleClass: VehicleClass, corners: readonly CornerLayout[]): TelemetryFrame {
  return {
    vehicleClass,
    vehicleId: '',
    suspensionId: '',
    simTime: 0,
    lapTime: 0,
    lap: 0,
    s: 0,
    sectionIndex: 0,
    sectionId: '',
    speed: 0,
    ax: 0,
    ay: 0,
    yawRate: 0,
    roll: 0,
    pitch: 0,
    heave: 0,
    steer: 0,
    wheelbase: 0,
    trail: 0,
    bodyPosition: xyz(),
    bodyRotation: { x: 0, y: 0, z: 0, w: 1 },
    amplification: 1,
    corners: corners.map((c) => ({
      ...c,
      pointOrder: [],
      travel: 0,
      travelRate: 0,
      camber: 0,
      camberBody: 0,
      toe: 0,
      steer: 0,
      load: 0,
      springForce: 0,
      damperForce: 0,
      motionRatio: 1,
      gripUse: 0,
      stop: 0,
      fx: 0,
      fy: 0,
      capacity: 0,
      slipAngle: 0,
      slipRatio: 0,
      omega: 0,
      surface: 'asphalt',
      wheelPosition: xyz(),
      wheelRotation: { x: 0, y: 0, z: 0, w: 1 },
      spin: 0,
      contactPatch: xyz(),
      instantCentre: xyz(),
      points: new Float64Array(MAX_POINTS * 3),
      springLength: 0,
    })),
    axles: (['front', 'rear'] as const).map((id) => ({ id, rollCentreHeight: Number.NaN, antiPitch: 0, rollCentre: xyz() })),
    drive: createDriveFrame(),
  };
}
```

### C5 `src/contracts/vehicle.ts`
```ts
import type { ComponentRole, VehicleClass } from './suspension';

export interface TyreParams {
  /** Unloaded radius, m. */
  readonly radius: number;
  readonly width: number;
  /** N/m. */
  readonly verticalStiffness: number;
  /** N*s/m. */
  readonly verticalDamping: number;
  /** Peak friction coefficient at nominalLoad. */
  readonly mu: number;
  /** d(mu)/d(Fz), 1/N (negative). */
  readonly loadSensitivity: number;
  /** N. */
  readonly nominalLoad: number;
  /** Motorcycle only: tyre crown radius, m (lean correction). */
  readonly crownRadius?: number;
}

/** Inputs to the friction-limited speed profile (identical for every suspension type of a vehicle). */
export interface DrivingLimits {
  /** Max lateral acceleration used by the autopilot, m/s^2 (already includes driver margin). */
  readonly lateral: number;
  /** Max longitudinal acceleration, m/s^2. */
  readonly accel: number;
  /** Max braking deceleration (positive number), m/s^2. */
  readonly brake: number;
  /** Speed cap, m/s. */
  readonly vMax: number;
}

interface VehicleBase {
  readonly id: string;
  readonly class: VehicleClass;
  /** e.g. "GT coupe". Never a manufacturer claim. */
  readonly name: string;
  /** e.g. "Representative parameters". */
  readonly subtitle: string;
  /** Key into Registries.vehicleVisuals. */
  readonly visualKey: string;
  /** Total mass incl. driver/rider, kg. */
  readonly mass: number;
  readonly sprungMass: number;
  /** Static sprung CG height above ground, m. */
  readonly cgHeight: number;
  /** Sprung-body inertias about the CG, kg*m^2. */
  readonly inertia: { readonly roll: number; readonly pitch: number; readonly yaw: number };
  /** m. */
  readonly wheelbase: number;
  /** Horizontal distance CG -> front axle, m (rear = wheelbase - cgToFront). */
  readonly cgToFront: number;
  readonly limits: DrivingLimits;
  /** Drag area Cd*A, m^2. */
  readonly dragArea: number;
  /** Suspension definition ids allowed for this vehicle, in UI order. */
  readonly suspensions: readonly string[];
  readonly defaultSuspension: string;
}

export interface CarAxleSpec {
  /** Wheel-centre to wheel-centre, m. Must match the visual model. */
  readonly track: number;
  /** Baseline unsprung mass per corner, kg (suspension extras add a delta). */
  readonly unsprungMass: number;
  /** Target body ride frequency at this axle, Hz (wheel rate derived from it; identical across suspension types). */
  readonly rideFrequency: number;
  /** Damping ratios at the wheel. */
  readonly damping: { readonly bump: number; readonly rebound: number };
  /** Anti-roll-bar roll stiffness for the axle, N*m/rad. */
  readonly antiRollStiffness: number;
  readonly tyre: TyreParams;
  readonly steered: boolean;
  readonly driven: boolean;
  /** Fraction of total braking force on this axle (front + rear = 1). */
  readonly brakeShare: number;
}

// ---------------------------------------------------------------- Manual Drive (M2): REPRESENTATIVE model inputs

/** Simplified Magic Formula tyre for the plant (research m2/04). Peak mu, its load sensitivity and the camber loss
 * come from TyreParams (the same peakMu() as Auto); these add the slip behaviour. Model values, never data. */
export interface TyreHandling {
  /** Cornering stiffness per unit load at nominal load, 1/rad (C_alpha / Fz). */
  readonly corneringStiffness: number;
  /** Longitudinal slip stiffness per unit load at nominal load (C_kappa / Fz). */
  readonly slipStiffness: number;
  /** Load shape k: C(Fz) = C0 * g(Fz / (k * Fz0)) / g(1 / k) with g(x) = 2x / (1 + x^2) (= sin(2 atan x)). */
  readonly stiffnessLoadShape: number;
  /** Magic Formula shape C and curvature E of the one normalised combined-slip curve. */
  readonly shape: number;
  readonly curvature: number;
  /** Camber stiffness / cornering stiffness (equivalent slip per unit inclination). */
  readonly camberRatio: number;
  /** Relaxation lengths of the contact-patch deflection states, m. */
  readonly relaxationLateral: number;
  readonly relaxationLongitudinal: number;
  /** Rotating inertia of wheel, tyre, hub and brake disc, kg m^2. */
  readonly wheelInertia: number;
}

export interface CarPowertrain {
  /** Full-throttle engine torque (N m) at rpm knots (ascending), linear between knots. */
  readonly torqueCurve: { readonly rpm: readonly number[]; readonly torque: readonly number[] };
  readonly idleRpm: number;
  readonly redlineRpm: number;
  /** Closed-throttle engine braking torque = a + b * rpm, N m. */
  readonly frictionTorque: readonly [a: number, b: number];
  /** Engine + flywheel + converter rotating inertia, kg m^2 (reflected to the driven wheels through the ratio). */
  readonly engineInertia: number;
  /** Forward ratios (first gear first), reverse ratio (> 0), final drive, driveline efficiency. */
  readonly gears: readonly number[];
  readonly reverse: number;
  readonly finalDrive: number;
  readonly efficiency: number;
  /** Automatic shift: torque cut, ramp back and lockout (s); upshift rpm at light and full throttle; downshift rpm. */
  readonly shift: { readonly cut: number; readonly ramp: number; readonly lockout: number };
  readonly upshiftRpm: readonly [light: number, full: number];
  readonly downshiftRpm: number;
  /** Speed-sensitive limited-slip ratio of the driven axle (Jolt form); Infinity = open differential. */
  readonly limitedSlipRatio: number;
  /** Reverse: speed cap (m/s) and throttle scale. */
  readonly reverseSpeedCap: number;
  readonly reverseThrottle: number;
}

export interface CarBrakes {
  /** Total brake torque at full pedal, N m, split by each CarAxleSpec.brakeShare. */
  readonly maxTorque: number;
  /** Rear-axle handbrake torque at full lever, N m. */
  readonly handbrakeTorque: number;
}

export interface CarSteering {
  /** Steering actuator: first-order lag (s) and road-wheel rate limit (rad/s). */
  readonly lag: number;
  readonly rate: number;
}

/** Elastokinematics (research m2/23): ONE shared role-based bushing table for every suspension type. */
export interface CarCompliance {
  /** Axial stiffness of a link's chassis-side bushing (N/m) by component role; strut = top-mount radial rate. */
  readonly bushingRates: Readonly<Partial<Record<ComponentRole, number>>>;
  /** Clamp on compliance toe and camber, rad. */
  readonly maxAngle: number;
  /** First-order filter on the compliance angles, s. */
  readonly filter: number;
}

export interface CarHandling {
  readonly tyres: { readonly front: TyreHandling; readonly rear: TyreHandling };
  readonly powertrain: CarPowertrain;
  readonly brakes: CarBrakes;
  readonly steering: CarSteering;
  readonly compliance: CarCompliance;
}

export interface CarDefinition extends VehicleBase {
  readonly class: 'car';
  readonly front: CarAxleSpec;
  readonly rear: CarAxleSpec;
  /** Max road-wheel steer angle, rad (Ackermann applied by sim-core). */
  readonly maxSteer: number;
  /** Manual Drive plant inputs (M2). Absent = this car is Auto-only. */
  readonly handling?: CarHandling;
}

export interface MotoEndSpec {
  readonly tyre: TyreParams;
  readonly brakeShare: number;
  readonly driven: boolean;
}

export interface MotorcycleDefinition extends VehicleBase {
  readonly class: 'motorcycle';
  readonly front: MotoEndSpec;
  readonly rear: MotoEndSpec;
  /** Chain geometry for anti-squat: gearbox sprocket centre (vehicle frame) and radii, m. */
  readonly chain: {
    readonly sprocketCentre: readonly [x: number, z: number];
    readonly frontRadius: number;
    readonly rearRadius: number;
  };
}

export type VehicleDefinition = CarDefinition | MotorcycleDefinition;
```

### C6 `src/contracts/store.ts`
```ts
import type { MapStore } from 'nanostores';
import type { QualityTier } from './app';
import { DEFAULT_AIDS, type DriveAids, type DriveMode } from './drive';
import type { RoomRole } from './net';
import type { CornerId } from './units';

/** follow = chase camera; explore = free orbit around the moving car; closeup = suspension close-up (x-ray on). */
export type ViewMode = 'follow' | 'explore' | 'closeup';
/** clean = car + minimal HUD; engineer = construction lines, ghost pose, load arrows, curves. */
export type OverlayLevel = 'clean' | 'engineer';

export interface RoomStatus {
  readonly code: string | null;
  readonly role: RoomRole | null;
  readonly connected: boolean;
  /** Connected viewers in the room (excluding host). */
  readonly viewers: number;
  /** Live distribution: key `${vehicleId}:${suspensionId}` -> count. */
  readonly dist: Readonly<Record<string, number>>;
}

/**
 * Discrete app state (nanostores map). Single source of truth for configuration and UI state.
 * NEVER put per-frame data here. Features write with store.setKey(); the kernel applies
 * vehicleId/suspensionId/paused/timeScale/clock to the simulation.
 */
export interface AppState {
  vehicleId: string;
  suspensionId: string;
  trackId: string;
  view: ViewMode;
  focusCorner: CornerId | null;
  xray: boolean;
  overlay: OverlayLevel;
  /** Display amplification of body/wheel motion (1 = true scale). Readouts always show true values. */
  amplification: number;
  paused: boolean;
  /** 1 = real time; slow motion < 1. */
  timeScale: number;
  /** live = lap phase follows the shared server clock; local = free-running (pause/slow-mo/seek). */
  clock: 'live' | 'local';
  attract: boolean;
  hudVisible: boolean;
  creditsOpen: boolean;
  engineerOpen: boolean;
  quality: QualityTier;
  reducedMotion: boolean;
  /** Mirror of the simulation's drive mode. Written ONLY by the kernel; request changes with bus 'drive:request'. */
  driveMode: DriveMode;
  /** Driver aids chosen by the visitor; the kernel applies them to the plant. */
  driveAids: DriveAids;
  /** 0..1 loading progress; 1 = ready. */
  loading: number;
  room: RoomStatus;
}

export type AppStore = MapStore<AppState>;

export const DEFAULT_IDS = {
  track: 'proving-loop',
  car: 'gt-coupe',
  carSuspension: 'double-wishbone',
  motorcycle: 'cafe-racer',
} as const;

export const AMPLIFICATION_ON = 2.5;

export function initialState(): AppState {
  return {
    vehicleId: DEFAULT_IDS.car,
    suspensionId: DEFAULT_IDS.carSuspension,
    trackId: DEFAULT_IDS.track,
    view: 'follow',
    focusCorner: null,
    xray: false,
    overlay: 'clean',
    amplification: 1,
    paused: false,
    timeScale: 1,
    clock: 'live',
    attract: false,
    hudVisible: true,
    creditsOpen: false,
    engineerOpen: false,
    quality: 'high',
    reducedMotion: false,
    driveMode: 'auto',
    driveAids: DEFAULT_AIDS,
    loading: 0,
    room: { code: null, role: null, connected: false, viewers: 0, dist: {} },
  };
}
```

### C7 `src/contracts/events.ts`
```ts
import type { Emitter } from 'mitt';
import type { DecodedReplay, DriveEvent, DriveMode } from './drive';
import type { PresenterCue } from './net';
import type { SimEvent } from './sim';
import type { ComponentRole } from './suspension';
import type { CornerId } from './units';

/**
 * Discrete, one-off events (mitt). RULES: past tense or `noun:verb`; plain payloads; never per frame;
 * state lives in the store (subscribe to it), events announce transitions the store cannot express.
 */
export type AppEvents = {
  /** Boot finished: first frame rendered, loading overlay can go. */
  'app:ready': undefined;
  'assets:progress': { loaded: number; total: number };
  /** Emitted by the kernel AFTER the simulation was rebuilt for a new vehicle: TelemetryFrame layout may have changed. */
  'sim:vehicle': { vehicleId: string; suspensionId: string };
  /** Emitted by the kernel AFTER the simulation swapped suspension. */
  'sim:suspension': { suspensionId: string; previous: string };
  /** REQUEST from a feature (section jump, replay, AI tool): the kernel seeks and sets clock = 'local'. */
  'sim:seek-to': { lapTime: number };
  /** Emitted by the kernel AFTER any seek (live-clock resync or a request). */
  'sim:seek': { lapTime: number };
  /** Forwarded from Simulation.drainEvents(). */
  'sim:event': SimEvent;
  /** Request the camera to frame a corner (null = whole car). */
  'camera:focus': { corner: CornerId | null };
  /** Glow a component role (AI tool, part labels, insights). */
  'highlight': { role: ComponentRole; corner: CornerId | 'all'; durationMs: number };
  /** An insight caption was shown (attract mode and analytics listen). */
  'insight:shown': { id: string; text: string };
  /** One-off presenter cue received from the room. */
  'room:cue': { cue: PresenterCue };
  /** Any pointer/keyboard/touch input on the app (attract mode exits on it). */
  'user:activity': undefined;
  /** REQUEST: who drives. 'auto' from manual = returning (autopilot); `immediate` = release now and rejoin the live lap (a cut). */
  'drive:request': { mode: 'auto' | 'manual'; immediate?: boolean };
  /** REQUEST (manual only): at rest on the nearest driving-line point, or at a station's spawn. */
  'drive:reset': { spawn?: string };
  /** REQUEST: replay a decoded run in the plant (mode 'replay'). */
  'drive:play': { replay: DecodedReplay };
  /** Emitted by the kernel AFTER the drive mode changed (store.driveMode is already updated). `cut` = discontinuous pose. */
  'drive:mode': { mode: DriveMode; previous: DriveMode; cut: boolean };
  /** Forwarded from Simulation.drive.drainEvents() (mode changes included). */
  'drive:event': DriveEvent;
};

export type AppBus = Emitter<AppEvents>;
```

### C8 `src/contracts/app.ts`
```ts
import type { AppBus, AppEvents } from './events';
import type { SuspensionVisualDefinition, VehicleVisualDefinition } from './services';
import type { Simulation } from './sim';
import type { AppState, AppStore, ViewMode } from './store';
import type { SuspensionDefinition } from './suspension';
import type { TelemetryFrame } from './telemetry';
import type { TrackDefinition } from './track';
import type { VehicleDefinition } from './vehicle';
import type { WorldDefinition } from './world';

// ---------------------------------------------------------------- registries

export interface Registry<T extends { readonly id: string }> {
  /** Throws on duplicate id. Returns an unregister function. */
  register(item: T): () => void;
  get(id: string): T | undefined;
  /** Throws `Unknown <kind> "<id>". Known: a, b, c`. */
  require(id: string): T;
  list(): readonly T[];
}

export interface Registries {
  readonly suspensions: Registry<SuspensionDefinition>;
  readonly vehicles: Registry<VehicleDefinition>;
  readonly tracks: Registry<TrackDefinition>;
  readonly vehicleVisuals: Registry<VehicleVisualDefinition>;
  readonly suspensionVisuals: Registry<SuspensionVisualDefinition>;
  /** Worlds around tracks (M2); the kernel passes the one whose trackId matches to the simulation. */
  readonly worlds: Registry<WorldDefinition>;
}

// ---------------------------------------------------------------- services (typed DI-light)

export interface ServiceKey<T> {
  readonly id: string;
  /** Phantom type carrier; never set. */
  readonly __type?: T;
}

export function serviceKey<T>(id: string): ServiceKey<T> {
  return { id };
}

export interface Services {
  /** Throws if already provided. In a FeatureContext the un-provide is registered as a disposer automatically. */
  provide<T>(key: ServiceKey<T>, impl: T): () => void;
  /** Throws if missing: use only for services of features listed in `requires`. */
  get<T>(key: ServiceKey<T>): T;
  /** Optional services: consumers must degrade gracefully when undefined. */
  tryGet<T>(key: ServiceKey<T>): T | undefined;
}

// ---------------------------------------------------------------- quality

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  /** Upper bound for renderer pixel ratio (the governor may go lower, never higher). */
  readonly maxPixelRatio: number;
  /** Lower bound the adaptive governor may reach. */
  readonly minPixelRatio: number;
  /** Directional shadow map size; 0 = no realtime shadow (baked contact blob only). */
  readonly shadowMapSize: number;
  readonly ambientOcclusion: 'off' | 'half';
  readonly bloom: boolean;
  readonly smaa: boolean;
  readonly anisotropy: number;
  /** Track ribbon longitudinal sample spacing, m. */
  readonly trackResolution: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityTier, QualitySettings>> = {
  low: { maxPixelRatio: 1, minPixelRatio: 0.6, shadowMapSize: 0, ambientOcclusion: 'off', bloom: false, smaa: false, anisotropy: 2, trackResolution: 1 },
  medium: { maxPixelRatio: 1.25, minPixelRatio: 0.75, shadowMapSize: 1024, ambientOcclusion: 'off', bloom: true, smaa: true, anisotropy: 4, trackResolution: 0.5 },
  high: { maxPixelRatio: 1.75, minPixelRatio: 0.85, shadowMapSize: 2048, ambientOcclusion: 'half', bloom: true, smaa: true, anisotropy: 8, trackResolution: 0.25 },
};

// ---------------------------------------------------------------- flags (URL)

/** Resolved once at boot by kernel/flags.ts from location.search. See ARCHITECTURE.md §8. */
export interface ResolvedFlags {
  /** Explicit feature overrides from ?features=-a,+b (true = force on, false = force off). */
  readonly features: Readonly<Record<string, boolean>>;
  readonly vehicle?: string;
  readonly suspension?: string;
  readonly view?: ViewMode;
  readonly quality?: QualityTier;
  /** ?t=<seconds>: start at this lap time (forces clock=local). */
  readonly lapTime?: number;
  readonly paused: boolean;
  readonly amplification?: number;
  readonly clock?: 'live' | 'local';
  /** ?attract=0|1 overrides idle-driven attract mode. */
  readonly attract?: boolean;
  /** ?room=CODE joins a private room instead of the public one. */
  readonly room?: string;
  /** ?screen=1: this device is the presenter's big screen (creates a room, follows host commands). */
  readonly screen: boolean;
  /** ?debug=1: dev panels/stats. */
  readonly debug: boolean;
  /** ?e2e=1: deterministic test mode (no idle attract, no network room, fixed DPR 1, window.__app hooks). */
  readonly e2e: boolean;
  /** ?drive=manual: request Manual Drive after the first frame (M2). */
  readonly drive?: 'manual';
  /** ?spawn=<station id>: with Manual Drive, place the car at that station (M2). */
  readonly spawn?: string;
}

// ---------------------------------------------------------------- clock, assets

export interface Clock {
  /** Server-synchronised unix ms (local Date.now() + offset until synced). */
  serverNow(): number;
  /** Set by the live-lab feature after time sync. */
  setOffset(ms: number): void;
  readonly synced: boolean;
}

export interface Attribution {
  readonly title: string;
  readonly author: string;
  readonly authorUrl?: string;
  /** SPDX-ish id, e.g. "CC-BY-4.0", "CC0-1.0". */
  readonly license: string;
  readonly licenseUrl: string;
  readonly sourceUrl: string;
  /** "Changes indicated" text required by CC BY. */
  readonly modified?: string;
  /** assets-src relative paths covered by this entry. */
  readonly files: readonly string[];
}

export interface AssetEntry {
  readonly id: string;
  /** Content-hashed public URL, e.g. /assets/car/db11.3f9a1c2e.glb */
  readonly url: string;
  readonly bytes: number;
}

/** Written by scripts/build-assets.mjs to public/assets/manifest.json. */
export interface AssetManifest {
  readonly version: 1;
  readonly assets: Readonly<Record<string, AssetEntry>>;
  readonly attributions: readonly Attribution[];
}

export interface Assets {
  readonly manifest: AssetManifest;
  /** Throws for unknown ids. Ids are logical, e.g. 'car/db11', 'hdri/track', 'tex/asphalt/diff'. */
  url(id: string): string;
}

// ---------------------------------------------------------------- context and modules

export interface SimHost {
  /** The current simulation. REPLACED on vehicle change: never cache it across 'sim:vehicle'. */
  readonly current: Simulation;
  /** Frame sampled for the current render frame (same object as FrameInfo.t). */
  readonly frame: TelemetryFrame;
}

export interface AppContext {
  readonly store: AppStore;
  readonly bus: AppBus;
  readonly registries: Registries;
  readonly services: Services;
  readonly flags: ResolvedFlags;
  readonly clock: Clock;
  readonly assets: Assets;
  readonly sim: SimHost;
  readonly dom: {
    /** Element that hosts the WebGL canvas (full-viewport). */
    readonly stage: HTMLElement;
    /** Full-viewport overlay for DOM UI (pointer-events: none; children opt in). */
    readonly overlay: HTMLElement;
  };
}

export interface FeatureContext extends AppContext {
  readonly featureId: string;
  /** Teardown run (in reverse order) when the feature is disabled/disposed. */
  addDisposer(fn: () => void): void;
  /** bus.on that auto-unsubscribes on dispose. */
  on<K extends keyof AppEvents>(type: K, handler: (payload: AppEvents[K]) => void): void;
  /** store.subscribe (fires immediately) that auto-unsubscribes on dispose. */
  watch(handler: (state: Readonly<AppState>) => void): void;
}

/**
 * Per-render-frame phases, run in this order. Inside a phase: dependency order (`requires`),
 * then alphabetical id. 'render' is owned by the renderer feature only.
 */
export type FramePhase = 'scene' | 'camera' | 'render' | 'overlay';

export interface FrameInfo {
  /** Render dt, s (clamped to MAX_FRAME_DT). */
  readonly dt: number;
  /** performance.now() / 1000. */
  readonly time: number;
  /** Interpolation factor used for this frame's sample. */
  readonly alpha: number;
  /** The sampled telemetry for this frame (sim-owned; do not mutate). */
  readonly t: TelemetryFrame;
}

export interface FeatureModule {
  /** kebab-case, equals the folder name under src/features/. */
  readonly id: string;
  /** Hard dependencies: initialised first; this feature is disabled if any is disabled. */
  readonly requires?: readonly string[];
  /** Default true. */
  readonly defaultEnabled?: boolean;
  /** Default 'scene'. */
  readonly phase?: FramePhase;
  /** Register content (definitions/visual builders). Called for ALL enabled features BEFORE the simulation is created. */
  contribute?(registries: Registries): void;
  /** Acquire resources. Everything acquired must be released via ctx.addDisposer or dispose(). */
  init?(ctx: FeatureContext): void | Promise<void>;
  /** Called every rendered frame in `phase`. Must not allocate. */
  update?(frame: FrameInfo): void;
  /** Optional explicit teardown (runs before registered disposers). Must be idempotent. */
  dispose?(): void;
}
```

### C9 `src/contracts/services.ts`
```ts
/**
 * Client-only service contracts (import three.js TYPES). sim-core and worker/ must NOT import this file.
 */
import type { Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { serviceKey, type Assets, type QualitySettings } from './app';
import type { DriveIntent, DriveSource } from './drive';
import type { ClientMessage, RoomRole, ServerMessage } from './net';
import type { ComponentRole, SuspensionDefinition } from './suspension';
import type { TelemetryFrame } from './telemetry';
import type { CornerId } from './units';
import type { VehicleDefinition } from './vehicle';

export interface RenderStats {
  readonly fps: number;
  readonly frameMs: number;
  readonly calls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly pixelRatio: number;
}

/** Provided by the `renderer` feature. Scene is Y-up (see units.ts for the sim->three mapping). */
export interface RenderService {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  /** Owned by renderer, posed exclusively by the `camera` feature. */
  readonly camera: PerspectiveCamera;
  /** Adds to the scene; returns the remover (register it with ctx.addDisposer). */
  add(object: Object3D): () => void;
  /** Effective settings: tier preset; pixel ratio adjusted by the adaptive governor. */
  readonly quality: QualitySettings;
  /** Compile all programs for what is currently in the scene (call behind the loading overlay). */
  compile(): Promise<void>;
  stats(): RenderStats;
}

export type ShotKind = 'chase' | 'orbit' | 'closeup' | 'trackside' | 'overhead' | 'front-view';

export interface DirectorShot {
  readonly kind: ShotKind;
  readonly corner?: CornerId;
  readonly durationS: number;
  /** Vertical FOV, deg (default per kind). */
  readonly fov?: number;
}

/** Provided by the `camera` feature. View mode itself is store state (AppState.view). */
export interface CameraService {
  /** Scripted shot (attract mode, presenter cues). Cleared by clearShot(), a view change or user input. */
  playShot(shot: DirectorShot): void;
  clearShot(): void;
  readonly transitioning: boolean;
}

/** Provided by the `live-lab` feature (one WebSocket per app). */
export interface RoomService {
  readonly code: string | null;
  readonly role: RoomRole | null;
  /** Only set on the big screen that created the room (shown as QR fragment #k=). */
  readonly hostKey: string | null;
  /** Phone-driver pairing key, only on the big screen that created the room (QR fragment #d=) (M2). */
  readonly driverKey?: string | null;
  readonly connected: boolean;
  send(message: ClientMessage): void;
  on<T extends ServerMessage['t']>(type: T, handler: (message: Extract<ServerMessage, { t: T }>) => void): () => void;
}

/** An input device feeding Manual Drive (M2): keyboard, gamepad, touch (drive feature), phone (phone-drive). */
export interface DriveIntentSource {
  readonly id: DriveSource;
  /** Writes the device's current intent; returns true while it shows deliberate input (beyond dead zones). */
  read(out: DriveIntent): boolean;
}

/** Provided by the `drive` feature: arbitrates sources (most recent deliberate input wins, 1 s hysteresis) and feeds
 * Simulation.drive.setIntent; requests Manual on a fresh deliberate input while in auto or returning. */
export interface DriveService {
  /** Returns the remover (register it with ctx.addDisposer). */
  addSource(source: DriveIntentSource): () => void;
  readonly activeSource: DriveSource | null;
}

export const RENDER = serviceKey<RenderService>('render');
export const CAMERA = serviceKey<CameraService>('camera');
export const ROOM = serviceKey<RoomService>('room');
export const DRIVE = serviceKey<DriveService>('drive');

// ---------------------------------------------------------------- visual builders (contributed via registries)

export interface VisualContext {
  readonly assets: Assets;
  readonly render: RenderService;
}

export interface VehicleVisual {
  /** Added to the scene by `vehicle-view`. */
  readonly root: Object3D;
  /** Pose body and wheels from POSE fields (sim frame -> three via simToThree). Must not allocate. */
  update(t: TelemetryFrame): void;
  /** 0 = opaque body, 1 = fully ghosted (x-ray). */
  setXray(amount: number): void;
  dispose(): void;
}

export interface VehicleVisualDefinition {
  /** Equals VehicleDefinition.visualKey. */
  readonly id: string;
  load(vehicle: VehicleDefinition, ctx: VisualContext): Promise<VehicleVisual>;
}

export interface SuspensionVisual {
  readonly root: Object3D;
  /** Drive parts from CornerFrame.points / springLength (POSE fields). Must not allocate. */
  update(t: TelemetryFrame): void;
  setHighlight(role: ComponentRole, corner: CornerId | 'all', on: boolean): void;
  dispose(): void;
}

export interface SuspensionVisualDefinition {
  /** Equals SuspensionDefinition.visualKey. */
  readonly id: string;
  build(suspension: SuspensionDefinition, vehicle: VehicleDefinition, ctx: VisualContext): SuspensionVisual;
}
```

### C10 `src/contracts/net.ts`
```ts
/**
 * Worker HTTP API + room WebSocket protocol. Shared by src/ (client) and worker/ (server).
 * Types only + constants. Runtime validation lives in worker/schemas.ts (zod), type-tested against these.
 */
import type { ViewMode, OverlayLevel } from './store';

export const API = {
  health: '/api/health',
  time: '/api/time',
  rooms: '/api/rooms',
  engineer: '/api/engineer',
  event: '/api/event',
  /** POST saves a replay (Turnstile + limits); GET `${API.replays}/<id>` loads one (M2). */
  replays: '/api/replays',
  /** GET `?station=<id>&suspension=<id>` (M2 stretch): crowd distribution of station entry speeds, cached. */
  insight: '/api/insight',
} as const;

/** WebSocket upgrade path: `/ws/<CODE>?id=&role=&v=&s=&pv=` (a host's or driver's key goes in its first frame, `auth`). */
export const WS_PREFIX = '/ws/';
/** Short audience link: GET /r/<CODE> -> 302 /remote.html?room=<CODE> */
export const REMOTE_PREFIX = '/r/';
export const REMOTE_PAGE = '/remote.html';
/** Public room everyone joins by default (cannot have a host; not producible by the code alphabet). */
export const PUBLIC_ROOM = 'LIVE';
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const PROTOCOL_VERSION = 3;

export const NET_LIMITS = {
  wsMessageBytes: 1024,
  wsMessagesPerSecond: 5,
  wsBurst: 10,
  presenceFlushMs: 1000,
  roomIdleTtlMs: 12 * 3600 * 1000,
  pollQuestionChars: 120,
  pollOptionChars: 40,
  pollOptionsMax: 4,
  engineerQuestionChars: 280,
  engineerHistoryMax: 6,
  engineerHistoryChars: 600,
  /** Phone driver (M2): input frames per second, burst and frame size. */
  driverMessagesPerSecond: 90,
  driverBurst: 30,
  driverMessageBytes: 128,
  /** Screen -> driver telemetry frames per second. */
  telemetryPerSecond: 5,
  /** Live ghosts (M2 stretch): position frames per second per viewer. */
  ghostPerSecond: 10,
} as const;

// ---------------------------------------------------------------- HTTP

export interface HealthResponse {
  readonly ok: true;
  /** Git short sha or package version baked at build. */
  readonly version: string;
  readonly time: number;
}

/** GET /api/time (Cache-Control: no-store). */
export interface TimeResponse {
  /** Server unix ms stamped immediately before responding. */
  readonly t: number;
}

/** POST /api/rooms (rate limited). The host key is shown only on the big screen (QR fragment #k=). */
export interface CreateRoomResponse {
  readonly code: string;
  readonly hostKey: string;
  /** Phone-driver pairing key (M2; QR fragment #d=). Absent from servers older than protocol 3. */
  readonly driverKey?: string;
}

/** POST /api/event -> 204. Anonymous; written to Analytics Engine. No ids, no IP stored. */
export type AnalyticsEvent =
  | { readonly type: 'suspension-picked'; readonly vehicle: string; readonly suspension: string }
  | { readonly type: 'view-changed'; readonly view: ViewMode }
  | { readonly type: 'engineer-asked'; readonly suspension: string }
  | { readonly type: 'session'; readonly quality: string; readonly fps: number }
  /** M2: one Manual Drive session ended (seconds driven, bucketed by the client to whole seconds). */
  | { readonly type: 'drive-session'; readonly vehicle: string; readonly suspension: string; readonly seconds: number }
  /** M2: a station of the proving ground was entered while driving, at `speed` m/s (rounded to an integer). */
  | { readonly type: 'station-visit'; readonly station: string; readonly suspension: string; readonly speed: number };

export interface ErrorResponse {
  readonly error: string;
}

// ---------------------------------------------------------------- replays (M2)

export const REPLAY_API = {
  /** Compressed replay bytes accepted (before base64url). */
  maxBytes: 65536,
  ttlMs: 30 * 24 * 3600 * 1000,
  /** Saves per address per minute and per UTC day (all addresses). */
  perMinute: 5,
  perDay: 2000,
  /** Id alphabet = ROOM_CODE_ALPHABET, this many characters (about 59 bits). */
  idLength: 12,
} as const;

/** POST /api/replays. `data` = base64url of the deflate-raw-compressed encoded replay (sim-core replay/format.ts). */
export interface ReplaySaveRequest {
  /** Cloudflare Turnstile token (single use, 300 s). */
  readonly token: string;
  readonly data: string;
}

export interface ReplaySaveResponse {
  readonly id: string;
  /** Unix ms. */
  readonly expiresAt: number;
}

/** GET /api/replays/<id>. */
export interface ReplayGetResponse {
  readonly data: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** GET /api/insight (M2 stretch). Shares of visitors' entry speeds in 2 m/s buckets; n < 30 => buckets empty. */
export interface InsightResponse {
  readonly station: string;
  readonly suspension: string;
  readonly n: number;
  /** [bucket start, m/s; share 0..1]. */
  readonly buckets: readonly (readonly [speed: number, share: number])[];
}

// ---------------------------------------------------------------- WebSocket rooms

/**
 * viewer   = normal app (presence only; ignores presenter commands)
 * screen   = presenter's big screen (applies `ctl` state and cues)
 * host     = phone remote with the host key (may send `ctl`)
 * audience = phone on /remote.html without key (may vote)
 * driver   = phone with the driver key (M2): streams input frames to the screen(s); one at a time, newest wins
 */
export type RoomRole = 'viewer' | 'screen' | 'host' | 'audience' | 'driver';

/** Controls the host can set; the screen applies them to its store. */
export interface PresenterControls {
  readonly vehicleId?: string;
  readonly suspensionId?: string;
  readonly view?: ViewMode;
  readonly xray?: boolean;
  readonly overlay?: OverlayLevel;
  readonly timeScale?: number;
  readonly amplification?: number;
  readonly attract?: boolean;
  /** Section id to jump to (screen seeks). */
  readonly section?: string;
}

export interface PresenterState extends PresenterControls {
  /** Monotonic per room; screens ignore stale state. */
  readonly seq: number;
}

export type PresenterCue = 'replay-section' | 'focus-front-left' | 'focus-car';

export interface PollState {
  readonly id: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly counts: readonly number[];
  readonly open: boolean;
}

export type ClientMessage =
  /** Host / driver only, first frame after every open; welcome follows, wrong key closes 4401. Keeps keys out of URLs/logs. */
  | { readonly t: 'auth'; readonly k: string }
  /** NTP-style probe: c0 = client performance.now() at send. */
  | { readonly t: 'sync'; readonly c0: number }
  /** Presence: what this viewer is running now. */
  | { readonly t: 'pick'; readonly vehicleId: string; readonly suspensionId: string }
  /** Host only. */
  | { readonly t: 'ctl'; readonly set: PresenterControls }
  /** Host only. */
  | { readonly t: 'cue'; readonly cue: PresenterCue }
  /** Host only: open a poll (null closes the open poll, or clears a closed one). */
  | { readonly t: 'poll'; readonly poll: { readonly question: string; readonly options: readonly string[] } | null }
  /** Audience/viewer: one vote per client id per poll (re-vote replaces). */
  | { readonly t: 'vote'; readonly pollId: string; readonly choice: number }
  /**
   * Driver only (M2), ~30 Hz + on pedal edges: n = sequence (u32, wraps), s = steer -1000..1000 (+ LEFT, after the
   * phone's dead zone and curve), th / br = throttle / brake 0..1000, f = flags (1 drive wanted, 2 handbrake, 4 touch).
   */
  | { readonly t: 'in'; readonly n: number; readonly s: number; readonly th: number; readonly br: number; readonly f: number }
  /** Screen only (M2), <= telemetryPerSecond: speed km/h (integer), gear, drive mode index (DriveMode order
   * auto, manual, returning, replay), k = haptic pulse bits (1 kerb/bump stop, 2 grip limit). Relayed to the driver. */
  | { readonly t: 'tel'; readonly v: number; readonly g: number; readonly m: number; readonly k: number }
  /** Viewer (M2 stretch, live ghosts), <= ghostPerSecond: world x, y (dm, integers), yaw (mrad), speed (cm/s). */
  | { readonly t: 'gst'; readonly x: number; readonly y: number; readonly h: number; readonly v: number };
// Heartbeat: the literal text frame "ping" (answered "pong" by the runtime without waking the DO).

export interface PresenceSnapshot {
  readonly viewers: number;
  /** Authenticated hosts (phone remotes) connected; never counted in `viewers`. */
  readonly hosts: number;
  /** Authenticated phone drivers connected (M2; 0 or 1); never counted in `viewers`. */
  readonly drivers?: number;
  readonly dist: Readonly<Record<string, number>>;
}

export type ServerMessage =
  | {
      readonly t: 'welcome';
      readonly id: string;
      readonly role: RoomRole;
      readonly serverNow: number;
      readonly presence: PresenceSnapshot;
      readonly ctl: PresenterState;
      readonly poll: PollState | null;
    }
  | { readonly t: 'sync'; readonly c0: number; readonly s1: number }
  /** Coalesced to <= 1 Hz. */
  | ({ readonly t: 'presence' } & PresenceSnapshot)
  | { readonly t: 'ctl'; readonly state: PresenterState }
  | { readonly t: 'cue'; readonly seq: number; readonly cue: PresenterCue }
  /** Coalesced to <= 2 Hz. */
  | { readonly t: 'poll'; readonly poll: PollState | null }
  | { readonly t: 'err'; readonly code: 'rate' | 'too-big' | 'bad-message' | 'forbidden' }
  /** To screens only (M2): a driver input frame plus r = the room's receive time (Date.now()) for link-age estimates. */
  | { readonly t: 'in'; readonly n: number; readonly s: number; readonly th: number; readonly br: number; readonly f: number; readonly r: number }
  /** To the driver only (M2): the screen's latest telemetry. */
  | { readonly t: 'tel'; readonly v: number; readonly g: number; readonly m: number; readonly k: number }
  /** M2 stretch: other viewers' cars, aggregated <= 10 Hz: [slot, x dm, y dm, yaw mrad, speed cm/s]. */
  | { readonly t: 'gsts'; readonly c: readonly (readonly [slot: number, x: number, y: number, h: number, v: number])[] };
```

### C11 `src/contracts/engineer.ts`
```ts
/**
 * AI Race Engineer: POST /api/engineer. Wire format uses DISPLAY units with explicit suffixes.
 * The client computes every number; the model may only quote numbers present in `telemetry`
 * (the worker enforces this and falls back otherwise). Tools are executed in the browser.
 */
import type { ViewMode } from './store';
import type { ComponentRole, VehicleClass } from './suspension';
import type { CornerId } from './units';

export const ENGINEER_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const ENGINEER_FALLBACK_MODEL = '@cf/zai-org/glm-4.7-flash';
export const ENGINEER_MAX_OUTPUT_TOKENS = 160;
export const ENGINEER_MAX_ACTIONS = 2;

export interface EngineerCorner {
  readonly camber_deg: number;
  readonly toe_deg: number;
  readonly travel_mm: number;
  readonly load_n: number;
  readonly grip_use: number;
}

export interface EngineerTelemetry {
  readonly vehicle_class: VehicleClass;
  readonly vehicle: string;
  readonly suspension: string;
  /** Track section id + display name. */
  readonly section: string;
  readonly section_name: string;
  /** Client-derived plain-language label, e.g. "mid-corner, left-hander, outside wheel loaded". */
  readonly event: string;
  readonly speed_kmh: number;
  readonly lat_g: number;
  readonly long_g: number;
  readonly roll_deg: number;
  readonly pitch_deg: number;
  readonly corners: Readonly<Partial<Record<CornerId, EngineerCorner>>>;
  /** Extra computed values, e.g. { roll_centre_front_mm: 62, camber_gain_front_deg_per_10mm: -0.4 }. */
  readonly derived: Readonly<Record<string, number>>;
  /** Present while the visitor drives (M2): driver inputs and the event a sim-core detector fired. */
  readonly drive?: EngineerDrive;
}

/** Manual Drive context (M2). The model explains `detected`; it never infers events from raw numbers. */
export interface EngineerDrive {
  readonly mode: 'manual' | 'returning' | 'replay';
  /** Plain-language label of the detected event, no digits, e.g. "rear slide after lifting off" or "none". */
  readonly detected: string;
  readonly steer_deg: number;
  readonly throttle_pct: number;
  readonly brake_pct: number;
  readonly sideslip_deg: number;
  readonly yaw_rate_dps: number;
  readonly gear: number;
  /** Surface label under the car, e.g. "Wet basalt tiles". */
  readonly surface: string;
  readonly aids_active: readonly ('abs' | 'traction' | 'stability')[];
}

export interface EngineerTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface EngineerRequest {
  /** 1..NET_LIMITS.engineerQuestionChars */
  readonly question: string;
  readonly telemetry: EngineerTelemetry;
  /** <= NET_LIMITS.engineerHistoryMax turns. */
  readonly history: readonly EngineerTurn[];
}

export type EngineerAction =
  | { readonly tool: 'switch_suspension'; readonly args: { readonly id: string } }
  | { readonly tool: 'set_view'; readonly args: { readonly view: ViewMode; readonly corner?: CornerId } }
  | { readonly tool: 'set_slow_motion'; readonly args: { readonly scale: number } }
  | { readonly tool: 'highlight_component'; readonly args: { readonly component: ComponentRole; readonly corner: CornerId | 'all' } }
  | { readonly tool: 'jump_to_section'; readonly args: { readonly section: string } };

export type EngineerToolName = EngineerAction['tool'];

export interface EngineerResponse {
  /** 1-3 sentences, plain text. */
  readonly text: string;
  /** Validated, at most ENGINEER_MAX_ACTIONS. */
  readonly actions: readonly EngineerAction[];
  /** 'fallback' = rule-based answer (quota, error, failed number check). */
  readonly source: 'model' | 'fallback';
}

/** OpenAI-style function tool schema (Workers AI `tools` parameter). */
export interface ToolSchema {
  readonly type: 'function';
  readonly function: {
    readonly name: EngineerToolName;
    readonly description: string;
    readonly parameters: {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, unknown>>;
      readonly required: readonly string[];
    };
  };
}

const COMPONENTS: readonly ComponentRole[] = [
  'upper-arm', 'lower-arm', 'lateral-link', 'trailing-link', 'tie-rod', 'strut', 'spring', 'damper',
  'upright', 'anti-roll-bar', 'fork', 'swingarm', 'linkage', 'tyre',
];
const CORNERS: readonly CornerId[] = ['fl', 'fr', 'rl', 'rr', 'f', 'r'];

/** Tool schemas with enums filled from content (suspension ids of the active vehicle class, track section ids). */
export function buildEngineerTools(ids: { readonly suspensions: readonly string[]; readonly sections: readonly string[] }): ToolSchema[] {
  const fn = (name: EngineerToolName, description: string, properties: Record<string, unknown>, required: string[]): ToolSchema => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });
  return [
    fn('switch_suspension', 'Switch the vehicle to a different suspension type.', { id: { type: 'string', enum: ids.suspensions } }, ['id']),
    fn('set_view', 'Change the camera: follow the car, explore freely, or a suspension close-up of one corner.', {
      view: { type: 'string', enum: ['follow', 'explore', 'closeup'] },
      corner: { type: 'string', enum: CORNERS },
    }, ['view']),
    fn('set_slow_motion', 'Set simulation speed. 1 = normal, 0.1 = very slow.', { scale: { type: 'number', minimum: 0.1, maximum: 1 } }, ['scale']),
    fn('highlight_component', 'Make one suspension component glow.', {
      component: { type: 'string', enum: COMPONENTS },
      corner: { type: 'string', enum: [...CORNERS, 'all'] },
    }, ['component', 'corner']),
    fn('jump_to_section', 'Move the car to the start of a named track section.', { section: { type: 'string', enum: ids.sections } }, ['section']),
  ];
}
```

### F1 `src/app/features.ts`
```ts
// THE feature registration file (ARCHITECTURE.md §9, ARCHITECTURE-M2.md §9). One line per feature, alphabetical.
// Adding a feature = create src/features/<id>/index.ts + add one line here. Removing = delete the line.
export { default as analytics } from '../features/analytics/index';
export { default as attract } from '../features/attract/index';
export { default as audio } from '../features/audio/index';
export { default as camera } from '../features/camera/index';
export { default as car } from '../features/car/index';
export { default as coach } from '../features/coach/index';
export { default as controls } from '../features/controls/index';
export { default as credits } from '../features/credits/index';
export { default as debug } from '../features/debug/index';
export { default as drive } from '../features/drive/index';
export { default as engineer } from '../features/engineer/index';
export { default as environment } from '../features/environment/index';
export { default as ghostLab } from '../features/ghost-lab/index';
export { default as insights } from '../features/insights/index';
export { default as linkageParts } from '../features/linkage-parts/index';
export { default as liveGhosts } from '../features/live-ghosts/index';
export { default as liveLab } from '../features/live-lab/index';
export { default as motorcycle } from '../features/motorcycle/index';
export { default as phoneDrive } from '../features/phone-drive/index';
export { default as poll } from '../features/poll/index';
export { default as presenter } from '../features/presenter/index';
export { default as provingGround } from '../features/proving-ground/index';
export { default as renderer } from '../features/renderer/index';
export { default as replay } from '../features/replay/index';
export { default as teachingOverlays } from '../features/teaching-overlays/index';
export { default as telemetryPanel } from '../features/telemetry-panel/index';
export { default as track } from '../features/track/index';
export { default as tyreVfx } from '../features/tyre-vfx/index';
export { default as vehicleView } from '../features/vehicle-view/index';
```
Stub template for the eight new folders (08-01; keep id/requires/phase/defaultEnabled exactly):
```ts
import type { FeatureModule } from '../../contracts/app';
/** STUB — owner: see ROADMAP-M2.md. Keep id/requires/phase/defaultEnabled; replace the body. */
export default { id: '<id>', requires: <requires>, phase: '<phase>'<, defaultEnabled: false> } satisfies FeatureModule;
```
| id | phase | requires | defaultEnabled |
|---|---|---|---|
| drive | overlay | `[]` | on |
| proving-ground | scene | `['renderer']` | on |
| tyre-vfx | scene | `['renderer']` | on |
| coach | overlay | `[]` | on |
| replay | overlay | `[]` | on |
| ghost-lab | scene | `['renderer']` | on |
| phone-drive | overlay | `['drive', 'live-lab']` | on |
| live-ghosts | scene | `['live-lab', 'renderer']` | **false** (stretch) |

**Compile shims 08-01 must add so the tree stays green** (verified against the current code): `src/kernel/registry.ts`
creates `worlds: createRegistry('world')`; `tests/kernel/registry.test.ts` expects six registries; `worker/room-logic.ts`
`reduceMessage` handles `case 'in': case 'tel': case 'gst': return [forbidden];` (12-02 replaces); `worker/schemas/event.ts`
adds the two new `AnalyticsEvent` variants (`drive-session`: seconds int 0–86400; `station-visit`: speed int 0–100) and
`worker/routes/event.ts` maps them (`blobs [type, vehicle|station, suspension]`, `doubles [seconds|speed]`). With these,
`tsc` passes for all three programs (checked by the architect on a scratch copy of the tree).

### W1 `wrangler.jsonc`
(12-01 creates the D1 database with `npx wrangler d1 create suspension-lab-replays`, then replaces the all-zero
`database_id` in BOTH this block and the file with the real id, in one commit.)
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "suspension-lab",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-11-20",
  "upload_source_maps": true,
  "workers_dev": true,
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/ws/*", "/r/*"]
  },
  "durable_objects": {
    "bindings": [
      { "name": "ROOM", "class_name": "Room" },
      { "name": "LIMITER", "class_name": "Limiter" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["Room"] },
    { "tag": "v2", "new_sqlite_classes": ["Limiter"] }
  ],
  "d1_databases": [
    {
      "binding": "REPLAYS",
      "database_name": "suspension-lab-replays",
      "database_id": "012e9d77-53a2-46b2-b1df-57a244e5d078",
      "migrations_dir": "worker/migrations"
    }
  ],
  "ai": { "binding": "AI", "remote": true },
  "analytics_engine_datasets": [{ "binding": "STATS", "dataset": "suspension_lab_events" }],
  "vars": { "APP_VERSION": "dev" },
  "observability": { "enabled": true, "head_sampling_rate": 1 }
}
```

### W2 `worker/index.ts`
```ts
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import engineer from './routes/engineer';
import event from './routes/event';
import health from './routes/health';
import insight from './routes/insight';
import replays from './routes/replays';
import rooms from './routes/rooms';
import time from './routes/time';

export { Limiter } from './limiter';
export { Room } from './room';

const app = new Hono<{ Bindings: Env }>();
app.use('/api/*', secureHeaders());
// Every API answer is per request (errors and 404s included): never cached by a browser or an edge.
app.use('/api/*', async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
});
app.route('/', health);
app.route('/', time);
app.route('/', rooms);
app.route('/', engineer);
app.route('/', event);
app.route('/', replays);
app.route('/', insight);
app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});

export default app;
```

## 6. Kernel behaviour changes (plan 08-01; ARCHITECTURE §6 otherwise unchanged)

6.1 **Boot** (§6.2 additions): the catalog passed to `createSimulation` gains
`world: (trackId) => registries.worlds.list().find((w) => w.trackId === trackId)`. After the simulation exists:
`sim.drive?.setAids(store.driveAids)`. After the first rendered frame: if `flags.drive === 'manual'` emit
`drive:request {mode:'manual'}`; if additionally `flags.spawn` emit `drive:reset {spawn}` (the sim applies it once
manual is engaged; a reset requested in auto is ignored with a warning).

6.2 **Sim host** (§6.4 additions; handlers are no-ops when `sim.drive` is absent):
- `drive:request {mode:'manual'}` → warn and stop if `!sim.drive.available`; else `store.clock = 'local'`,
  `store.paused = false`, `sim.drive.request('manual')`.
- `drive:request {mode:'auto'}` → `sim.drive.request('auto')` (returning). With `immediate: true` → set `store.clock =
  'live'` (the existing clock watcher seeks to the live target; `sim.seek` releases the plant first — a cut).
- `drive:reset {spawn}` → `sim.drive.reset(spawn)`; `drive:play {replay}` → `store.clock = 'local'`, `paused = false`,
  `if (!sim.drive.play(replay)) warn`.
- `sim:seek-to` while `sim.drive.mode !== 'auto'` → ignored with `warn('Seek ignored while driving')`.
- `store.driveAids` change → `sim.drive.setAids(...)`. `store.driveMode` is never applied (it is a mirror).
- `vehicleId` / `suspensionId` handling unchanged: the simulation itself releases on `setVehicle` and keeps the plant on
  `setSuspension` outside auto; replay start may switch the suspension inside the sim — after `drive:play` and after each
  `drive:mode` the host writes `store.suspensionId = sim.suspension.id` if it differs (the existing listener returns early
  on equality, so no re-apply).

6.3 **Loop** (§6.3 addition, in `render()` right after `drainEvents(emitSimEvent)`):
`host.current.drive?.drainEvents((e) => { if (e.kind === 'mode') { store.setKey('driveMode', e.mode); syncSuspension();
bus.emit('drive:mode', { mode: e.mode, previous: e.previous, cut: e.cut }); } bus.emit('drive:event', e); })`.
A `cut` mode change also sets `host.acc = 0`.

6.4 **Flags** (§8 additions): `drive` = `manual` (only value); `spawn` = station id (`ID_RE`). Unknown values warn.

6.5 **Test hooks** (§6.6 additions, JSON-safe):
```ts
drive(): { mode: DriveMode; available: boolean; x: number; y: number; yaw: number; u: number; v: number; speed: number;
           steer: number; gear: number; engineRpm: number; zone: string; approximate: boolean; detached: boolean; faults: number;
           corners: { id: string; fx: number; fy: number; capacity: number; slipAngle: number; slipRatio: number; omega: number; surface: string }[] };
driveIntent(intent: Partial<DriveIntent> | null): void;   // test-only override, merged onto neutralIntent() with digital=false; the loop
                                                           // re-applies it via sim.drive.setIntent right before the fixed steps of every
                                                           // frame and before advance(), so it wins over device sources; null clears
driveHash(seed: number, seconds: number): string;          // runDriveScript on a FRESH simulation (same catalog), see §7.12
```

6.6 `src/sim-core/drive/script.ts` (08-01, contracts-only code so it compiles before the plant exists):
`runDriveScript(sim: Simulation, seed: number, seconds: number): string` — `sim.seek(10)`, `sim.drive.request('manual')`,
then for `seconds` at 240 Hz: every `CONTROL_TICKS` steps a seeded (mulberry32 from `math/rng.ts`) piecewise-smooth intent
(steer target changes every 1.5 s within ±0.6, throttle 0.2–0.8, brake pulses 10 % of the time), `sim.step(SIM_DT)`;
every 24 steps hash `sim.sample(1, 1)` TRUE drive fields (`drive.x, y, yaw, u, v, corners[i].travel, load, omega`) with
the golden's FNV-1a over `Math.round(v·1e6)` int pairs; returns 8 hex chars, or `'no-drive'` if `!sim.drive?.available`.
Exported from `sim-core/index.ts`.

## 7. sim-core Manual Drive

### 7.1 Binding internal signatures (not byte-compared; executors keep these names and shapes)
```ts
// ---- math/det.ts (08-02): + - * / sqrt only. Max error 1 ulp vs a correctly rounded reference on the test grid.
export function dsin(x: number): number;   export function dcos(x: number): number;   export function dtan(x: number): number;
export function datan(x: number): number;  export function datan2(y: number, x: number): number;
export function dasin(x: number): number;  export function dacos(x: number): number;
export function dexp(x: number): number;   export function dlog(x: number): number;
export function dpow(x: number, y: number): number;   // x > 0 (dexp(y·dlog x)); integer |y| <= 16 by repeated squaring
export function dtanh(x: number): number;  export function dhypot(x: number, y: number): number; // Math.sqrt(x*x + y*y)
export function dwrapPi(a: number): number;           // to (-pi, pi]

// ---- world/project.ts (08-02)
export function createLoopProjector(track: BuiltTrack): (x: number, y: number, hint: number, out: Frenet) => Frenet;
// ---- world/terrain.ts (08-02): the M1 features/track/terrain.ts groundHeight/farField maths, same constants
export function loopTerrainHeight(track: BuiltTrack, x: number, y: number, s: number, l: number, scratch: TrackSample): number;
// ---- world/ground.ts (08-02; 10-02 adds zones/field/bounds)
export const LOOP_CORRIDOR = 18;      // m: |l| of the drawn ribbon (width/2 + kerb + runoff of the proving loop)
export const OUT_OF_BOUNDS = 60;      // m beyond the loop centreline / 40 m beyond the field / 30 m beyond a zone
export function buildGroundWorld(track: BuiltTrack, def: WorldDefinition | null): GroundWorld;
export function loopSurface(track: BuiltTrack, s: number, l: number): SurfaceKind;   // corridor band rule (§8.1), allocation-free

// ---- drive/types.ts (08-02)
export interface DriveCommand { steer: number /* rad, road-wheel target, + left */; throttle: number; brake: number; handbrake: number; direction: 1 | -1 }
export interface QuantIntent { steer: number; throttle: number; brake: number; handbrake: number; flags: number } // integers (INTENT_QUANT)
export function quantiseIntent(intent: Readonly<DriveIntent>, out: QuantIntent): QuantIntent;  // Math.round, clamps, flags bit0 digital, bits1-3 source
export interface PlantView {
  readonly x: number; readonly y: number; readonly cosYaw: number; readonly sinYaw: number;
  readonly u: number; readonly v: number; readonly r: number;
  readonly steer: number;          // actuator output (mean road-wheel), rad
  readonly beta: number;           // atan2(v, |u|) via datan2, 0 below 1 m/s
  readonly wheelbase: number; readonly maxSteer: number;
  readonly lateralLimit: number;   // 0.9 * vehicle.front.tyre.mu * G, m/s^2 (steering limit and ESC clamp)
  readonly simTime: number;
}
export interface Driver {
  engage(view: PlantView, previous: Readonly<DriveCommand>): void;   // bumpless start from the command in force
  step(dt: number, view: PlantView, out: DriveCommand): void;
}
// ---- drive/human-driver.ts (08-02; steering assist + countersteer 09-04)
export interface HumanDriver extends Driver {
  latch(q: Readonly<QuantIntent>): void;   // at control ticks only
  setAids(aids: DriveAids): void;
  readonly idle: number;                   // s since the last non-neutral latched intent
  readonly source: DriveSource;
}
export function createHumanDriver(vehicle: CarDefinition): HumanDriver;

// ---- drive/reference.ts (10-01)
export interface RefPoint { s: number; x: number; y: number; heading: number; curvature: number; speed: number; accel: number }
export interface ReferenceLine {
  readonly length: number; readonly closed: boolean;
  project(x: number, y: number, hint: number, out: Frenet): Frenet;   // l = offset from THIS line (+ left)
  at(s: number, out: RefPoint): RefPoint;
}
export const RECORDED_DS = 0.5;
export function loopLine(track: BuiltTrack, profile: SpeedProfile, world: GroundWorld): ReferenceLine;   // driving line incl. lineOffset knots
export function recordedLine(samples: Float64Array /* x, y, speed triples every RECORDED_DS m of travel */): ReferenceLine; // open line
// ---- drive/path-driver.ts (10-01)
export type RecoveryState = 'track' | 'recover' | 'brake' | 'turnaround' | 'resume';
export interface PathDriver extends Driver {
  readonly state: RecoveryState; readonly lateralError: number; readonly headingError: number;
  readonly converged: boolean;   // latch thresholds (§7.10 C) held for 1 s
  readonly lineS: number;
}
export function createPathDriver(vehicle: CarDefinition, line: ReferenceLine, options: { readonly speedScale: number; readonly exactSpeed: boolean }): PathDriver;

// ---- drive/tyre.ts (08-02 v0 body, 09-01 full body; signature frozen)
export interface TyreCoefficients { readonly c0Alpha: number; readonly c0Kappa: number; readonly g0: number; readonly loadShape: number;
  readonly sigmaY: number; readonly sigmaX: number; readonly shape: number; readonly curvature: number; readonly camberRatio: number }
export function tyreCoefficients(params: TyreParams, handling: TyreHandling): TyreCoefficients;
export interface TyreIo {   // one preallocated record per wheel; inputs then outputs
  load: number; ux: number; uy: number; vx: number; slipVx: number /* R*omega - vx */; vy: number;
  inclination: number; camberToRoad: number; muScale: number;
  fx: number; fy: number; capacity: number; slipAngle: number; slipRatio: number;
  slopeX: number;           // secant dFx/dux, N/m, floored at 0.05 * C_kappa / sigmaX (implicit spin update)
  dampX: number;            // low-speed damping coefficient on slipVx actually applied, N s/m
}
export function evaluateTyre(params: TyreParams, c: TyreCoefficients, io: TyreIo): void;

// ---- drive/compliance.ts (09-01)
export interface AxleCompliance {   // left wheel, rad per N (toe: + toe-in; camber: + top outboard), RACE signs
  readonly fyToe: number; readonly fyCamber: number; readonly fxToeBrake: number; readonly fxToeDrive: number; readonly mzToe: number /* rad per N m, reported only */;
  readonly lateralStiffness: number;   // N/m at the contact patch (calibration check)
}
export function deriveCompliance(axle: AxleLinkage, table: KinematicsTable, rates: CarCompliance['bushingRates'], wheelRate: number): AxleCompliance;

// ---- drive/powertrain.ts (08-02 v0; 09-02 full)
export interface PowertrainIo {
  throttle: number; direction: 1 | -1; speed: number /* u */; omegaL: number; omegaR: number /* driven wheels */; driveSlip: number /* max kappa driven */;
  torqueL: number; torqueR: number /* out: N m at each driven wheel */; inertia: number /* out: effective rotating inertia per driven wheel */;
  gear: number; engineRpm: number; tractionActive: boolean /* out */;
}
export interface Powertrain { reset(speed: number, direction: 1 | -1): void; step(dt: number, io: PowertrainIo, aids: DriveAids): void }
export function createPowertrain(p: CarPowertrain, radius: number, wheelInertia: number): Powertrain;
// ---- drive/aids.ts (09-02)
export interface AidsIo {
  readonly brakeTorque: Float64Array;   // in/out per wheel, N m (>= 0), ABS + stability modulate
  readonly slipRatio: Float64Array;     // in, per wheel
  steerAct: number; u: number; r: number; beta: number; throttleScale: number /* out, multiplies throttle (stability) */;
  absActive: boolean; stabilityActive: boolean;   // out
}
export interface Aids { reset(): void; step(dt: number, io: AidsIo, aids: DriveAids, view: PlantView): void }
export function createAids(vehicle: CarDefinition, frontTrack: number, rearTrack: number): Aids;

// ---- vehicle-models.ts (08-02)
export interface VehiclePlant {
  readonly view: PlantView;
  /** Seed from the Auto state at the end of the last step (path = that step's PathState); ride state kept. §7.10 A */
  engageFromPath(path: PathState, autoInputs: { readonly ax: number; readonly ay: number }): void;
  step(dt: number, cmd: Readonly<DriveCommand>, aids: DriveAids, simEvents: SimEvent[], driveEvents: DriveEvent[]): void;
  /** Interpolated TRUE + POSE write incl. frame.drive (POSE may use Math.*; TRUE drive fields use det kernels). */
  sample(alpha: number, amplification: number, out: TelemetryFrame): void;
  /** Hand the body back to the Auto model at `path` (ride kept, reference plane refitted). §7.10 C */
  releaseToPath(path: PathState): void;
  /** At rest at (x, y, heading) on the ground: velocities 0, deflections 0, ride at static equilibrium there. */
  place(x: number, y: number, heading: number): void;
  snapshot(out: Float64Array): Float64Array;   // PLANT_SNAPSHOT_LENGTH doubles, layout in plant.ts header
  restore(snapshot: Float64Array): void;
}
export const PLANT_SNAPSHOT_LENGTH: number;      // drive/plant.ts
export interface VehicleModel {   // M1 §7.2.4 plus:
  readonly plant?: VehiclePlant;  // cars whose definition has `handling`
  setSuspension(suspension: SuspensionDefinition, keepRideState?: boolean): void;
}
// ---- drive/control.ts (08-02 → 09-04 → 10-01 → 11-03)
export interface DriveHost extends DriveControl {
  /** Called by simulation.step BEFORE time advances; returns true when the plant drives this step (mode != auto). */
  beforeStep(path: PathState): boolean;
  /** The plant step (called by simulation.step when beforeStep returned true). */
  stepPlant(dt: number, simEvents: SimEvent[]): void;
  /** Release now (seek / setVehicle / immediate): mode auto, cut event. */
  releaseNow(): void;
  readonly detached: boolean;
}
export function createDriveControl(deps: {
  readonly model: () => VehicleModel; readonly vehicle: () => VehicleDefinition; readonly track: BuiltTrack;
  readonly world: GroundWorld; readonly profile: () => SpeedProfile; readonly simTime: () => number;
}): DriveHost;
// ---- drive/events.ts (08-02 stub; 11-02 detectors)
export interface DriveDetectors { reset(): void; step(dt: number, view: PlantView, frameLike: DetectorInput, out: DriveEvent[]): void }
// DetectorInput: per-wheel slipAngle, slipRatio, omega, vx, load, capacity, fx, fy; throttle, brake; aid flags; zone; simTime (plain object, preallocated)
export function createDriveDetectors(): DriveDetectors;
// ---- replay/format.ts, replay/recorder.ts (11-03)
export const SIM_VERSION = 'm2.1';   // bump whenever plant behaviour changes (the replay golden test enforces it)
export function encodeReplay(r: DecodedReplay): Uint8Array;            // uncompressed binary (§7.13)
export function decodeReplay(bytes: Uint8Array): DecodedReplay | null; // null on any structural/CRC error
export function paramsHash(vehicle: VehicleDefinition, suspension: SuspensionDefinition, world: WorldDefinition | null): string;
export function stateChecksum(snapshot: Float64Array): number;        // CRC32 over Math.round(v * 1e6) as int32 pairs
export interface Recorder { start(snapshot: Float64Array, header: Omit<ReplayHeader, 'ticks'>): void; latch(q: Readonly<QuantIntent>): void;
  event(kind: ReplayEventRecord['kind'], value: string): void; tick(snapshotIfKeyframe: () => Float64Array): void; window(seconds: number): DecodedReplay | null; whole(): DecodedReplay | null }
// ---- ghost/ghost.ts (11-04)
export interface GhostTrace { readonly s: Float64Array; readonly steer: Float64Array; readonly slipFront: Float64Array; readonly slipRear: Float64Array;
  readonly roll: Float64Array; readonly trackingError: Float64Array; readonly minLoad: Float64Array }   // per RECORDED_DS of line distance
export interface Ghost { readonly frame: TelemetryFrame; step(): boolean; sample(alpha: number): TelemetryFrame; readonly trace: GhostTrace }
export function replayLine(replay: DecodedReplay, sim: Simulation): Float64Array;   // re-simulates headless (fresh simulation), returns recordedLine samples
export function createGhost(o: { track: BuiltTrack; world: GroundWorld; vehicle: CarDefinition; suspension: CarSuspensionDefinition; line: ReferenceLine; start: Float64Array }): Ghost;
export function ghostTrace(o: Parameters<typeof createGhost>[0], seconds: number): GhostTrace;   // headless
```

### 7.2 Plant state and the per-step algorithm (dt = SIM_DT = 1/240 s)

**State** (packed `Float64Array`, layout documented in the `plant.ts` header, all of it in the snapshot):
X, Y, cψ, sψ, u, v, r; ωᵢ (4); uxᵢ, uyᵢ (8, contact-patch deflections, m); δ_act (actuator steer); a_xLP, a_yLP
(8 Hz low-passed specific forces fed to the ride); road-input fade offsets offᵢ (4); compliance toe/camber filter
states (8); powertrain (gear, clutch, cut/ramp/lock timers, engineRpm, tcs scale); ABS pressure factors pᵢ (4);
human-driver ramp state (steer, throttle, brake, handbrake, direction, reverse timer, blend weight, idle);
path-driver integrator and state; the ride model's q[7], v[7] (`exportState`); the step counter. Snapshot length is
fixed per build (`PLANT_SNAPSHOT_LENGTH`).

**Per-step order (08-02 implements items marked v0; 09-04 adds the rest; the order is binding):**
0. *Control latch* (`control.ts`): on ticks where `tick % CONTROL_TICKS === 0` latch the latest intent → `quantiseIntent`
   → `HumanDriver.latch` (manual), or read the replay's sample (replay). The recorder records the latched integers.
1. *Driver*: `driver.step(dt, view, cmd)` (HumanDriver or PathDriver) → DriveCommand.
2. *Steering actuator* (v0): δ_act += clamp((cmd.steer − δ_act)·dt/lag, −rate·dt, +rate·dt); `rack = frontTable.rackForSteer(δ_act)`.
3. *Corner kinematics* from the CURRENT ride state (travel from the last step): `table.sample(travelᵢ, sideᵢ·rack)` →
   camber_bodyᵢ, toeᵢ, wheel centre, contact patch, IC (v0 uses camber and toe); γᵢ = camber_bodyᵢ − sideᵢ·roll (M1
   relation) + compliance camber (09); δᵢ = −sideᵢ·(toeᵢ + compliance toeᵢ) (§4).
4. *Ground and reference plane* (v0): for each wheel, world contact point = (X, Y) + R(ψ)·(cxᵢ, cyᵢ); ONE warm-started
   projection per wheel (hint = that wheel's last s) then `GroundWorld.sample` at the point and at ±0.1 m along the
   heading (3-point envelope, mean of h, M1 §7.6 step 4) → hᵢ, baseᵢ, surfaceᵢ. Base plane through the four base heights
   (closed form for the symmetric layout): b_F = (base₀+base₁)/2, b_R = (base₂+base₃)/2, g = (b_F − b_R)/(x_F − x_R),
   c = ((base₀ − base₁)/t_F + (base₂ − base₃)/t_R)/2, z₀ = (b_F + b_R)/2 − g·(x_F + x_R)/2. Ride inputs:
   roadᵢ = hᵢ − (z₀ + g·cxᵢ + c·cyᵢ) − offᵢ; roadRateᵢ = (roadᵢ − roadPrevᵢ)/dt (M1). offᵢ decays linearly to 0 over
   `HANDOFF_FADE_S = 1.0` s (only non-zero after an engage, §7.10 A).
5. *Loads*: Nᵢ = `ride.state.load[i]` from the previous ride step (explicit coupling, documented).
6. *Wheel-frame velocities* v_wx, v_wy (§4) with det `dcos/dsin` of δᵢ.
7. *Powertrain, brakes, aids* (v0 powertrain + brakes; 09-02 aids): from the previous step's slips and ω
   (`PowertrainIo`, `AidsIo`); T_bᵢ = cmd.brake·maxTorque·shareₐₓₗₑ/2 (+ handbrake on the rear) × ABS factor + ESC add.
8. *Tyres + implicit spin* (v0, full tyre 09-01), per wheel:
   a. predict deflections with the current spin: ux* = (ux + dt·(Rω − v_wx))/(1 + dt·|v_wx|/σx),
      uy* = (uy + dt·v_wy)/(1 + dt·|v_wx|/σy) (backward Euler on the relaxation lag; non-singular at v = 0);
   b. `evaluateTyre` at (ux*, uy*) → Fx₀ and `slopeX`;
   c. dFx/dω = slopeX·dt·R/(1 + dt·|v_wx|/σx) + dampX·R; driving torque Tdᵢ from step 7 (driven wheels);
      ω_free = ω + dt·(Tdᵢ − R·Fx₀)/(I_effᵢ + dt·R·dFx/dω);
   d. brake: Δω_b = dt·T_bᵢ/(I_effᵢ + dt·R·dFx/dω); if |ω_free| ≤ Δω_b → ω = 0 (held/locked) else
      ω = ω_free − sign(ω_free)·Δω_b (brake never reverses spin);
   e. final deflections with the new ω (same formulas as a) and the final `evaluateTyre` → Fx, Fy, capacity, slip.
   Two tyre evaluations per wheel per step.
9. *Chassis* (v0, semi-implicit Euler): Fxv, Fyv per wheel (§4); F_drag = ½·ρ·CdA·u·|u| (ρ = 1.225, CdA =
   `vehicle.dragArea`); F_rr = Σ crr(surfaceᵢ)·Nᵢ · u/√(u² + 0.05²); gravity in the plane gx = −G·g/√(1+g²+c²),
   gy = −G·c/√(1+g²+c²);
   u̇ = (ΣFxv − F_drag − F_rr)/m + gx + v·r; v̇ = ΣFyv/m + gy − u·r; ṙ = Σ(cxᵢ·Fyvᵢ − cyᵢ·Fxvᵢ)/I_z;
   u += dt·u̇; v += dt·v̇; r += dt·ṙ; then heading: cψ' = cψ − sψ·r·dt, sψ' = sψ + cψ·r·dt, renormalise by
   1/√(cψ'² + sψ'²); X += dt·(u·cψ − v·sψ); Y += dt·(u·sψ + v·cψ).
   m = sprungMass + Σ unsprungᵢ (the ride model's masses, per installed suspension); I_z = vehicle.inertia.yaw +
   Σ m_uᵢ·(cxᵢ² + cyᵢ²).
10. *Ride coupling* (v0): specific forces the tyres supply a_x = ΣFxv/m, a_y = ΣFyv/m → first-order low-pass at 8 Hz
    (α = 1 − dexp(−2π·8·dt), precomputed) → `RideInput.ax/ay` (M1 meaning); `antiPitch` and `rcHeight` exactly as
    car-model `bodyInputs`/`rcInputs`; jacking (09-04): `RideInput.linkVertical` (§7.6); `ride.step(dt, input)`.
11. *Derive* per-corner TRUE values (car-model `derive` for ride fields; plant writes fx, fy, capacity, slips, omega,
    surface; gripUse = √(Fx²+Fy²)/capacity, capped at 2 like M1), fire M1 SimEvents (bump-stop, liftoff, grip-limit with
    the same hysteresis) and DriveEvents (detectors, §7.11).
12. *Clock and corridor*: projection of the CG (warm-started) → if |l| ≤ LOOP_CORRIDOR: detached lap time =
    `profile.timeAtS(s)`, section index from s (section SimEvents fire on change; no lap events outside auto); zone
    change → `zone` DriveEvent; outside `inBounds` for 1.5 s or 30 m → `out-of-bounds` DriveEvent (the drive feature fades
    and requests a reset).
13. *Safety* (09-04): finite check of the packed state (one sum); on failure restore the newest good snapshot (ring of
    8 taken every 24 steps), zero its velocities and deflections, `faults++`, `fault` DriveEvent; hard clamps
    |ω| ≤ 400 rad/s, |u|,|v| ≤ 120 m/s, |r| ≤ 6 rad/s, |ux|,|uy| ≤ 0.5 m.
14. *Sleep*: if |u| < 0.05, |v| < 0.05, |r| < 0.02, throttle < 0.02 and (brake > 0.05 or handbrake > 0.05 or plane slope
    < 0.005) → u = v = r = 0, ω = 0 (deflections kept: the patch holds like a bristle). Wakes on throttle > 0.02 or when
    brake and handbrake are released on a slope.

### 7.3 Ride, kinematics and Auto code reused UNCHANGED vs refactored (minimal, golden-safe)
- `ride7dof.ts`: (08-02) add `exportState(out: Float64Array)` / `importState(src: Float64Array)` (q, v: 14 doubles) to
  `RideModel`; (09-04) add OPTIONAL `RideInput.linkVertical?: Float64Array` (4, N, + up on the hub, −value on the body).
  When present it replaces the lateral term `side·ay·msAxle·rc/track` in `linkForces`; the anti-pitch and unsprung terms
  are unchanged. When absent the code path and arithmetic are byte-for-byte the M1 ones (Auto never passes it). Test:
  with symmetric per-axle forces and slopes through the RC the new term equals the M1 term to 1e-9 (§7.6).
- `car-model.ts` (08-02): the Auto path (`reset`, `step`, `sample`, `restPose`) keeps its exact arithmetic. Refactors:
  (1) extract the per-corner pose writing of `sample()` (current lines "steerSum … out.trail") into an inner function
  `writeCorners(out, amp, roll)` used by both Auto and the plant; (2) extract `rideParams(vehicle, suspension)` from
  `install` (pure, same expressions); (3) `install(def, keepRideState)` copies the ride state through
  export/importState when keeping; (4) Auto `derive` additionally writes the new CornerFrame fields: fx = fxAxle·share,
  fy = fyAxle·share (the demand already computed for gripUse), capacity = peakMu·load, slipAngle = slipRatio = 0,
  omega = path.v·(1 − κ·cyᵢ)/R, surface from the loop band rule (`loopSurface(track, s, l)` exported by
  `world/ground.ts`, using each wheel's (sᵢ, lᵢ) already computed in `roadInputs`); frame.drive in auto: mode 'auto',
  available, x/y/yaw from the path, u = path.v, v = beta = 0, gear 0, engineRpm 0, zone 'loop'.
  New record slots are appended AFTER the existing ones so existing slots and their interpolation are untouched.
  (5) `createCarModel` builds `plant` (from `drive/plant.ts`) when `vehicle.handling` exists, handing it an internal
  core (tables, ride, cx/cy, side, axleX, derive, writeCorners, xform/rpy scratch, install). (6) `releaseToPath` support:
  set `refZ/refSlope` by least squares so Auto road inputs equal the plant's current ride inputs at the latch, reset the
  interpolation record (`prev = cur`). Auto `reset()` still recomputes them as in M1.
- `simulation.ts` (08-02): `drive` and `world` members; `step()` calls `drive.beforeStep(path)` first and, when it
  returns true, `drive.stepPlant(dt, events)` INSTEAD of the M1 profile/model step (time still advances the same way;
  lap/section logic uses the detached clock); `sample()` routes to `plant.sample` outside auto; `seek`, `setVehicle`
  call `drive.releaseNow()` first when not in auto; `setSuspension` outside auto calls `model.setSuspension(s, true)`
  and skips the pre-roll. The GroundWorld is built once per (track, world) and cached like tracks.
- `tables`, `prepareCarSuspension`, `peakMu`, `track.roadHeight`, `buildSpeedProfile`: unchanged (09-03 only swaps their
  transcendental calls for det kernels, goldens unchanged).

### 7.4 Tyre model (`drive/tyre.ts`; v0 08-02, full 09-01; research m2/04 §4–§8, m2/12 §3)
Coefficients per axle (once): x₀ = 1/k (k = `stiffnessLoadShape`), g(x) = 2x/(1+x²) (= sin 2·atan x, no trig),
g₀ = g(x₀); C_α(N) = corneringStiffness·N₀·g(N/(k·N₀))/g₀, C_κ(N) = slipStiffness·N₀·g(N/(k·N₀))/g₀ with N₀ =
`tyre.nominalLoad`; σy = relaxationLateral, σx = relaxationLongitudinal.
Evaluation (full model, 09-01):
```
if load <= 0: fx = fy = 0, capacity = 0 (the plant decays ux, uy by 1/(1 + 20 dt)); return
mu   = peakMu(load, camberToRoad, tyre) * muScale            // M1 ride/tyre.ts: the SAME peak as Auto's gripUse
D    = mu * load
tanA = uy / sigmaY - camberRatio * inclination               // camber thrust as equivalent slip (§4 signs)
kap  = ux / sigmaX
sx = Ck * kap / D ; sy = Ca * tanA / D ; s = sqrt(sx^2 + sy^2)
f(s) = dsin(C * datan(B*s - E*(B*s - datan(B*s)))) with B = 1/C   // unit-slope MF curve, C = shape, E = curvature
if s < 1e-9: fx = Ck*kap ; fy = -Ca*tanA
else       : fx = D*f(s)*sx/s ; fy = -D*f(s)*sy/s
w  = 1 - smoothstep(0.5, 1.5, |vx|)                           // low-speed stick damping (m2/04 §8, m2/12 §3.2)
cx = 2*sqrt((Ck/sigmaX) * load/G) ; cy = 2*sqrt((Ca/sigmaY) * load/G)
fx += w*cx*slipVx ; fy -= w*cy*vy ; dampX = w*cx           // driving slip pushes forward; patch velocity is resisted
if hypot(fx, fy) > D: scale both to D                         // friction circle on the result
slopeX = (Ck/sigmaX) * max(0.05, s < 1e-6 ? 1 : f(s)/s)       // secant, falls past the peak, floored
capacity = D ; slipAngle = tanA ; slipRatio = kap
```
v0 (08-02): the same signature with f(s) = min(s, 1) (linear + saturation), no camber term (camberRatio treated as 0),
same low-speed damping and clamp — enough to drive and test the integration; 09-01 replaces the body.
Shape defaults (content, 09-01 may tune within the stated bands only): C = 1.35 (1.2–1.5), E = 0 (−0.5–0.3); peak
slip then ≈ 3.2·μ/c_α (rad) ≈ 8–10° lateral. Surface: `muScale = SURFACES[kind].muScale` per wheel (split-μ falls out).

### 7.5 Compliance (`drive/compliance.ts`, 09-01 derives; 09-04 applies; research m2/23 §5.2)
Derived once per (vehicle, suspension, axle) at the static design pose from OUR hardpoints:
1. For each `distance` constraint: unit vector uⱼ from the chassis point to the upright point, carrier point pⱼ; wrench
   wⱼ = [uⱼ; (pⱼ − o) × uⱼ] about o = design contact patch; stiffness kⱼ = `bushingRates[role]` (chassis-side bush; ball
   joints rigid). For a `strut` constraint: two wrenches with directions ⟂ to the strut axis at the top mount, stiffness
   = `bushingRates.strut`.
2. Locked spring: add k_w·w_s·w_sᵀ with w_s = vertical force at the wheel centre and k_w = the corner wheel rate.
3. K = Σ kⱼ·wⱼ·wⱼᵀ (6×6) → C = K⁻¹ (`math/linsolve.ts`).
4. Unit loads at the contact patch: lateral +1 N toward the car centre → rotation about z = `fyToe` (+ toe-in), about x
   → `fyCamber` (+ top outboard); longitudinal −1 N (braking) → `fxToeBrake`; longitudinal +1 N at the wheel centre
   (drive) → `fxToeDrive`; Mz +1 N m → `mzToe` (reported only: no aligning-moment model, comment says so); lateral
   translation of the patch per N → `lateralStiffness`.
Runtime (09-04): toe_cᵢ = clamp(fyToe·Fy_inᵢ + (Fxᵢ < 0 ? fxToeBrake : fxToeDrive)·Fxᵢ, ±maxAngle), camber_cᵢ =
clamp(fyCamber·Fy_inᵢ, ±maxAngle), each through a first-order filter τ = `compliance.filter`, using the previous step's
forces. Gates (asserted, reported in the 09-01 SUMMARY as the "compliance report" with the ±2× bushing band): per
wheel abs(fyToe) ≤ 0.05 °/kN and abs(fyCamber) ≤ 0.4 °/kN, axle lateral stiffness 0.6–2.6 mm/kN; loop gain
abs(fyToe)·C_α < 0.2; halving all rates doubles every coefficient (property test); rates ×1000 → coefficients ≈ 0;
compliance off (`maxAngle = 0`) reproduces the kinematics-only plant bit-for-bit. A type falling outside a gate with the
shared table is REPORTED, never tuned per type.

### 7.6 Jacking and geometric transfer from IC lines (09-04; research m2/03 §4.5, m2/05 §1.1)
Per wheel at its current travel and rack, from the corner solution (AXLE frame, left side): slope_L =
(IC.z − CP.z)/(IC.y − CP.y); for a right corner use its own sample and slope_R = −slope_L. Clamp |slope| ≤ 1.5 (IC
near the patch) and treat a non-finite slope as 0 (parallel arms). Vehicle-frame lateral tyre force Fyvᵢ (sprung share
m_s/m): `linkVertical[i] = −slopeᵢ · Fyvᵢ · m_s/m`. With equal left/right forces and both lines through the RC this
equals the M1 pair ±m_s,axle·a_y·h_RC/t (unit test 1e-9); with unequal forces it adds the jacking force.

### 7.7 Powertrain and brakes (`drive/powertrain.ts`; v0 08-02, full 09-02; research m2/06 §2–§4, Jolt MIT)
- Engine speed: rpm_wheel = mean(ω_RL, ω_RR)·ratio·60/2π (ratio = gear·final; reverse ratio for gear −1);
  engineRpm = max(idle, rpm_wheel); torque lookup speed rpm_eff = max(engineRpm, idle + (STALL − idle)·throttle) in
  1st and reverse (STALL_RPM = 2200, converter-like launch, NO creep at zero throttle).
- Torque: throttle ≥ 0.05 → T_e = curve(rpm_eff)·throttle·tcsScale·clutch; throttle < 0.05 and rpm_wheel > idle + 200 →
  T_e = −(a + b·rpm_wheel)·clutch (engine braking); rev limiter: rpm ≥ redline → T_e = min(T_e, 0).
  Axle torque T = T_e·ratio·efficiency; split by the Jolt LSD: base 0.5/0.5, α = min((ω_max/ω_min − 1)/(LSR − 1), 1)
  (ω floored at 1e-3), the slower wheel gets (1−α)·0.5 + α of T, the faster (1−α)·0.5.
- Effective inertia per driven wheel: I_w + engineInertia·ratio²·clutch/2.
- Gearbox (automatic, the user never shifts): Jolt state machine; upshift when rpm_ideal = u/R·ratio > lerp(upLight,
  upFull, throttle), not during lockout, and driven slip κ < 0.1; downshift when rpm_ideal < downshiftRpm (gear > 1)
  or kick-down (throttle > 0.9 and rpm_ideal(gear−1) < 0.92·redline); on change: cut (clutch 0) for `shift.cut`, ramp
  back over `shift.ramp`, lockout `shift.lockout`. direction −1 selects reverse (gear −1), cap |u| ≤ reverseSpeedCap by
  cutting torque, throttle × reverseThrottle. `reset(speed)` picks the gear whose rpm_ideal lies between downshiftRpm and
  upLight (1st when slower).
- Brakes: T_bᵢ = brake·maxTorque·brakeShareₐₓₗₑ/2 (the vehicle's existing `brakeShare`, the same value Auto's anti-dive
  uses), handbrake adds handbrakeTorque/2 on each rear wheel.
- TCS (aids.traction): v_s = max over driven wheels of (Rω − v_wx); target scale = clamp(1 − (v_s − 1.5)/2.5, 0.15, 1),
  first-order τ 0.06 s; `tractionActive` while < 0.98.

### 7.8 Aids (`drive/aids.ts`, 09-02; research m2/06 §5; labelled "Assist: simplified model")
- ABS (aids.abs): per wheel pressure factor pᵢ ∈ [0.1, 1]: if κᵢ < −0.12 and brake > 0.05 → pᵢ −= dt/0.04, else
  pᵢ += dt/0.12; brake torque × pᵢ; `absActive` while any pᵢ < 0.98. Off → wheels can lock.
- Stability (aids.stability): r_t = u·δ_act/(L + K_REF·u²), K_REF = 0.0018 rad·s²/m, clamped |r_t| ≤ lateralLimit/max(|u|,1);
  e = r − r_t; active when |u| > 5 m/s and (|e| > 0.08 rad/s or (|β| > 0.1 and β·r < 0)); oversteer (|r| > |r_t|, same
  sign) → add brake torque on the OUTER front wheel, understeer → the INNER rear; T_add = clamp(4·I_z·(|e| − 0.08)·R/(t/2),
  0, 1500) N m; throttleScale 0.5 while active. Selective braking only (no invisible yaw torque).
- Steering assist (aids.steering, in HumanDriver, §7.9). All aids flags are reported in DriveFrame every step.

### 7.9 Drivers
**HumanDriver** (`drive/human-driver.ts`; research m2/07 §1, m2/06 §5.4):
- Latched intent (integers → floats). Digital sources ramp per STEP: steer rise 3.0 /s, fall 7.0 /s, snap to 0 on a
  reversal; throttle rise 2.5 /s, fall 6 /s; brake rise 4 /s, fall 10 /s; handbrake instant. Analog sources use the
  value directly (dead zone and curve are applied by the device adapter in the feature).
- Steering (aids.steering on): δ_lim(V) = min(maxSteer, datan(L·A_LIM/max(V², 1)) + ALPHA_PEAK) with A_LIM =
  view.lateralLimit, ALPHA_PEAK = 0.12 rad, V = |u|. Countersteering (steer sign opposite to r while |β| > 0.05) is
  NOT limited: δ_cmd = s·maxSteer; otherwise δ_cmd = s·δ_lim. Countersteer help (09-04): δ_cmd += (1 − |s|)·0.6·β·
  smoothstep(5, 8, |u|), clamped to ±maxSteer. Aids off: δ_cmd = s·maxSteer.
- Reverse logic: direction −1 after brake > 0.3, throttle < 0.05 and |u| < 0.5 m/s held 0.25 s; in reverse the brake
  intent is the reverse throttle and the throttle intent brakes; back to +1 after throttle > 0.3 and u > −0.5 m/s
  held 0.15 s. Never on the sign of u alone.
- Bumpless engage: the output blends linearly from `previous` to the conditioned command over 0.3 s (brake: no blend
  when the user's brake exceeds the previous brake).
- idle: seconds since the last latched intent with |steer| > 0.02 or any pedal > 0.02.

**PathDriver** (`drive/path-driver.ts`, 10-01; research m2/09 §2, PythonRobotics MIT):
- Front-axle reference P_f = (X, Y) + a·(cψ, sψ); projection on the line → e (lateral error, + left), ψ_e =
  wrap(ψ − heading_line), κ_line, v_ref, accel_ref.
- Steering: δ = −ψ_e − datan(1.2·e/(1.0 + |u|)) + datan(L·κ_line) + 0.0018·u²·κ_line − 0.05·(r − u·κ_line),
  clamped ±maxSteer, slew ≤ 0.6 rad/s.
- Speed: v_t = v_ref·speedScale/(1 + 0.5·|e|/4.5 + 1.5·|ψ_e|) (loop: speedScale 0.97; ghost: 1 and `exactSpeed` disables
  the derate); a_cmd = accel_ref + 1.2·(v_t − u) + 0.2·∫(v_t − u) (integral clamped ±2); throttle = a_cmd/limits.accel,
  brake = −a_cmd/(1.0·G), slew ≤ 4 /s; never a hard brake unless state is BRAKE.
- Recovery machine (hysteresis): TRACK (|e| < 1.0 & |ψ_e| < 30°) ↔ RECOVER (|e| > 2.0 or |ψ_e| > 50°): pure pursuit to
  the line point at s + max(8, 0.8·u), v_t ≤ 10 m/s (≤ 8 on grass); BRAKE (|ψ_e| > 100° or |β| > 35° or u < −0.5
  unintended): brake 0.8, steer into the slide (δ = 0.8·β), until |u| < 2; TURNAROUND (stopped, |ψ_e| > 100°): reverse
  with full lock until |ψ_e| < 80°, then forward; RESUME (from RECOVER into TRACK): speed target ramps from u to v_t over 1.5 s.
- `converged`: |e| < 0.05 m, |ψ_e| < 0.5°, |u − v_ref| < 0.05·v_ref + 0.2 m/s, all held for 1.0 s.

### 7.10 Modes and handoff sequences (binding step lists)
**A. Auto → Manual** (`drive:request manual`):
1. Kernel: checks `available`; `clock = 'local'`, `paused = false`; `drive.request('manual')`.
2. Next `sim.step`: `beforeStep(path)` sees the pending request in auto; `path` = the PathState of the end of the last
   step. `plant.engageFromPath(path, {ax, ay as last fed to the ride})`: X = path.x, Y = path.y, (cψ, sψ) = (dcos, dsin)
   of path.heading, u = path.v, v = 0, r = path.v·path.curvature, δ_act = datan(L·path.curvature) (the M1 Ackermann
   steer), ωᵢ = (u − r·cyᵢ)/R, deflections 0, a_xLP/a_yLP = the Auto inputs, offᵢ = autoRoadᵢ − plantRoadᵢ (faded
   over 1 s), powertrain `reset(u, +1)`, aids reset, `HumanDriver.engage(view, {steer: δ_act, throttle: path.ax > 0 ?
   min(1, path.ax/limits.accel) : 0, brake: path.ax < 0 ? min(1, −path.ax/limits.brake) : 0, handbrake 0, direction 1})`.
   The ride model object is the SAME (state continuous).
3. mode = manual, `detached = true`, DriveEvent `mode {previous:'auto', cut:false}`; the step proceeds as a plant step.
4. The interpolation record treats the engage pose as the previous step (no blend across modes).
5. Kernel mirrors `driveMode`, emits `drive:mode`; camera cross-fades its targets 0.8 s; the pill shows MANUAL.
Continuity thresholds (tested at 20 random lap times, `tests/sim-core/handoff.test.ts`): position step ≤ v·dt + 1 mm,
speed step ≤ 0.05 m/s, yaw-rate step ≤ 0.02 rad/s, steer step ≤ rate·dt, roll and pitch steps ≤ 1 mrad, travel step ≤ 1 mm,
load step ≤ 3 % between the last Auto step and the first plant step.
**B. Manual → Returning** (`drive:request auto`): next step `PathDriver.engage(view, last command)`; mode returning,
event `cut:false`; detached clock continues. Until 10-01 lands (phases 8–9) a non-immediate auto request releases at
once onto the rails at `profile.timeAtS(projected s)` (a cut, `shortcut:` comment) and the drive feature uses
`immediate: true` for Enter.
**C. Returning → Auto (latch)**: when `pathDriver.converged`: lapTime = `profile.timeAtS(s)`; path = `stateAt(lapTime)`;
`plant.releaseToPath(path)` (ride kept; refZ/refSlope fitted; interpolation record reset); mode auto; events
`converged` + `mode {cut:false}`; clock stays local (`detached` stays true until a live seek). If not converged within
20 s on the loop corridor (60 s off it) → immediate release (D).
**D. Immediate release** (Rejoin live, vehicle switch, attract, presenter section, out-of-time return): kernel sets
`clock = 'live'` (or calls setVehicle); `sim.seek`/`setVehicle` call `releaseNow()` (mode auto, event `cut:true`) and run
the M1 pre-roll; `detached = false` after a live seek. The drive feature shows a 0.35 s fade; the camera hard-cuts.
**E. Reset** (`drive:reset`, manual only): next step `plant.place(x, y, heading)` — default = projection of the CG onto
the driving line (l = lineOffset(s), heading of the line), or the station spawn; ride `reset` on the ground there;
event `reset`; camera hard-cuts.
**F. Replay** (`drive:play`): `play(replay)` refuses (false) when track, world or vehicle differ; plays with a visible
"recorded with an older model" note (DriveFrame.approximate stays honest) when `simVersion` or `paramsHash` differ;
switches the suspension to the header's (store follows via the kernel), restores the start snapshot, mode replay
(event `cut:true` unless the snapshot equals the current state), applies recorded events at their ticks, compares
keyframe CRCs (mismatch → `fault`-free resync: restore the recorder's snapshot when the replay carries one, else mark
approximate). Any deliberate device input during a replay → manual from the current state (branching). At the last
tick → manual.
**G. Moment replay** (feature): `recording().window(4)` → `drive:play` with `store.timeScale = 0.25`; at the end mode is
manual at exactly the pre-replay state (deterministic re-simulation) and the feature restores `timeScale = 1`.

### 7.11 Drive events (`drive/events.ts`; 08-02: mode, reset, zone, out-of-bounds, fault, converged; 11-02: detectors)
slide (axle mean |slipAngle| > peak slip ·1.05 for > 0.15 s; `lift` if throttle went from > 0.3 to < 0.05 within the
previous 0.5 s); lockup (Rω < 0.2·v_wx, v_wx > 3 m/s, brake > 0.3, 0.1 s); wheelspin (κ > 0.25 for 0.2 s); aid (rising
edge of an active flag). Each kind and corner/axle has 0.5 s hysteresis and at most one event per 0.3 s.

### 7.12 Determinism rules (all M2 sim-core code; whole sim-core after 09-03)
1. Only `+ − × ÷`, `Math.sqrt/abs/min/max/floor/ceil/round/trunc/sign/fround/imul` and `math/det.ts` kernels; integer
   powers as explicit multiplies; `dhypot` instead of `Math.hypot`.
2. Fixed `SIM_DT`, integer tick counter, no `Date`/`performance`/`Math.random` (M1 purity test), no iteration over Map/Set
   for numerics, stable array order.
3. Intents are quantised at latch time and the plant consumes exactly the quantised values (live play == replay).
4. Constants computed at module load use det kernels too (e.g. low-pass α).
5. Rendering-only code (sample POSE quaternions, three.js) may use `Math.*`; TRUE drive fields that are hashed (x, y,
   yaw, u, v, slips, travels, loads, ω) are computed in the step or with det kernels.
6. CI: `runDriveScript` hash equal in Node (vitest) and Chromium (`tests/e2e/09-03-determinism.spec.ts`, via
   `__app.driveHash`). Node 22 V8 and Chromium 157 V8 differ in version: a meaningful cross-engine check. Firefox and
   WebKit are not available (no `playwright install`): gap recorded in STATE.md.
7. Auto goldens are re-run by every sim-core plan; 09-03's sweep must leave them unchanged (expected: values move by
   ≤ 1 ulp, the golden quantises at 1e-6).

### 7.13 Replay binary format (`replay/format.ts`, 11-03; research m2/24)
`'SLR1'` · u8 format (1) · u16 header-JSON length + UTF-8 `ReplayHeader` · u16 n + n×float64 LE start snapshot ·
u32 samples + per channel (steer, throttle, brake, handbrake, flags) delta + zig-zag + LEB128 varints · u16 events
(varint tick, u8 kind 0 suspension/1 aids/2 reset, u16 len + UTF-8 value) · u16 keyframes + u32 each · u32 CRC32 of all
preceding bytes. The feature compresses with `CompressionStream('deflate-raw')` and encodes base64url (fragment `#r=`)
or posts it (`ReplaySaveRequest.data`). `paramsHash` = FNV-1a(32) of `JSON.stringify([vehicle, suspension, world])`.
A replay golden test (`tests/sim-core/replay-golden.test.ts`) fixes the hash of a scripted 20 s run; a behaviour change
must bump `SIM_VERSION` and the golden together.

### 7.14 Ghost runs (`ghost/ghost.ts`, 11-04; research m2/24 §d)
The visitor's line = `replayLine(window, sim)` (headless re-simulation sampled every 0.5 m: x, y, speed). Two headless
`ghostTrace` runs from the window's start snapshot — the visitor's suspension (A) and the chosen other suspension (B) —
use the SAME `PathDriver` (speedScale 1, exactSpeed) on that line: apples to apples, driver model disclosed
("Both cars are driven by the same autopilot along your line and speed"). The ghost-lab feature replays the window
(mode replay) and advances `createGhost(B)` in lockstep (same number of fixed steps per frame), rendering it with the
vehicle visual's x-ray ghost material; strip charts plot A vs B (steer, front/rear slip, roll, tracking error) against
line distance.

### 7.15 Content values (representative, labelled "model"; never DB11 data; research m2/04 §10, m2/06 §2)
`content/gt-coupe-tyres.ts` (08-02 → 09-01): front { corneringStiffness 20 /rad, slipStiffness 20, stiffnessLoadShape 2,
shape 1.35, curvature 0, camberRatio 0.07, relaxationLateral 0.6 m, relaxationLongitudinal 0.15 m, wheelInertia
1.2 kg·m² }; rear { 24, 22, 2, 1.35, 0, 0.07, 0.7, 0.15, 1.3 }; compliance { bushingRates: lower-arm 5e6, upper-arm 8e6,
lateral-link 10e6, trailing-link 1.5e6, tie-rod 20e6, strut 2.5e6 (N/m); maxAngle 0.5° (in rad); filter 0.03 s }.
`content/gt-coupe-powertrain.ts` (08-02 → 09-02): torque curve rpm [1000, 1250, 1600, 5000, 5500, 6000, 6500, 7000] →
N·m [330, 520, 700, 700, 695, 685, 657, 600]; idle 750; redline 7000; friction [40, 0.012]; engineInertia 0.35;
gears [4.714, 3.143, 2.106, 1.667, 1.285, 1.000, 0.839, 0.667], reverse 3.317, finalDrive 2.703, efficiency 0.92;
shift { cut 0.18, ramp 0.15, lockout 0.6 }; upshiftRpm [2200, 6400]; downshiftRpm 1300; limitedSlipRatio 1.4;
reverseSpeedCap 7 m/s; reverseThrottle 0.5; brakes { maxTorque 7300 N·m, handbrakeTorque 1500 N·m }.
`content/gt-coupe-handling.ts` (08-02): `{ tyres, powertrain, brakes, steering: { lag 0.06 s, rate 0.7 rad/s }, compliance }`.
Mass, inertia, CG, tyres' μ/load sensitivity/radius, dragArea and brakeShare are the EXISTING `gtCoupe` values (the same
car; 1700 kg, not the published 1875 kg of the real car). The 8-speed ratios and torque shape are published facts of
a V12 GT gearbox/engine used as a representative powertrain; UI copy never names a manufacturer.

## 8. GroundWorld and the proving-ground annex

### 8.1 Composition and priority (`world/ground.ts`)
`sample(x, y)`: (1) world zones in descending priority whose footprint (+ ZONE_EDGE 0.5 m) contains the point — inside
the edge band h, base and μ blend with what lies outside by smoothstep over 0.5 m; (2) the loop corridor (|l| ≤ 18 m via
projection); (3) the world field rectangle; (4) the terrain. A 20 m uniform grid of zone bounding boxes culls tests.
- **Loop corridor:** h = `track.roadHeight(s, l)`; base = swell(s) + l·tan(bank(s)) (det kernels; vertical curves stay
  in h exactly as the M1 ride input sees them); surface: |l| ≤ 4.5 asphalt (pave inside the pavé feature span of the
  `pave` section), ≤ 6.0 kerb, ≤ 8.0 asphalt (apron), ≤ 18 grass. Between |l| 17.5 and 18.5, h and base blend to the
  terrain (the drawn ribbon/terrain joint is 3 cm).
- **Terrain:** `terrainHeight` = M1 `groundHeight` (moved verbatim to `world/terrain.ts`), then the field: inside the
  rectangle z = field.z, within `blend` m outside lerp to the terrain by smoothstep; under any zone footprint (+3 m
  skirt) min(terrain, zone base − 0.05). base = h = terrainHeight; surface grass.
- **Zones** (10-02): rect/path footprints; zone-local (u, w); base = z or linear z0→z1 along u eased over ZONE_EASE =
  10 m at both ends; h = base + Σ features (M1 `featureHeight` with edges {halfWidth = width/2, kerbWidth 0.3, seed}) +
  roughness (M1 ISO 8608 generator seeded from the world id hash, class per zone); surface = patch surface if (u, w) is
  inside a patch, else the zone surface. Path zones integrate their primitives with `track/closure.ts`
  `integratePlan`/`advancePose` into dense nodes (0.25 m) and project like the loop.
- `inBounds`: |l| ≤ 60 m of the loop, or inside the field + 40 m, or within 30 m of a zone footprint.

### 8.2 Real loop geometry (computed from `proving-loop.ts` with `buildTrack`, 2026-11-21)
Length 1650.8 m; centreline bounding box x −196.0…207.5 m, **y −489.2…0.0 m** (the whole loop lies south of y = 0;
its runoff edge reaches y = +18 m along the launch/brake straight and the run-in). Section starts (x, y, heading):
launch (0, 0, 0°), brake-zone (100, 0), hairpin (180, 0) → (180, −40.9, 180°), bump-strip → (30, −40.9),
sweeper → (−105.3, −176.2, −90°), pave, chicane, crest → (−105.3, −434.2), carousel → (−196.0, −434.2, 90°),
dlc → (−196.0, −82.9), off-camber → (−113.2, 0, 0°), run-in → (0, 0). Swell z = 1.5·sin(2π s/1650.8).
(Research m2/11 assumed y ≤ +10; the real bbox confirms the annex north of y = +40 is clear.)

### 8.3 Annex layout (`content/proving-ground.ts`, world id `proving-ground`, trackId `proving-loop`)
All coordinates world metres; rect `(x, y)` = centre of the START edge, `heading` in degrees here (radians in content);
zone base z = 0.5 m unless stated; priorities: apron/pad/links 2, street/platform 3, spurs 4.
| Zone id | Shape | Footprint | Surface / roughness | Contents |
|---|---|---|---|---|
| `field` (WorldDefinition.field) | rect | x −260…300, y 60…440, z 0.5, blend 30 | grass | the annex ground |
| `spur-east` | path from (85, 8.5) heading 0°: clothoid 15 m (κ 0→1/25), arc R 25 m, 0.9708 rad, clothoid 15 m (1/25→0), line 18.649 m; width 8 | ends (117.85, 60.0) heading 90° | asphalt, A; z [0.473, 0.5] | loop (launch straight, s ≈ 85, after the washboard) → annex |
| `spur-west` | path from (−60, 60) heading −90°: line 18.649 m, clothoid 15 (0→1/25), arc R 25 0.9708 rad, clothoid 15 (1/25→0); width 8 | ends (−27.15, 8.5) heading 0° | asphalt, A; z [0.5, −0.156] | annex → loop (run-in, s ≈ 1623.7) |
| `apron` | rect (40, 60), 90°, length 40, width 260 | x −90…170, y 60…100 | asphalt, A | paddock; signboards; spur ends |
| `street-link` | rect (60, 100), 90°, length 28, width 10 | x 55…65, y 100…128 | asphalt, A | apron → ride street east end |
| `ride-street` | rect (−240, 124), 0°, length 300, width 8 | x −240…60, y 120…128 | asphalt, B | features below (u from x = −240, w + north) |
| `dynamics-pad` | rect (−80, 240), 90°, length 190, width 320 | x −240…80, y 240…430 | asphalt, A | steering circle, slalom, ISO 3888-2 |
| `pad-link` | rect (−80, 128), 90°, length 112, width 10 | x −85…−75, y 128…240 | asphalt, A | street → pad |
| `braking-platform` | rect (147.5, 100), 90°, length 330, width 35 | x 130…165, y 100…430 | asphalt, A | lanes below (u from y = 100, w + west) |

Ride-street features (zone-local, RoadFeature): washboard {s 20, length 60, amplitude 0.025, wavelength [1.8, 1.8]};
pave {s 100, length 60, stone 0.15, amplitude 0.012, jointDepth 0.008} + patch u 100…160, w −4…4 `pave`; humps
(sleepers) {s 180, count 8, spacing 5, length 0.3, height 0.03}; single-wheel steps cosine-bump {s 235, length 0.6,
height 0.04, lateral [0.3, 2.0]} and {s 250, length 0.6, height 0.08, lateral [−2.0, −0.3]}; twist cosine-bumps length 3,
height 0.06 at s 265 (left [0.3, 2.0]), 271 (right [−2.0, −0.3]), 277 (left), 283 (right); pothole {s 293, l 0.8,
radius 0.3, depth 0.05}. (Scaled-down NATC/Nardò modules: research m2/11 §a; amplitudes are estimates.)
Dynamics pad: painted circle centre (−170, 335), radius 40 (prop `circle`); slalom cones on y = 280 at x = −90, −65,
−40, −15, 10, 35, 60 (25 m spacing); ISO 3888-2 lane along y = 400 from x₀ = −120 with W = 1.95 m (the loop's
`DLC_VEHICLE_WIDTH`): section 1 [x₀, x₀+12] centre y 400 width 1.1W+0.25 = 2.395; section 3 [x₀+25.5, x₀+36.5] centre
y = 400 + 2.395/2 + 1.0 + (W+1)/2 = 403.6725, width W+1 = 2.95; section 5 [x₀+49, x₀+61] centre y 400 width
max(1.3W+0.25, 3) = 3.0; cones at both edges at each of these sections' start, middle and end (18 cones; the
`dlcCones` pattern of `proving-loop.ts`).
Braking platform lanes (patches, tiles u 160…260 = y 260…360; lead-in 160 m, safety 70 m): L1 x 138.5…143 dry asphalt
(zone default); L2 x 143…147.5 → w [0, 4.5] `asphalt-wet`; L3 split-μ x 147.5…152: west half w [−2.25, 0]
`ceramic-wet`, east half asphalt; L4 x 152…156.5 → w [−9, −4.5] `ceramic-wet`.
Stations (spawn x, y, heading; `suspension` flag):
| id | spawn | phenomenon | suspension |
|---|---|---|---|
| `ride-street` | (−236, 124, 0°) | harshness | yes |
| `steering-pad` | (−130, 335, 90°) | steady-state-roll | yes |
| `slalom` | (−170, 280, 0°) | roll-reversal | yes |
| `lane-change` | (−200, 400, 0°) | lane-change | yes |
| `braking-platform` | (149.75, 105, 90°) | split-mu | no (tyre grip demonstration) |

Signs (prop `sign`) at each spawn, 6 m ahead and 6 m to the right, facing the spawn. Names, captions and experiment
lines are the executor's (no digits, `tests/arch/world-copy.test.ts`), e.g. steering pad experiment: "Hold a steady
speed round the circle, then swap suspension and watch the outside wheels."

### 8.4 Rendering contract (proving-ground feature 10-03; track feature terrain 10-03)
Meshes sample `world.sample(x, y).h` (zones, ≤ 0.25 m rows inside features, 0.5 m elsewhere; lift 3 mm +
polygonOffset); terrain vertices use `world.terrainHeight`; materials reuse the track feature's texture ids (asphalt,
cobbles, grass) through `ctx.assets` (no new assets); wet patches = `MeshPhysicalMaterial` clearcoat 1, roughness 0.15,
albedo ×0.65; markings by `onBeforeCompile` like the track; cones instanced (procedural lathe, one draw); signs as the
track's canvas signboards. Budget ≤ 25 draw calls for the annex at `high`. Node test: vertex heights equal the GroundWorld
within 1 mm; e2e screenshot of each station.

## 9. Features (M2 catalogue and M1 extensions)

| id | phase | requires | provides / does | consumes | plans |
|---|---|---|---|---|---|
| drive | overlay | — | service DRIVE (sources, arbiter, takeover edges); keyboard/gamepad/touch adapters; AUTO/MANUAL pill (speed, gear, aids popover and lamps, stations list, rejoin chip); reserved action row for other features' chips; hint; idle cue; out-of-bounds fade; R reset; gamepad rumble | store, bus, frame.drive, sim.current.drive.setIntent | 08-03, 09-05, 10-04 |
| proving-ground | scene | renderer | contributes world `proving-ground`; draws zones, markings, cones, signs | RENDER, sim.current.world | 10-03 (content 10-02) |
| tyre-vfx | scene | renderer | friction rings (1 draw), skid ribbons (≤ 4 draws) | RENDER, frame corners, store.driveMode | 11-01 |
| coach | overlay | — | one-line coach on `drive:event`, station cards on zone events, competence fading | bus, frame, world stations | 11-02 |
| replay | overlay | — | moment replay (Q), share link (fragment), open `#r=`/`#rid=`, server save (12-05) | bus `drive:play`, sim.current.drive.recording | 11-03, 12-05 |
| ghost-lab | scene | renderer | Compare (G): headless traces, ghost car, strip chart | registries.vehicleVisuals, sim-core ghost | 11-04 |
| phone-drive | overlay | drive, live-lab | screen side of the phone driver: driver QR, intent source 'phone', failsafe, telemetry to the phone | ROOM, DRIVE | 12-04 |
| live-ghosts [S] | scene | live-lab, renderer | other visitors' cars (10 Hz) | ROOM | 12-07 |

M1 extensions: **controls** (08-03: A/S/W/D shortcuts inactive outside Auto; Live chip triggers immediate release when
driving), **attract** (08-03: never starts unless `driveMode === 'auto'`), **camera** (08-04: manual provider, §10.3),
**telemetry-panel** (09-05: history only in Auto), **track** (10-03: terrain from GroundWorld), **insights** (11-02:
quiet outside Auto), **audio** (11-02: rpm/load engine, tyre cue), **engineer** + **analytics** (12-03), **live-lab**
(12-04: `driverKey` in ROOM), **credits** (13-01). Every M2 feature passes `?features=-<id>`; features never import each
other.

## 10. Experience specification

### 10.1 Keys (desktop)
| Key | Auto / Returning / Replay | Manual |
|---|---|---|
| ↑ / W | take the wheel (fresh press) | throttle (in reverse: brake) |
| ↓ | take the wheel | brake; held at standstill → reverse |
| S | M1 slow motion | brake / reverse (same as ↓) |
| ← → | take the wheel | steer |
| A / D | A: M1 amplification; D: nothing | steer left / right |
| Enter | take the wheel | hand back (Returning) |
| R | — | reset to the road / current station |
| Shift | — | handbrake |
| Q | — | moment replay (when offered) |
| G | — | compare suspensions (when ≥ 5 s recorded) |
| Space, 1/2/3, F/E/C, X, V, H, M, ? | M1 meanings in every mode (V while driving releases with a cut) | |

Keys use `KeyboardEvent.code` (layout independent); `event.repeat` ignored; the held set clears on `blur`,
`visibilitychange` and `contextmenu`; arrows/WASD/Shift `preventDefault` only while Manual; text inputs are ignored.
A driving key while paused unpauses. Takeover needs a rising edge; after a hand-back the input must return to neutral
before it can take over again.

### 10.2 Pill, hint, idle
Bottom centre, `src/ui` tokens: segmented AUTO | MANUAL (RETURNING / REPLAY as the active label), speed (km/h via
`format.ts`) and gear in Manual, an "Off the live lap · Rejoin" chip when detached, an aids popover (four toggles + "Assist:
simplified model"), a stations list (when a world is registered). The replay and ghost-lab features render their own
action chips (Moment replay, Compare, Share) in a bottom-centre row ABOVE the pill (CSS class `sl-drive-action`, the
pill's stylesheet reserves the row); features never touch each other's DOM. Hint after 4 s of
Auto; idle cue "Back to Auto in 3 · press any key" at 9 s, hand-back at 12 s (×2.5 with `?screen=1`), cancelled by any
input; `aria-live` polite for mode changes and the cue only.

### 10.3 Camera (08-04; research m2/08)
One rig, two target providers. Manual provider (when `driveMode !== 'auto'`): anchor = (drive.x, drive.y,
bodyPosition.z); ψ = drive.yaw; slip = clamp(wrap(atan2(v, u)), ±30°); w_vel = smoothstep(3, 10, |u|)·(u > 0);
r_ss = u·tan(steer)/L (frame.steer, wheelbase); r_pred = (yawRate + r_ss)/2; lead = clamp(0.35·r_pred, ±18°);
ψ_target = ψ + w_vel·slip + lead with a 1.5° dead zone; the existing Chase channels follow ψ_target (heading λ), speed01
= |u|/vMax; look-ahead point = anchor + 5·(L/2.8) m along ψ_target at aimY; reverse (u < −0.5): heading-based, behind the
car; eye height ≥ `world.sample(eye).h + 0.7`. Mode switch: blend weight b eases 0→1 (or 1→0) over 0.8 s, ψ, distance,
height, FOV interpolated between providers (wrap-aware); hard cut (Chase.reset) on `drive:mode` with `cut`, on a
`reset` drive event, or an anchor jump > 15 m. Director shots are refused outside Auto. Explore/close-up unchanged.
Reduced motion: blends become cuts (existing behaviour). No shake, no roll, world-up.

### 10.4 Touch and gamepad (10-04)
Touch (coarse pointer only, Manual or a "Drive" button in Auto): left horizontal slider (relative drag from touch-down,
spring back on release, `touch-action: none`, Pointer Events capture), right GAS above BRAKE pads (≥ 48 px, pressed =
1); digital=false for the slider, true for pads. Gamepad: `mapping === 'standard'` only; left stick X (axial dead zone
0.12, exponent 1.6), RT `buttons[7].value` throttle, LT `buttons[6].value` brake, A toggle Auto/Manual, X handbrake,
Y reset; re-read `navigator.getGamepads()` every frame; hot-plug toast; rumble via `vibrationActuator.playEffect
('dual-rumble')` when `effects` includes it: weak = road roughness (RMS travel rate), strong = bump-stop/kerb events,
120 ms effects at ≤ 20 Hz, toggle in the pill, off in Auto.

### 10.5 Feedback devices (≤ 6 visible kinds; research m2/13, m2/19)
Friction rings (on in Manual, toggle), skid marks (only past the limit), coach line, aid lamps + approximate badge in
the pill, moment replay, Compare. No numbers inside the 3D scene, no shake/blur/vignette, one accent colour (warn token)
only past the limit. Rings: instanced quad per corner on the road at the contact patch, radius = 0.25 m ·
√(capacity/static capacity), dot = (fx, fy)/capacity·radius in the wheel frame, warn colour when gripUse > 1; in Auto
it shows the demand estimate (label "model").

## 11. Validation test matrix (research m2/20 §6 → test files)

| # | Test | Bands / assertions | File (plan) |
|---|---|---|---|
| T1 | Linear bicycle identities (linear tyre f(s)=s, rigid loads test option) at 20/27.8/40 m/s | r/δ, a_y/δ, K within 1 % of closed form | `tests/sim-core/handling-bicycle.test.ts` (09-04) |
| T2 | K sign check (stiffness ratios for K −0.5…+3 °/g) | steer trend sign; V_char ±3 % | same |
| T3 | ISO 4138 quasi-steady ramp R 50 m, both directions | K(0.3 g) 0.5–3.5 °/g; ≥ 1.5× at 85 % peak a_y; L/R within 3 % | `handling-steady-state.test.ts` (09-04) |
| T4 | Roll gradient from T3 | within ±10 % of the Auto value at the same a_y (M1 measured 1.63–1.78 °/g incl. tyres) | same |
| T5 | Skidpad R 45.7 m | max steady a_y 0.90–1.10 g | same |
| T6 | ISO 7401 step steer, 100 km/h, 4 m/s² | T_yaw 0.10–0.25 s, T_ay 0.15–0.35 s, yaw overshoot ≤ 50 %, gain ±10 % of bicycle with measured K | `handling-transient.test.ts` (09-04) |
| T8 | Yaw damping vs speed (step responses at 10/20/30/40 m/s) | stable; overshoot grows with speed | same |
| T9 | ISO 3888-1 on the loop DLC with PathDriver, 80 km/h | completes inside the gates | `path-driver.test.ts` (10-01) |
| T10 | ISO 3888-2 on the annex lane with PathDriver, 60–80 km/h steps | max pass speed reported per suspension; no spin below the limit | `proving-ground-manoeuvres.test.ts` (10-04) |
| T11/T12/T13 | Brake in turn, lift-off in turn, power-on in turn (R 100 m, 0.4–0.5 g) | monotone direction (tightening on brake/lift, RWD progression on power), no spin at 0.3 g decel, inside the friction circle | `handling-combined.test.ts` (09-04) |
| T14 | 100–0 km/h, ABS on / off | 34–42 m on; off: front or rear locks, distance reported | `handling-longitudinal.test.ts` (09-04) |
| T15 | 0–100 km/h full throttle, TCS on | 3.6–4.8 s (0–60 mph 3.4–4.6 s); no gear hunting | same |
| T16 | Load sum and lateral transfer at 0.5 g | ΣN = m·g ±1e-6 relative; transfer m·a_y·h/t ±1 % | `handling-invariants.test.ts` (09-04) |
| T17 | Mirror symmetry; idle 10 s at rest | mirrored to 1e-9; no drift (< 1 mm) | same |
| T18 | 240 vs 480 Hz | key metrics within 2 % | same |
| T19 | Auto unchanged | golden hashes unchanged | `golden.test.ts` (every plan) |
| T20 | Validity flag | `approximate` true beyond 0.85 μ g, abs(β) > 10°, abs(κ) > 0.3 | `handling-invariants.test.ts` |
| S1 | Standstill: brake held on 5 % slope 10 s; coast to stop; full throttle from rest | < 1 mm creep; monotone decel; no ω oscillation (sign changes ≤ 2) | `plant-standstill.test.ts` (08-02 v0, 09-04 full) |
| S2 | Fuzz 200 000 steps, random intents/swaps/resets | all finite, faults reported | `plant-safety.test.ts` (09-04) |
| S3 | No allocation, cost | heap tripwire as M1; median step ≤ 25 µs printed | `plant-no-alloc.test.ts` (09-04) |
| H1 | Auto→Manual continuity at 20 lap times | §7.10 A thresholds | `handoff.test.ts` (08-02, extended 09-04) |
| H2 | Returning: 500 seeded starts (≤ 12 m, abs(ψ_e) ≤ 180°, v −5…40 m/s); 50 annex starts | latch ≤ 20 s / ≤ 60 s; corridor 30 m; no NaN | `returning.test.ts` (10-01) |
| H3 | Continuity of character: plant + PathDriver lap vs Auto lap | per section roll RMS diff < 0.25°, travel RMS < 4 mm, speed within 5 % | `continuity.test.ts` (10-01) |
| C1 | Compliance gates and properties | §7.5 | `compliance.test.ts` (09-01) |
| Y1 | Tyre: sign checks, camber/toe sweeps monotone, load sensitivity, friction circle, relaxation lag = σ/v ±10 % | | `tyre.test.ts` (09-01) |
| P1 | Powertrain: shift points, no hunting, LSD split, reverse logic, engine braking | | `powertrain.test.ts`, `aids.test.ts` (09-02) |
| D1 | det kernels vs reference; Node == Chromium drive hash | ≤ 1 ulp; equal hashes | `det-math.test.ts` (08-02), `tests/e2e/09-03-determinism.spec.ts` (09-03) |
| R1 | Replay round trip, encode/decode, CRC, keyframes, golden | bit-identical re-simulation | `replay*.test.ts` (11-03) |
| G1 | Ghost: same suspension A/A traces identical; B differs only via tables | | `ghost.test.ts` (11-04) |
| N1 | No universal winner report (MD-17) | printed table; identical-tables control | `handling-suspension.test.ts` (09-04) |

## 12. Cloudflare

### 12.1 Replays on D1 (12-01)
`worker/migrations/0001_replays.sql`:
```sql
CREATE TABLE IF NOT EXISTS replays (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  sim_version TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  suspension TEXT NOT NULL,
  seconds REAL NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS replays_expires ON replays (expires_at);
```
`POST /api/replays` (`routes/replays.ts`, zod `schemas/replay.ts`): `Content-Length` ≤ 96 KB else 413; body
`ReplaySaveRequest`; base64url-decode `data` (≤ `REPLAY_API.maxBytes` else 413); `DecompressionStream('deflate-raw')`
with a 1 MB output cap; `decodeReplay` must succeed and `header.ticks/240 ≤ REPLAY_LIMITS.maxSeconds` (400 otherwise —
structural validation only, no re-simulation in the Worker); Limiter `getByName('replays').admit({ rules: [{ key: ip,
limit: 5 }], windowMs: 60_000, budget: 2000 })` → 'busy' 429, 'rules' 503 `{error:'daily_cap'}`; Turnstile siteverify
(`https://challenges.cloudflare.com/turnstile/v0/siteverify`, form `secret`, `response`, `remoteip`) → 403 on failure,
503 `{error:'not_configured'}` when `env.TURNSTILE_SECRET` is unset; `DELETE FROM replays WHERE expires_at < ? LIMIT 50`
(purge on write; no cron); `INSERT … ON CONFLICT(sha256) DO NOTHING`, then `SELECT id, expires_at WHERE sha256 = ?`;
id = 12 chars from `ROOM_CODE_ALPHABET` via `crypto.getRandomValues` (rejection sampling); 201 `ReplaySaveResponse`.
`GET /api/replays/:id` → id format check, row with `expires_at > now` → 200 `ReplayGetResponse` (`Cache-Control:
public, max-age=300` — immutable content) else 404. No IP, user agent or client id is stored.
Secrets (never in the repo): `TURNSTILE_SECRET` via `npx wrangler secret put` (orchestrator / 12-01 with the env token);
the public site key lives in `src/features/replay/turnstile.ts` (12-05). Tests and e2e use Cloudflare's documented test
keys (site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`) through fake env / `page.route`.
`public/_headers` CSP (12-01): add `https://challenges.cloudflare.com` to `script-src` and `frame-src` (new directive).

### 12.1b Worker wiring for replays
`d1_databases` binding `REPLAYS` (§W1) and the two route mounts (§W2). `npm run typegen` regenerates
`worker-configuration.d.ts`; `worker/secrets.d.ts` declares the optional secrets. Migrations: `npx wrangler d1 migrations
apply suspension-lab-replays --remote` at deploy (12-01) and `--local` for `vite preview` e2e runs.

### 12.2 Room driver role (12-02; research m2/17)
- `POST /api/rooms` also generates `driverKey` (same generator) and calls `ROOM.init(hostKey, driverKey)`; the DO stores
  both; `CreateRoomResponse.driverKey` returned. Rooms created before 12-02 have no driver key (drivers refused 4401).
- Upgrade `role=driver` (private rooms only) → pending until `{t:'auth', k}` matches the driver key (timing-safe) →
  welcome; a newer authenticated driver closes the previous one with code **4409** (`replaced`); `presence.drivers`.
- Per-role token buckets: driver `driverMessagesPerSecond`/`driverBurst`, frame ≤ `driverMessageBytes` (else 1009);
  screen `tel` ≤ `telemetryPerSecond`; other roles unchanged.
- `in` (driver only) → relayed to every `screen` socket as `{...in, r: Date.now()}`, never broadcast, never stored;
  `tel` (screen only) → relayed to the driver socket; `in` from non-drivers / `tel` from non-screens → `err forbidden`.
  The role → socket sets are cached in memory (rebuilt from `getWebSockets()` attachments after hibernation).
- Latest-wins: no queueing; the screen drops `n` ≤ last seen (wrapping u32 compare).
- `scripts/smoke-room.mjs` gains a driver test (pair, 30 Hz for 5 s, screen receives ≥ 140 frames, audience receives 0).

### 12.3 Phone driver (12-04)
Screen (`phone-drive` feature, `?screen=1` only): a "Drive from your phone" card with a QR to
`/remote.html?room=CODE#d=<driverKey>` (driverKey from ROOM); intent source `'phone'`: latest `in` frame → intent
(steer s/1000, pedals /1000, digital = false), interpolate over one packet period, no extrapolation of pedals; failsafe:
no frame for 250 ms → decay to neutral over 300 ms; 1 s → `drive:request auto` (Returning) + banner "Controller lost";
link badge (amber > 150 ms frame age, red > 250 ms); `tel` at 5 Hz (speed, gear, mode index, k bits from bump-stop /
grip-limit events). Remote page driver panel (`src/remote/driver-panel.ts`): touch slider + GAS/BRAKE default; tilt
optional (`devicemotion` gravity, `atan2(gx, gy)` relative to a captured neutral, sign learned by "turn right" tap,
dead zone 3°, full lock 35°, exponent 1.4, One-Euro filter mincutoff 1.5 Hz, beta 0.01); iOS
`DeviceMotionEvent.requestPermission()` inside the tap handler before any await; Screen Wake Lock re-acquired on
visibility; 30 Hz frames + immediate frames on pedal edges, skip when `bufferedAmount > 0`; `navigator.vibrate` on `k`
bits (Android only).

### 12.4 Race Engineer for driving (12-03)
Client (engineer feature): while `driveMode !== 'auto'`, `EngineerTelemetry.drive` = { mode, detected = label of the
last drive event within 5 s ('none' otherwise; labels are copy without digits, e.g. "rear slide after lifting off"),
steer_deg (frame.steer), throttle_pct, brake_pct, sideslip_deg, yaw_rate_dps, gear, surface label, aids_active };
"Why did it do that?" uses the last event. Seek actions are skipped outside Auto. Worker: `schemas/engineer.ts` validates
the optional block; `engineer/facts.ts` adds driving cards (understeer and front load, lift-off oversteer and rear load
transfer, lock-up and ABS, wheelspin and traction, split-μ yaw, camber and toe under load) — tendencies only, no
numbers, pinned by `tests/worker/engineer-facts.test.ts` style ordering checks where the sim computes the claim; the
prompt adds a DRIVE section and the rule "explain the detected event only; if none, say what the telemetry shows";
`engineer/numbers.ts` treats drive numbers as payload numbers; `engineer/fallback.ts` has one sentence per event kind.
Budget and Limiter unchanged.

### 12.5 Analytics (12-03), crowd insight [S] (12-06), live ghosts [S] (12-07)
- `drive-session` on leaving Manual (whole seconds, ≥ 5 s), `station-visit` on zone entry while driving (speed rounded),
  DNT respected, off in e2e (M1 rules).
- [S] `GET /api/insight?station=&suspension=`: AE SQL API (`POST https://api.cloudflare.com/client/v4/accounts/{id}/
  analytics_engine/sql`, secret `AE_SQL_TOKEN`, account id from a var) → 2 m/s buckets weighted by `_sample_interval`,
  n < 30 → empty; Cache API 10 min; the coach's station card shows "Visitors entered at …" labelled
  "how visitors drove this model". 501 stub until then (12-01).
- [S] Live ghosts: viewers send `gst` ≤ 10 Hz while driving; the DO aggregates the latest per socket and broadcasts `gsts`
  every 100 ms to viewers (interest: nearest 24 by world distance to each recipient's last position), stops its interval
  after 10 s without `gst` (hibernation); clients interpolate with a 250 ms buffer and render translucent shells (no
  collisions, no names, no ranking). Free plan suits ≤ 20 drivers (research m2/14, m2/21).

## 13. Honesty additions (binding, extends ARCHITECTURE §14)
1. Every handling input is a model parameter; UI says "representative model" / "approximate"; no manufacturer names
   or performance claims; the published-figure bands live only in tests.
2. Aids are "Assist: simplified model" with a lamp when intervening; never named after a manufacturer system.
3. The ghost's autopilot is disclosed on screen whenever the ghost or its traces are visible.
4. Surface grip is "approximate surface grip"; tyre-grip stations say they are not suspension lessons.
5. `DriveFrame.approximate` drives a visible badge; the coach never states causes the detectors did not detect.
6. A replay of another model version is labelled; a resynced replay says "approximate from here".
7. No new digit-bearing copy (stations, coach templates, pill, captions): tests in 10-02, 11-02, 13-01.

## 14. Performance budgets (additions to ARCHITECTURE §18)
Plant step median ≤ 25 µs (Node), ≤ 2 tyre evaluations per wheel per step, 4 projections + 12 ground samples per step;
`step()`/`sample()` allocation-free (M1 tripwire); annex ≤ 25 draw calls, tyre VFX ≤ 5, ghost car ≤ 40 (body shell
only, no linkage visual), total ≤ 250 at `high` (07-01 measured 213 for the M1 follow view — the ghost may only be shown
on `medium`/`high` if the measured total stays ≤ 250, else body shell at `low` LOD); no new texture assets; the phone
remote stays three.js-free.

## 15. Risks, fallbacks and cut order
| Risk | Fallback / mitigation |
|---|---|
| Plant feel (twitchy keyboard, spins) | Aids on by default, steering limit, ramps; tuning only within the stated bands; human-verify checkpoint at the 08 and 09 gates |
| Low-speed chatter / creep | Deflection states + damping + sleep (§7.2/7.4); S1 tests; fallback: raise the low-speed blend to 2 m/s |
| A golden hash changes (refactor or det sweep) | R4 stop with the diff; fallback for the sweep: keep `Math.*` in the M1 files, document the cross-browser gap, rely on keyframe resync |
| Projection ambiguity near the hairpin finger (bump-strip 41 m from the launch straight) | warm start + ±60 m window + strided fallback; the corridor (18 m) is below half the 41 m gap |
| Returning fails to converge | 20 s / 60 s timeout → immediate release (cut) |
| Ghost exceeds the draw budget | body shell only; else traces only (MD-44 still met with the strip chart) |
| D1 / Turnstile not creatable with the token | fragment sharing only (MD-50), server save hidden (MD-51 moved to Deferred) |
| Phone latency on venue Wi-Fi | touch slider default, failsafe, phone on cellular; measure with the `sync` probe at rehearsal |
| SwiftShader e2e slowness | `?quality=low`, `__app.driveIntent` + `advance()` for deterministic driving in e2e |

**Cut order** (first to go): 12-07 live ghosts [S] → 12-06 crowd insight [S] → 12-05 server-shared replays → 12-04 phone
driver → 11-04 3D ghost car (keep traces) → braking-platform lanes (keep dry) → skid marks → audio extension. Never cut:
08-*, 09-01…09-04, 10-01…10-03, 11-01 rings, 11-03 recorder/replay core.

## 16. Open questions (need the orchestrator's decision; defaults are what the plans assume)
1. **A/S in Auto** keep their M1 meanings (amplification, slow motion) so WASD takeover is only W (+ arrows, Enter).
   Alternative: rebind amplification/slow motion to Shift+A / Shift+S and let all of WASD take over (changes UI-01 and M1
   e2e). Default: keep M1.
2. **Brake bias** uses the existing `brakeShare` 0.62 (shared with Auto's anti-dive tables) instead of the research's
   derived 0.68; consequence: the rear can lock first near 1.1 g without ABS. Default: keep (same car).
3. **Validation bands** were widened where the M1 representative tyre (μ 1.1, 1700 kg) cannot reach the real car's
   published figures (skidpad up to 1.10 g, 0–100 km/h up to 4.8 s). Default: accept; never retune M1 tyres.
4. **Turnstile** needs a widget (site key + secret); the API token's Turnstile permission is unverified. Default:
   12-01 tries via API, else the orchestrator creates it in the dashboard; until then server save answers 503 and the
   UI offers fragment links only.
5. **Workers Paid** before the event (D1/DO/AI daily caps) — unchanged owner decision.
6. **Crowd insight** needs an Analytics Engine SQL token (`AE_SQL_TOKEN`, Account Analytics read). Default: stretch.
7. **Idle hand-back** 12 s (30 s on `?screen=1`): confirm for the booth.
8. **Determinism scope:** Chromium + Node only (no Firefox/WebKit binaries). Default: accept the gap; replays resync.
9. **Motorcycle Manual** (lean-target controller) is out of M2; schedule as v1.5?
10. **Hill / grade station** not planned (non-goal); confirm.

## 17. Reality notes (13-01 audit; where the built system differs from the text above)
The contract blocks above are unchanged and still match the code byte for byte (`tests/arch/contracts-verbatim.test.ts`,
incl. 11-05's `strike` / `hard-stop` DriveEvent kinds). Prose that reality contradicts, with the plan that changed it:
- §7.1 `Recorder.window(seconds)` is `last(seconds)` (the M1 purity test bans the word in sim-core; 11-03).
- §7.9 / §11 H2: `RETURN_TIMEOUT` is 40 s (10-04), not 20 s; from 500 random starts 92 % latch within 40 s and the
  rest are released with a cut; "never leaves a 30 m corridor" does not hold for starts at speed pointing away (10-01).
  The latch uses the CG, 1.0° heading tolerance (10-01).
- §7.13 snapshot: `PLANT_SNAPSHOT_LENGTH` 96 (11-03 appended the previous step's tyre values and road rate).
- §7.14 Compare uses a disclosed ghost driver (the visitor's own commands + small corrections), not the PathDriver
  (11-04).
- §10.2 idle: the cue shows over the last 3 s (27 s on `?screen=1`); the take-the-wheel prompt re-arms after every
  hand-back instead of persisting its dismissal (08-03: a booth sees many visitors).
- §10.5 friction-ring reference radius 0.4 m (11-01); past-limit test in the plant is slip-based.
- §11 T15 0–100 km/h measures 4.99 s (band 3.6–4.8 s; friction-limited, not tuned, 09-04); T10 ISO 3888-2 pass speed
  measures the PathDriver, not the suspension (10-04).
- §14 cost: the plant step is ~17–20 µs median, but it is not allocation-free in V8: calls V8 does not inline box their
  double arguments and returns (13-01 measured Returning ~13.6 KB/step, Manual ~11.5, Auto ~3.7 of short-lived
  garbage after removing the largest sources). The heap tripwires catch retained growth, not this churn.
- §12.4 engineer: while driving only `set_view` and `highlight_component` are offered (12-03); the daily model-call
  cap is 280 (13-01; driving answers cost ~27–30 neurons).
- Off the live lap (MD-07) and "Reset to road" (MD-18) were added in 13-01 (they had no UI before).
- §16 item 4: the Turnstile widget exists (12-01); saving is on in production.
