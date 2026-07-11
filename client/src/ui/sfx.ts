/** Tiny WebAudio synth blips — no asset files (OPEN-2). */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

const MUTE_KEY = "yamicuberush.mute";

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

function blip(
  freq: number,
  durMs: number,
  type: OscillatorType = "square",
  volume = 0.55,
): void {
  const c = ensure();
  if (!c || !master) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = volume;
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
    const notes: Array<
      [delay: number, frequency: number, duration: number, type: OscillatorType, volume: number]
    > = [
      [0, 196, 260, "triangle", 0.5],
      [0, 523, 140, "square", 0.38],
      [130, 659, 140, "square", 0.38],
      [260, 784, 180, "square", 0.42],
      [430, 1047, 300, "sawtooth", 0.34],
      [650, 262, 380, "triangle", 0.48],
      [650, 523, 380, "sine", 0.32],
      [650, 659, 380, "sine", 0.3],
      [650, 784, 380, "sine", 0.28],
      [1080, 392, 180, "square", 0.34],
      [1220, 523, 180, "square", 0.36],
      [1360, 659, 180, "square", 0.38],
      [1500, 784, 420, "sawtooth", 0.36],
      [1500, 1047, 420, "sine", 0.28],
    ];
    for (const [delay, frequency, duration, type, volume] of notes) {
      setTimeout(() => blip(frequency, duration, type, volume), delay);
    }
  },
};
