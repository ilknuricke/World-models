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
