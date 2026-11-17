/** Every sound of the game, synthesised – the page carries no sound files. */

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** Browsers only let a page make sound after a click: call this from the click that starts the game. */
export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (!out) {
      out = ctx.createGain();
      out.gain.value = 0.55;
      out.connect(ctx.destination);
    }
    void ctx.resume();
  } catch {
    /* no sound on this device: the game still works */
  }
}

function ready(): boolean {
  return !!ctx && !!out && ctx.state === 'running';
}

function tone(freq: number, at: number, length: number, type: OscillatorType = 'sine', gain = 0.2, slideTo?: number): void {
  if (!ready()) return;
  const t = ctx!.currentTime + at;
  const osc = ctx!.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + length);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(g).connect(out!);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

function noise(at: number, length: number, filter: BiquadFilterType, freq: number, gain: number, sweepTo?: number): void {
  if (!ready()) return;
  if (!noiseBuffer) {
    noiseBuffer = ctx!.createBuffer(1, ctx!.sampleRate * 2, ctx!.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = ctx!.currentTime + at;
  const src = ctx!.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const f = ctx!.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + length);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(f).connect(g).connect(out!);
  src.start(t, Math.random());
  src.stop(t + length + 0.02);
}

export const sfx = {
  /** The blade going through a box, and its balloon bursting. */
  cut(): void {
    noise(0, 0.14, 'bandpass', 2400, 0.5, 500);
    noise(0.02, 0.09, 'highpass', 1800, 0.6);
    tone(260, 0.02, 0.1, 'triangle', 0.25, 90);
  },
  correct(): void {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.05 + i * 0.07, 0.28, 'triangle', 0.22));
  },
  wrong(): void {
    tone(190, 0, 0.42, 'sawtooth', 0.2, 85);
    tone(142, 0.04, 0.42, 'square', 0.1, 64);
  },
  /** A piece of the tower breaking off. */
  crumble(): void {
    noise(0.1, 1.3, 'lowpass', 520, 0.9, 70);
    for (let i = 0; i < 5; i++) tone(95 - i * 9, 0.15 + i * 0.13, 0.2, 'triangle', 0.3, 38);
  },
  /** The whole tower going down. */
  collapse(): void {
    noise(0, 3.2, 'lowpass', 700, 1.0, 50);
    for (let i = 0; i < 12; i++) tone(110 - i * 5, i * 0.16, 0.26, 'triangle', 0.32, 32);
    tone(660, 0.6, 2.2, 'sine', 0.12, 110); // the fall
  },
  levelUp(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35 + i * 0.1, 0.34, 'square', 0.11));
  },
  start(): void {
    [392, 523, 659].forEach((f, i) => tone(f, i * 0.09, 0.26, 'triangle', 0.2));
  },
  /** The boxes of a new problem rushing up. */
  rise(): void {
    noise(0, 0.5, 'bandpass', 300, 0.22, 1400);
  },
};
