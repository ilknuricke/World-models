/** Small, repeatable combustion layers. These are sound-design cues, not recordings or vehicle measurements. */
import type { VehicleClass } from '../../contracts/suspension';

export const COMBUSTION_REFERENCE_RPM = 3000;

/** One second contains an integer number of four-stroke cycles at the reference speed. */
export function combustionLoop(cls: VehicleClass, sampleRate: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.round(sampleRate));
  const cycleSeconds = 120 / COMBUSTION_REFERENCE_RPM;
  // The GT has a smooth multi-cylinder exhaust. The retro twin has alternating 270/450 degree firing gaps.
  const firing = cls === 'car' ? [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6] : [0, 3 / 8];
  const decay = cls === 'car' ? 0.0025 : 0.0042;
  const resonance = cls === 'car' ? 185 : 125;
  const tail = Math.ceil(sampleRate * 0.035);
  let seed = cls === 'car' ? 137 : 7919;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  for (let cycle = 0; cycle < 25; cycle++) {
    for (const phase of firing) {
      const amplitude = 0.93 + random() * 0.14;
      const start = Math.round((cycle + phase) * cycleSeconds * sampleRate);
      for (let i = 0; i < tail; i++) {
        const t = i / sampleRate;
        const envelope = (1 - Math.exp(-t / 0.00025)) * Math.exp(-t / decay);
        const body = Math.sin(2 * Math.PI * resonance * t) + 0.28 * Math.sin(2 * Math.PI * resonance * 2.3 * t);
        const texture = (random() * 2 - 1) * (cls === 'car' ? 0.06 : 0.1);
        const index = (start + i) % samples.length;
        samples[index] = samples[index]! + amplitude * envelope * (body + texture);
      }
    }
  }
  let mean = 0;
  for (const value of samples) mean += value / samples.length;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = samples[i]! - mean;
    peak = Math.max(peak, Math.abs(samples[i]!));
  }
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! * 0.85 / peak;
  return samples;
}

/** Overlap the original tail/head so an imperfect sample boundary cannot click every eight seconds. */
export function crossfadeLoop(samples: Float32Array, overlap: number): Float32Array<ArrayBuffer> {
  const fade = Math.min(Math.max(2, Math.round(overlap)), Math.floor(samples.length / 4));
  if (fade < 2) return samples.slice();
  const result = samples.slice(0, samples.length - fade);
  for (let i = 0; i < fade; i++) {
    const weight = 0.5 - 0.5 * Math.cos(Math.PI * i / (fade - 1));
    result[i] = samples[samples.length - fade + i]! * (1 - weight) + samples[i]! * weight;
  }
  return result;
}

/** Transparent below normal peaks, a soft ceiling when engine/road/impact transients coincide. */
export function outputLimiterCurve(): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: 2049 }, (_, i) => {
    const x = i / 1024 - 1;
    const value = Math.abs(x);
    return value <= 0.85 ? x : Math.sign(x) * (0.85 + 0.13 * Math.tanh((value - 0.85) / 0.13));
  });
}

/** The sample identity remains audible; the generated pulse and intake layers give it changing load and texture. */
export interface EngineVoice {
  readonly gain: GainNode;
  readonly src: AudioBufferSourceNode | null;
  readonly pulse: AudioBufferSourceNode;
  readonly filter: BiquadFilterNode;
  readonly intake: GainNode;
  readonly intakeFilter: BiquadFilterNode;
  readonly g: { v: number };
  readonly r: { v: number };
  readonly p: { v: number };
  readonly f: { v: number };
  readonly i: { v: number };
  readonly n: { v: number };
}

export function createEngineVoice(ac: AudioContext, master: GainNode, decoded: AudioBuffer | null, noise: AudioBuffer, cls: VehicleClass): EngineVoice {
  const gain = ac.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cls === 'car' ? 1100 : 1800;
  filter.Q.value = 0.55;
  filter.connect(gain);
  let src: AudioBufferSourceNode | null = null;
  if (decoded) {
    const overlap = Math.round(decoded.sampleRate * 0.05);
    const length = decoded.length - Math.min(overlap, Math.floor(decoded.length / 4));
    const loop = ac.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) loop.copyToChannel(crossfadeLoop(decoded.getChannelData(channel), overlap), channel);
    src = ac.createBufferSource();
    src.buffer = loop;
    src.loop = true;
    src.connect(filter);
    src.start();
  }
  const pulseBuffer = ac.createBuffer(1, Math.round(ac.sampleRate), ac.sampleRate);
  pulseBuffer.copyToChannel(combustionLoop(cls, ac.sampleRate), 0);
  const pulseGain = ac.createGain();
  pulseGain.gain.value = cls === 'car' ? 0.34 : 0.62;
  pulseGain.connect(filter);
  const pulse = ac.createBufferSource();
  pulse.buffer = pulseBuffer;
  pulse.loop = true;
  pulse.connect(pulseGain);
  pulse.start();
  const intake = ac.createGain();
  intake.gain.value = 0;
  intake.connect(gain);
  const intakeFilter = ac.createBiquadFilter();
  intakeFilter.type = 'bandpass';
  intakeFilter.frequency.value = cls === 'car' ? 650 : 1400;
  intakeFilter.Q.value = cls === 'car' ? 0.7 : 1.2;
  intakeFilter.connect(intake);
  const intakeSource = ac.createBufferSource();
  intakeSource.buffer = noise;
  intakeSource.loop = true;
  intakeSource.connect(intakeFilter);
  intakeSource.start();
  return { gain, src, pulse, filter, intake, intakeFilter, g: { v: 0 }, r: { v: 1 }, p: { v: 1 }, f: { v: filter.frequency.value }, i: { v: 0 }, n: { v: intakeFilter.frequency.value } };
}
