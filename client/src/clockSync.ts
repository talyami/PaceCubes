import {
  CLOCK_BURST_COUNT,
  CLOCK_BURST_GAP_MS,
  CLOCK_REFRESH_MS,
} from "@pacecubs/shared";
import type { Net } from "./net.js";

interface Sample {
  offset: number;
  rtt: number;
}

/**
 * NTP-lite clock offset (BRD §8).
 * offset ≈ serverClock − clientClock
 * serverToLocal(ts) = ts − offset
 */
export class ClockSync {
  offset = 0;
  bestRtt = Number.POSITIVE_INFINITY;
  private pending = new Map<number, number>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;

  constructor(private readonly net: Net) {}

  start(): void {
    this.unsub = this.net.onMessage((msg) => {
      if (msg.t !== "timePong") return;
      const t3 = Date.now();
      const t0 = msg.t0;
      const t1 = msg.t1;
      if (!this.pending.has(t0)) return;
      this.pending.delete(t0);
      const rtt = t3 - t0;
      const sample: Sample = {
        offset: t1 - (t0 + t3) / 2,
        rtt,
      };
      this.consider(sample);
    });

    void this.burst();
    this.refreshTimer = setInterval(() => this.ping(), CLOCK_REFRESH_MS);

    document.addEventListener("visibilitychange", this.onVis);
  }

  stop(): void {
    this.unsub?.();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    document.removeEventListener("visibilitychange", this.onVis);
  }

  private onVis = (): void => {
    if (document.visibilityState === "visible") void this.burst();
  };

  serverToLocal(serverTs: number): number {
    return serverTs - this.offset;
  }

  private consider(sample: Sample): void {
    if (sample.rtt < this.bestRtt) {
      this.bestRtt = sample.rtt;
      this.offset = sample.offset;
      return;
    }
    // Refresh: only replace if RTT ≤ 1.5× best
    if (sample.rtt <= this.bestRtt * 1.5) {
      this.offset = sample.offset;
      this.bestRtt = Math.min(this.bestRtt, sample.rtt);
    }
  }

  private ping(): void {
    const t0 = Date.now();
    this.pending.set(t0, t0);
    this.net.send({ t: "timePing", t0 });
  }

  async burst(): Promise<void> {
    for (let i = 0; i < CLOCK_BURST_COUNT; i++) {
      this.ping();
      if (i < CLOCK_BURST_COUNT - 1) {
        await new Promise((r) => setTimeout(r, CLOCK_BURST_GAP_MS));
      }
    }
  }
}
