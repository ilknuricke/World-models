import { describe, expect, it } from 'vitest';
import { combustionLoop, crossfadeLoop, outputLimiterCurve } from '../../src/features/audio/engine';
import { engineColour, type EngineColour } from '../../src/features/audio/mix';

const colour = (): EngineColour => ({ pulseRate: 0, cutoff: 0, intake: 0, intakeFrequency: 0 });
const amplitude = (samples: Float32Array, frequency: number, rate: number) => {
  let real = 0;
  let imaginary = 0;
  for (let i = 0; i < samples.length; i++) {
    const phase = 2 * Math.PI * frequency * i / rate;
    real += samples[i]! * Math.cos(phase);
    imaginary += samples[i]! * Math.sin(phase);
  }
  return Math.hypot(real, imaginary) / samples.length;
};

describe('distinct engine sound design', () => {
  it('uses a smooth multi-cylinder pulse train for the GT and audibly separated twin firing gaps', () => {
    const rate = 24000;
    const car = combustionLoop('car', rate);
    const twin = combustionLoop('motorcycle', rate);
    expect(car).toHaveLength(rate);
    expect(twin).toHaveLength(rate);
    // 3,000 rpm: a four-stroke cycle is 25 Hz; the GT fires six evenly spaced pulses per cycle.
    expect(amplitude(car, 150, rate)).toBeGreaterThan(amplitude(car, 25, rate) * 8);
    expect(amplitude(twin, 25, rate)).toBeGreaterThan(amplitude(car, 25, rate) * 8);
    expect(amplitude(twin, 50, rate)).toBeGreaterThan(amplitude(car, 50, rate) * 3);
    for (const samples of [car, twin]) {
      let mean = 0;
      let peak = 0;
      for (const value of samples) {
        expect(Number.isFinite(value)).toBe(true);
        mean += value / samples.length;
        peak = Math.max(peak, Math.abs(value));
      }
      expect(Math.abs(mean)).toBeLessThan(1e-7);
      expect(peak).toBeLessThan(0.851);
      expect(Math.abs(samples[0]! - samples.at(-1)!)).toBeLessThan(0.1);
    }
  });

  it('overlaps a non-periodic recording without adding a discontinuity at the loop boundary', () => {
    const source = Float32Array.from({ length: 1000 }, (_, i) => i / 1000 - 0.5);
    const original = source.slice();
    const loop = crossfadeLoop(source, 100);
    expect(loop).toHaveLength(900);
    expect(source).toEqual(original);
    // Last original sample before the tail is followed by the tail's first sample, rather than the old head.
    expect(Math.abs(loop[0]! - loop.at(-1)!)).toBeLessThan(0.002);
    expect(Math.abs(loop[100]! - loop[99]!)).toBeLessThan(0.002);
    for (const value of loop) expect(value).toBeGreaterThanOrEqual(-0.5);
    expect(crossfadeLoop(new Float32Array([0, 0.5, -0.2]), 100)).toEqual(new Float32Array([0, 0.5, -0.2]));
  });

  it('keeps the twin brighter than the GT and changes intake and exhaust colour with load', () => {
    const car = engineColour(colour(), 'car', 0.6, 0.7, 4000, 1);
    const bike = engineColour(colour(), 'motorcycle', 0.6, 0.7, 4000, 1);
    const coast = engineColour(colour(), 'motorcycle', 0.6, 0, 4000, 1);
    expect(bike.cutoff).toBeGreaterThan(car.cutoff * 1.5);
    expect(bike.intakeFrequency).toBeGreaterThan(car.intakeFrequency);
    expect(bike.intake).toBeGreaterThan(coast.intake);
    expect(coast.intake).toBe(0);
    expect(coast.cutoff).toBeLessThan(bike.cutoff);
    expect(engineColour(colour(), 'car', 0.6, 0.7, 6000, 1).pulseRate).toBeGreaterThan(car.pulseRate);
    expect(engineColour(colour(), 'car', 0.6, 0.7, 4000, 0.25).pulseRate).toBeLessThan(car.pulseRate);
  });

  it('bounds invalid telemetry before it reaches Web Audio parameters', () => {
    for (const cls of ['car', 'motorcycle'] as const) {
      for (const revs of [Number.NaN, Number.POSITIVE_INFINITY, -10, 0, 0.5, 20]) {
        for (const load of [Number.NaN, -10, 0, 0.5, 20]) {
          for (const rpm of [Number.NaN, Number.POSITIVE_INFINITY, -10, 0, 1000, 1e9]) {
            const result = engineColour(colour(), cls, revs, load, rpm, Number.NaN);
            expect(Object.values(result).every(Number.isFinite)).toBe(true);
            expect(result.pulseRate).toBeGreaterThan(0);
            expect(result.pulseRate).toBeLessThanOrEqual(10000 / 3000);
            expect(result.cutoff).toBeGreaterThan(0);
            expect(result.cutoff).toBeLessThanOrEqual(6500);
            expect(result.intake).toBeGreaterThanOrEqual(0);
            expect(result.intake).toBeLessThanOrEqual(0.301);
          }
        }
      }
    }
  });

  it('leaves normal peaks unchanged and keeps coincident transients below full-scale output', () => {
    const curve = outputLimiterCurve();
    expect(curve[1024]).toBe(0);
    expect(curve[1536]).toBe(0.5);
    expect(curve[0]).toBeGreaterThan(-0.96);
    expect(curve.at(-1)).toBeLessThan(0.96);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]!);
  });
});
