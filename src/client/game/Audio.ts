import type { WeaponClass } from '../../shared/items';
import { clamp } from '../../shared/math';

interface ShotProfile {
  decay: number;
  freq: number;
  q: number;
  thump: number;
  thumpDecay: number;
  gain: number;
}

const SHOT: Record<WeaponClass, ShotProfile> = {
  pistol: { decay: 0.13, freq: 1800, q: 0.7, thump: 140, thumpDecay: 0.08, gain: 0.55 },
  smg: { decay: 0.1, freq: 2000, q: 0.8, thump: 120, thumpDecay: 0.07, gain: 0.5 },
  ar: { decay: 0.17, freq: 1500, q: 0.6, thump: 90, thumpDecay: 0.12, gain: 0.7 },
  shotgun: { decay: 0.32, freq: 900, q: 0.5, thump: 70, thumpDecay: 0.22, gain: 0.85 },
  dmr: { decay: 0.26, freq: 1200, q: 0.6, thump: 80, thumpDecay: 0.16, gain: 0.8 },
  sniper: { decay: 0.42, freq: 1000, q: 0.5, thump: 60, thumpDecay: 0.25, gain: 0.95 },
  lmg: { decay: 0.16, freq: 1400, q: 0.6, thump: 85, thumpDecay: 0.12, gain: 0.72 },
};

/** Prozedurale Klänge über WebAudio – keine Audiodateien nötig. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private heli: { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; filt: BiquadFilterNode } | null = null;
  private ambient: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  listener = { x: 0, y: 0 };
  volume = 0.7;

  unlock() {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private ready() {
    return !!(this.ctx && this.master && this.noise && this.ctx.state === 'running');
  }

  /** Lautstärke und Panorama abhängig von Entfernung zum Hörer. */
  private spatial(x: number, y: number, ref = 320): { g: number; pan: number; far: number } {
    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const d = Math.hypot(dx, dy);
    const g = 1 / Math.pow(1 + d / ref, 1.35);
    return { g, pan: clamp(dx / 700, -0.9, 0.9), far: d };
  }

  private chain(gain: number, pan: number): { input: GainNode; t: number } | null {
    if (!this.ready()) return null;
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.master!);
    return { input: g, t: ctx.currentTime };
  }

  private noiseBurst(dest: AudioNode, t: number, decay: number, type: BiquadFilterType, freq: number, q: number, gain: number, freqEnd?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
    this.voices++;
    src.onended = () => this.voices--;
  }

  private tone(dest: AudioNode, t: number, freq: number, decay: number, gain: number, type: OscillatorType = 'sine', freqEnd?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  gunshot(wclass: WeaponClass, x: number, y: number, own = false) {
    if (!this.ready() || this.voices > 40) return;
    const p = SHOT[wclass] ?? SHOT.ar;
    const s = own ? { g: 1, pan: 0, far: 0 } : this.spatial(x, y, 380);
    if (s.g < 0.012) return;
    const c = this.chain(p.gain * s.g * (own ? 0.8 : 1), s.pan);
    if (!c) return;
    const muffle = s.far > 900 ? clamp(1 - (s.far - 900) / 1800, 0.15, 1) : 1;
    this.noiseBurst(c.input, c.t, p.decay * (1 + (1 - muffle) * 0.8), 'lowpass', p.freq * muffle + 300, p.q, 1, 200);
    this.noiseBurst(c.input, c.t, 0.04, 'highpass', 3000, 0.7, 0.5 * muffle);
    this.tone(c.input, c.t, p.thump, p.thumpDecay, 0.9, 'sine', p.thump * 0.5);
  }

  impact(x: number, y: number, metal = false) {
    const s = this.spatial(x, y, 200);
    if (s.g < 0.03) return;
    const c = this.chain(0.25 * s.g, s.pan);
    if (!c) return;
    this.noiseBurst(c.input, c.t, 0.05, 'bandpass', metal ? 3200 : 1600, 2, 1);
    if (metal) this.tone(c.input, c.t, 2400 + Math.random() * 800, 0.08, 0.15, 'triangle');
  }

  flesh(x: number, y: number) {
    const s = this.spatial(x, y, 220);
    const c = this.chain(0.35 * s.g, s.pan);
    if (!c) return;
    this.noiseBurst(c.input, c.t, 0.08, 'lowpass', 600, 1, 1);
    this.tone(c.input, c.t, 120, 0.08, 0.5);
  }

  hitmarker(head: boolean, kill: boolean) {
    const c = this.chain(0.22, 0);
    if (!c) return;
    this.tone(c.input, c.t, head ? 1900 : 1400, 0.05, 0.6, 'square');
    if (kill) this.tone(c.input, c.t + 0.06, 900, 0.12, 0.5, 'triangle');
  }

  armorHit() {
    const c = this.chain(0.3, 0);
    if (!c) return;
    this.tone(c.input, c.t, 2600, 0.06, 0.4, 'triangle');
    this.noiseBurst(c.input, c.t, 0.06, 'highpass', 2500, 1, 0.5);
  }

  hurt() {
    const c = this.chain(0.45, 0);
    if (!c) return;
    this.noiseBurst(c.input, c.t, 0.15, 'lowpass', 500, 1, 1);
    this.tone(c.input, c.t, 90, 0.18, 0.8);
  }

  reload(x: number, y: number, own: boolean) {
    const s = own ? { g: 1, pan: 0 } : this.spatial(x, y, 160);
    if (s.g < 0.04) return;
    const c = this.chain(0.25 * s.g, s.pan);
    if (!c) return;
    this.noiseBurst(c.input, c.t, 0.04, 'bandpass', 2200, 3, 1);
    this.noiseBurst(c.input, c.t + 0.35, 0.05, 'bandpass', 1500, 3, 1);
  }

  reloadDone() {
    const c = this.chain(0.25, 0);
    if (!c) return;
    this.noiseBurst(c.input, c.t, 0.05, 'bandpass', 2600, 4, 1);
    this.tone(c.input, c.t, 1200, 0.03, 0.2, 'square');
  }

  dry() {
    const c = this.chain(0.3, 0);
    if (!c) return;
    this.noiseBurst(c.input, c.t, 0.025, 'highpass', 4000, 2, 1);
  }

  footstep(x: number, y: number, own: boolean, soft = false) {
    const s = own ? { g: 0.5, pan: 0 } : this.spatial(x, y, 120);
    if (s.g < 0.03) return;
    const c = this.chain((soft ? 0.12 : 0.22) * s.g, s.pan);
    if (!c) return;
    this.noiseBurst(c.input, c.t, 0.07, 'lowpass', soft ? 380 : 700, 1, 1);
  }

  explosion(x: number, y: number) {
    const s = this.spatial(x, y, 600);
    const c = this.chain(1.1 * s.g, s.pan);
    if (!c) return;
    this.noiseBurst(c.input, c.t, 1.4, 'lowpass', 2200, 0.5, 1, 90);
    this.tone(c.input, c.t, 55, 0.9, 1, 'sine', 30);
  }

  ui(kind: 'click' | 'good' | 'bad' | 'pickup' | 'open' | 'beep' | 'level') {
    const c = this.chain(0.22, 0);
    if (!c) return;
    const t = c.t;
    switch (kind) {
      case 'click':
        this.tone(c.input, t, 900, 0.04, 0.4, 'square');
        break;
      case 'pickup':
        this.noiseBurst(c.input, t, 0.08, 'bandpass', 1200, 2, 0.7);
        this.tone(c.input, t, 600, 0.05, 0.25, 'triangle');
        break;
      case 'open':
        this.noiseBurst(c.input, t, 0.2, 'bandpass', 700, 1.5, 0.7);
        break;
      case 'good':
        this.tone(c.input, t, 660, 0.12, 0.5, 'triangle');
        this.tone(c.input, t + 0.1, 990, 0.18, 0.5, 'triangle');
        break;
      case 'bad':
        this.tone(c.input, t, 300, 0.2, 0.5, 'sawtooth');
        break;
      case 'beep':
        this.tone(c.input, t, 1300, 0.07, 0.35, 'sine');
        break;
      case 'level':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(c.input, t + i * 0.09, f, 0.25, 0.4, 'triangle'));
        break;
    }
  }

  heartbeat() {
    const c = this.chain(0.35, 0);
    if (!c) return;
    this.tone(c.input, c.t, 60, 0.12, 1);
    this.tone(c.input, c.t + 0.18, 55, 0.14, 0.8);
  }

  /** Rotorgeräusch des Evakuierungs-Helis. */
  setHeli(active: boolean, x = 0, y = 0) {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    if (active && !this.heli) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 260;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 11;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(gain.gain);
      const pan = ctx.createStereoPanner();
      src.connect(filt).connect(gain).connect(pan).connect(this.master!);
      src.start();
      lfo.start();
      this.heli = { src, gain, pan, filt };
    }
    if (!active && this.heli) {
      this.heli.src.stop();
      this.heli = null;
    }
    if (this.heli) {
      const s = this.spatial(x, y, 700);
      this.heli.gain.gain.setTargetAtTime(Math.min(1.2, s.g * 1.6), ctx.currentTime, 0.2);
      this.heli.pan.pan.setTargetAtTime(s.pan, ctx.currentTime, 0.2);
    }
  }

  startAmbient() {
    if (!this.ready() || this.ambient) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    this.ambient = { src, gain: g };
  }

  stopAll() {
    this.setHeli(false);
    if (this.ambient) {
      this.ambient.src.stop();
      this.ambient = null;
    }
  }
}

export const audio = new AudioEngine();
