import { randomInt } from "node:crypto";
import type { WebSocket } from "ws";
import {
  EMPTY_ROOM_TTL_MS,
  IDLE_LOBBY_TTL_MS,
} from "@yamicuberush/shared";
import { Analytics } from "./analytics.js";
import { log } from "./log.js";
import { Room } from "./room.js";
import { SlidingWindow } from "./rateLimit.js";
import { RATE } from "@yamicuberush/shared";

function genCode(existing: Set<string>): string {
  const start = randomInt(100);
  for (let offset = 0; offset < 100; offset++) {
    const code = String((start + offset) % 100).padStart(2, "0");
    if (!existing.has(code)) return code;
  }
  throw new Error("failed to allocate room code");
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly ipCreates = new Map<string, SlidingWindow>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly analytics: Analytics,
    private readonly maxRooms: number,
  ) {
    this.gcTimer = setInterval(() => this.gc(), 10_000);
  }

  create(ip: string): Room | { error: string } {
    const win =
      this.ipCreates.get(ip) ??
      new SlidingWindow(RATE.roomCreatePerIp.windowMs, RATE.roomCreatePerIp.max);
    this.ipCreates.set(ip, win);
    if (!win.tryTake()) return { error: "RATE_LIMITED" };
    if (this.rooms.size >= Math.min(this.maxRooms, 100))
      return { error: "SERVER_FULL" };

    const code = genCode(new Set(this.rooms.keys()));
    const room = new Room(code, this.analytics, {
      onEmpty: (c) => this.scheduleDestroy(c),
    });
    this.rooms.set(code, room);
    this.analytics.track("room_created", { players: 0 }, code);
    log.info("room_created", { room: code });
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  findBySocket(ws: WebSocket): { room: Room } | undefined {
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) {
        if (p.ws === ws) return { room };
      }
    }
    return undefined;
  }

  findPlayerBySocket(ws: WebSocket) {
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) {
        if (p.ws === ws) return { room, player: p };
      }
    }
    return undefined;
  }

  private pendingDestroy = new Map<string, ReturnType<typeof setTimeout>>();

  scheduleDestroy(code: string): void {
    if (this.pendingDestroy.has(code)) return;
    const t = setTimeout(() => {
      this.pendingDestroy.delete(code);
      const room = this.rooms.get(code);
      if (!room) return;
      if (room.players.size === 0) this.destroy(code);
    }, EMPTY_ROOM_TTL_MS);
    this.pendingDestroy.set(code, t);
  }

  destroy(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.destroy();
    this.rooms.delete(code);
    this.analytics.track(
      "room_destroyed",
      { players: room.players.size },
      code,
    );
    log.info("room_destroyed", { room: code });
  }

  private gc(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.players.size === 0) {
        this.scheduleDestroy(code);
        continue;
      }
      if (
        room.state === "LOBBY" &&
        now - room.lastActivity > IDLE_LOBBY_TTL_MS
      ) {
        for (const p of room.players.values()) {
          try {
            p.ws?.close(4001, "idle");
          } catch {
            /* ignore */
          }
        }
        this.destroy(code);
      }
    }
  }

  stop(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    for (const t of this.pendingDestroy.values()) clearTimeout(t);
    for (const code of [...this.rooms.keys()]) this.destroy(code);
  }

  socketCount(): number {
    let n = 0;
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) {
        if (p.ws && p.ws.readyState === p.ws.OPEN) n++;
      }
    }
    return n;
  }
}
