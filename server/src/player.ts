import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { NAME_MAX_LEN, RATE } from "@yamicuberush/shared";
import { TokenBucket } from "./rateLimit.js";

export function sanitizeName(raw: string): string | null {
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, NAME_MAX_LEN);
  if (!cleaned) return null;
  return cleaned;
}

export class Player {
  readonly id: string;
  readonly token: string;
  name: string;
  ready = false;
  connected = true;
  score = 0;
  counter = 0;
  locked = false;
  lockAt: number | null = null;
  ws: WebSocket | null;
  lastPong = Date.now();
  adjustBucket = new TokenBucket(RATE.press.rate, RATE.press.burst);
  msgBucket = new TokenBucket(RATE.message.rate, RATE.message.burst);
  joinBucket = new TokenBucket(RATE.join.rate, RATE.join.burst);
  syncCount = 0;
  counterDirty = false;
  lastAdjustSeq = 0;
  roundActive = false;
  /** Round history for sparkline: outcome per round */
  roundOutcomes: ("exact" | "closest" | "none")[] = [];
  disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string, name: string, ws: WebSocket | null) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.token = randomUUID();
  }

  toPub() {
    return {
      id: this.id,
      name: this.name,
      ready: this.ready,
      connected: this.connected,
      score: this.score,
      outcomes: [...this.roundOutcomes],
    };
  }

  resetForRound(): void {
    this.counter = 0;
    this.locked = false;
    this.lockAt = null;
    this.counterDirty = false;
    this.lastAdjustSeq = 0;
  }

  resetForMatch(): void {
    this.score = 0;
    this.ready = false;
    this.roundOutcomes = [];
    this.roundActive = false;
    this.resetForRound();
  }

  send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }
}
