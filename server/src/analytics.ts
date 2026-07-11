import { log } from "./log.js";

export interface AnalyticsEvent {
  event: string;
  ts: number;
  room?: string;
  data?: object;
}

/**
 * Batched fire-and-forget POSTs to n8n webhook.
 * Disabled cleanly when ANALYTICS_WEBHOOK_URL is unset.
 */
export class Analytics {
  private queue: AnalyticsEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWarn = 0;
  private readonly url: string | undefined;
  private readonly flushMs = 10_000;
  private readonly batchSize = 20;

  constructor(url?: string) {
    this.url = url || process.env.ANALYTICS_WEBHOOK_URL || undefined;
    if (this.url) {
      this.timer = setInterval(() => void this.flush(), this.flushMs);
    }
  }

  track(event: string, data?: object, room?: string): void {
    if (!this.url) return;
    this.queue.push({ event, ts: Date.now(), room, data });
    if (this.queue.length >= this.batchSize) void this.flush();
  }

  async flush(): Promise<void> {
    if (!this.url || this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
    } catch {
      const now = Date.now();
      if (now - this.lastWarn > 60_000) {
        this.lastWarn = now;
        log.warn("analytics flush failed", { count: batch.length });
      }
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    void this.flush();
  }
}
