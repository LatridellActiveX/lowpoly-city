/**
 * audio/sound.ts — PR 6 SOUND EFFECTS, synthesised live with the Web Audio
 * API. There are NO audio files (nothing to license, nothing to download):
 * every sound is a few oscillators and/or a burst of filtered noise shaped
 * by a gain envelope, built the moment it plays.
 *
 * SIGNAL GRAPH
 *     voice ─► ui bus (gain) ──┐
 *     voice ─► fx bus (gain) ──┼─► master (gain) ─► destination
 *   The master gain = volume × (muted ? 0 : 1); the two buses are the UI and
 *   Effects sub-volumes from Settings. All four values persist in
 *   localStorage ('lowpoly-city-audio').
 *
 * AUTOPLAY RULES: browsers only allow an AudioContext to start after a user
 * gesture, so the context is created (or resumed) on the first pointerdown /
 * keydown anywhere on the page. Before that, play() calls are ignored.
 *
 * NOT SPAMMY: each sound id has a minimum gap (THROTTLE ms) — dragging a
 * road over 30 tiles fires one thud per ~70 ms, not 30 at once — and every
 * play gets a small random pitch wobble (±6 %) so repeats don't sound robotic.
 */

export type SoundId =
  | 'click' | 'hover' | 'open' | 'close' | 'tool'
  | 'road' | 'power' | 'pipe' | 'zone' | 'place' | 'parking'
  | 'complete' | 'levelup' | 'bulldoze' | 'error' | 'ding';

export interface AudioSettings { volume: number; ui: number; fx: number; muted: boolean }
const KEY = 'lowpoly-city-audio';
export function loadAudioSettings(): AudioSettings {
  const d: AudioSettings = { volume: 0.6, ui: 0.7, fx: 0.8, muted: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return d; }
}

/** UI sounds go to the UI bus; everything else is an effect. */
const UI_SOUNDS = new Set<SoundId>(['click', 'hover', 'open', 'close', 'tool', 'ding']);
/** Minimum milliseconds between two plays of the same sound. */
const THROTTLE: Partial<Record<SoundId, number>> = { hover: 60, road: 70, power: 90, pipe: 90, zone: 80, place: 120, bulldoze: 90, complete: 250, levelup: 250, error: 200, ding: 400 };

class Sound {
  settings = loadAudioSettings();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus: Record<'ui' | 'fx', GainNode> = {} as never;
  private last = new Map<SoundId, number>();
  private noiseBuf: AudioBuffer | null = null;

  /** Called once from main.ts: unlock on the first gesture. */
  attach(): void {
    const unlock = () => {
      if (!this.ctx) this.init();
      else if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }
  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private init(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    for (const k of ['ui', 'fx'] as const) { this.bus[k] = this.ctx.createGain(); this.bus[k].connect(this.master); }
    // One second of white noise, reused by every noisy sound (thuds, swishes, crumbles).
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const ch = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    this.apply();
  }

  /** Push the settings into the gains and persist them. */
  set(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* storage blocked: still applies this session */ }
    this.apply();
  }
  private apply(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume, t, 0.02);
    this.bus.ui.gain.setTargetAtTime(this.settings.ui, t, 0.02);
    this.bus.fx.gain.setTargetAtTime(this.settings.fx, t, 0.02);
  }

  /** Play a sound (ignored before the first gesture, while muted, or if throttled). */
  play(id: SoundId): void {
    if (!this.ctx || this.settings.muted || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.last.get(id) ?? -1e9) < (THROTTLE[id] ?? 40)) return;
    this.last.set(id, now);
    const out = this.bus[UI_SOUNDS.has(id) ? 'ui' : 'fx'];
    const p = 1 + (Math.random() - 0.5) * 0.12; // ±6 % pitch wobble
    const t = this.ctx.currentTime + 0.005;
    switch (id) {
      case 'click': this.tone(out, t, 1800 * p, 0.03, 0.15, 'triangle', 900 * p); break;
      case 'hover': this.tone(out, t, 2600 * p, 0.015, 0.04, 'sine'); break;
      case 'open': this.tone(out, t, 520 * p, 0.09, 0.18, 'sine', 900 * p); break; // rising "pop"
      case 'close': this.tone(out, t, 900 * p, 0.08, 0.15, 'sine', 480 * p); break; // falling "pop"
      case 'tool': this.tone(out, t, 1200 * p, 0.05, 0.12, 'square', 1500 * p, 2400); break;
      case 'road': this.noise(out, t, 0.14, 0.5, 'lowpass', 260 * p); this.tone(out, t, 90 * p, 0.12, 0.35, 'sine', 55); break; // thud + gravel
      case 'power': this.noise(out, t, 0.12, 0.25, 'highpass', 3500 * p); this.tone(out, t, 120 * p, 0.1, 0.12, 'sawtooth', 60, 900); break; // zap / crackle
      case 'pipe': this.tone(out, t, 300 * p, 0.12, 0.25, 'sine', 140 * p); this.tone(out, t + 0.05, 220 * p, 0.1, 0.2, 'sine', 380 * p); this.noise(out, t, 0.05, 0.15, 'bandpass', 900); break; // clunk + gurgle
      case 'zone': this.noise(out, t, 0.18, 0.22, 'bandpass', 1400 * p, 2600 * p); break; // paint swish
      case 'place': this.tone(out, t, 70 * p, 0.2, 0.5, 'sine', 45); this.noise(out, t, 0.08, 0.3, 'lowpass', 500); break; // building thump
      case 'parking': this.tone(out, t, 660 * p, 0.06, 0.15, 'triangle'); this.tone(out, t + 0.07, 880 * p, 0.06, 0.15, 'triangle'); break;
      case 'complete': [523, 659, 784].forEach((f, k) => this.tone(out, t + k * 0.08, f * p, 0.35, 0.18, 'sine')); break; // chime
      case 'levelup': [784, 988, 1175, 1568].forEach((f, k) => this.tone(out, t + k * 0.05, f * p, 0.2, 0.12, 'triangle')); break; // sparkle
      case 'bulldoze': this.noise(out, t, 0.35, 0.5, 'lowpass', 700 * p, 150); this.tone(out, t, 60 * p, 0.3, 0.3, 'sawtooth', 35, 300); break; // crumble
      case 'error': this.tone(out, t, 140, 0.18, 0.25, 'square', 120, 700); break; // buzz
      case 'ding': this.tone(out, t, 1320 * p, 0.5, 0.2, 'sine'); this.tone(out, t, 1980 * p, 0.35, 0.08, 'sine'); break;
    }
  }

  /** An oscillator with a fast attack and exponential decay, optional pitch glide and low-pass. */
  private tone(out: AudioNode, t: number, f0: number, dur: number, gain: number, type: OscillatorType, f1?: number, lp?: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  /** A burst of filtered noise (optionally sweeping the filter from f0 to f1). */
  private noise(out: AudioNode, t: number, dur: number, gain: number, type: BiquadFilterType, f0: number, f1?: number): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}

/** The one shared sound player. */
export const sound = new Sound();

/** Which placement sound a tool makes. */
export function toolSound(tool: string): SoundId {
  if (tool === 'road' || tool === 'avenue') return 'road';
  if (tool === 'powerLine') return 'power';
  if (tool === 'waterPipe') return 'pipe';
  if (tool === 'residential' || tool === 'commercial' || tool === 'industrial') return 'zone';
  if (tool === 'parkingLot' || tool === 'parkingGarage') return 'parking';
  if (tool === 'bulldoze') return 'bulldoze';
  return 'place';
}
