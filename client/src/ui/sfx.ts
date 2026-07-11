/** Tiny WebAudio synth blips — no asset files (OPEN-2). */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

const MUTE_KEY = "pacecubs.mute";

export function loadMute(): boolean {
  try {
    muted = localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    /* ignore */
  }
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isMuted(): boolean {
  return muted;
}

function ensure(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.15;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function blip(freq: number, durMs: number, type: OscillatorType = "square"): void {
  const c = ensure();
  if (!c || !master) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = 0.8;
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + durMs / 1000);
  osc.connect(g);
  g.connect(master);
  osc.start();
  osc.stop(c.currentTime + durMs / 1000 + 0.02);
}

export const sfx = {
  unlock: () => ensure(),
  countdown: () => blip(660, 60),
  press: () => blip(880, 25),
  lock: () => blip(220, 120, "triangle"),
  reveal: () => blip(990, 20),
  win: () => {
    blip(523, 80);
    setTimeout(() => blip(659, 80), 90);
    setTimeout(() => blip(784, 120), 180);
  },
};
