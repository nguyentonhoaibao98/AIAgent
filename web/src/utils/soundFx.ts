// Procedural 8-bit retro sound effects using Web Audio API (zero external audio files)
// Inspired by pixel-agents-hq/pixel-agents

class OfficeSoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(freq: number, duration: number, type: OscillatorType = "square", gainVal = 0.04, delay = 0) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playHandoff() {
    this.tone(523.25, 0.06, "triangle", 0.035, 0);
    this.tone(659.25, 0.08, "triangle", 0.035, 0.05);
  }

  playPass() {
    this.tone(587.33, 0.08, "square", 0.03, 0);
    this.tone(880, 0.14, "square", 0.03, 0.07);
  }

  playAlert() {
    this.tone(311.13, 0.12, "sawtooth", 0.035, 0);
    this.tone(233.08, 0.18, "sawtooth", 0.035, 0.11);
  }

  playMissionComplete() {
    this.tone(523.25, 0.09, "square", 0.035, 0);
    this.tone(659.25, 0.09, "square", 0.035, 0.09);
    this.tone(783.99, 0.09, "square", 0.035, 0.18);
    this.tone(1046.5, 0.24, "square", 0.04, 0.27);
  }
}

export const soundFx = new OfficeSoundEngine();
