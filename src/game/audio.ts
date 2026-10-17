// Simple WebAudio synth for game sound effects (no external assets needed).
class Sfx {
  private ctx: AudioContext | null = null;
  private muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain = 0.16,
    delay = 0,
    endFreq?: number,
  ) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + duration);
    }
    vol.gain.setValueAtTime(0.0001, t0);
    vol.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private noise(duration: number, gain = 0.12) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(gain, t0);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(vol);
    vol.connect(ctx.destination);
    src.start(t0);
  }

  jump() {
    this.tone(320, 0.18, "triangle", 0.14, 0, 700);
  }
  coin() {
    this.tone(1046, 0.08, "square", 0.1);
    this.tone(1568, 0.12, "square", 0.09, 0.07);
  }
  correct() {
    this.tone(523, 0.12, "triangle", 0.14, 0);
    this.tone(659, 0.12, "triangle", 0.14, 0.09);
    this.tone(784, 0.18, "triangle", 0.15, 0.18);
    this.tone(1046, 0.22, "triangle", 0.13, 0.27);
  }
  wrong() {
    this.tone(200, 0.26, "sawtooth", 0.12, 0, 110);
    this.noise(0.18, 0.06);
  }
  smash() {
    this.noise(0.28, 0.18);
    this.tone(160, 0.22, "square", 0.1, 0, 60);
  }
  hit() {
    this.noise(0.3, 0.2);
    this.tone(120, 0.3, "sawtooth", 0.12, 0, 50);
  }
  levelUp() {
    this.tone(523, 0.1, "sine", 0.12, 0);
    this.tone(659, 0.1, "sine", 0.12, 0.1);
    this.tone(880, 0.1, "sine", 0.12, 0.2);
    this.tone(1174, 0.24, "sine", 0.13, 0.3);
  }
  gameOver() {
    this.tone(392, 0.18, "triangle", 0.13, 0);
    this.tone(330, 0.18, "triangle", 0.13, 0.16);
    this.tone(262, 0.4, "triangle", 0.14, 0.32);
  }
  rocket() {
    this.tone(180, 0.5, "sawtooth", 0.08, 0, 900);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m && this.ctx) void this.ctx.suspend();
  }
  isMuted() {
    return this.muted;
  }
}

export const sfx = new Sfx();
