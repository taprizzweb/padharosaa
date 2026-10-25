import type { AlertKind } from '@/lib/staff/logic';

interface Note {
  freq: number;
  at: number;
  dur: number;
}
interface Tone {
  wave: OscillatorType;
  gain: number;
  notes: Note[];
}

/** Four clearly different tones, readable in a noisy kitchen: chime (order), triple beep (waiter), rising triad (bill), ding-dong (guest problem). */
/** The reception desk also tells urgent requests and housekeeping apart from the rest. */
export type SoundKind = AlertKind | 'urgent' | 'housekeeping';

export const TONES: Record<SoundKind, Tone> = {
  order: { wave: 'sine', gain: 0.35, notes: [{ freq: 880, at: 0, dur: 0.2 }, { freq: 660, at: 0.22, dur: 0.35 }] },
  waiter: { wave: 'square', gain: 0.18, notes: [{ freq: 1100, at: 0, dur: 0.1 }, { freq: 1100, at: 0.17, dur: 0.1 }, { freq: 1100, at: 0.34, dur: 0.1 }] },
  bill: { wave: 'triangle', gain: 0.4, notes: [{ freq: 523, at: 0, dur: 0.16 }, { freq: 659, at: 0.18, dur: 0.16 }, { freq: 784, at: 0.36, dur: 0.34 }] },
  // a guest problem: ding-dong-ding-dong, unlike the other three
  help: { wave: 'sine', gain: 0.42, notes: [{ freq: 988, at: 0, dur: 0.14 }, { freq: 740, at: 0.17, dur: 0.14 }, { freq: 988, at: 0.34, dur: 0.14 }, { freq: 740, at: 0.51, dur: 0.3 }] },
  // urgent: a fast, loud siren (high-low four times), impossible to mistake for anything else
  urgent: { wave: 'sawtooth', gain: 0.3, notes: [0, 1, 2, 3].flatMap((i) => [{ freq: 1400, at: i * 0.36, dur: 0.17 }, { freq: 800, at: i * 0.36 + 0.18, dur: 0.17 }]) },
  // housekeeping: two soft low notes, like a bell in a corridor
  housekeeping: { wave: 'triangle', gain: 0.45, notes: [{ freq: 392, at: 0, dur: 0.35 }, { freq: 494, at: 0.4, dur: 0.5 }] },
};

/** Browsers only allow sound after a tap, so `enable()` must be called from a click handler. */
export class AlertSound {
  private ctx: AudioContext | null = null;

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  async enable(): Promise<boolean> {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    this.ctx ??= new Ctor();
    try {
      await this.ctx.resume();
    } catch {
      return false;
    }
    this.play('order'); // audible confirmation that sound works
    return this.ready;
  }

  play(kind: SoundKind): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const tone = TONES[kind];
    const t0 = ctx.currentTime + 0.02;
    for (const n of tone.notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = tone.wave;
      osc.frequency.value = n.freq;
      // short attack/release so notes do not click
      g.gain.setValueAtTime(0.0001, t0 + n.at);
      g.gain.exponentialRampToValueAtTime(tone.gain, t0 + n.at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
  }
}
