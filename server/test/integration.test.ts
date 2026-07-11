import { describe, expect, it, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { createApp, type App } from "../src/app.js";
import type { S2C } from "@yamicuberush/shared";

class TestClient {
  ws!: WebSocket;
  messages: S2C[] = [];
  playerId = "";
  token = "";

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.url);
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.ws.on("message", (d) => {
      const msg = JSON.parse(String(d)) as S2C;
      if (msg.t === "ping") {
        this.send({ t: "pong" });
        return;
      }
      this.messages.push(msg);
      if (msg.t === "welcome") {
        this.playerId = msg.playerId;
        this.token = msg.playerToken;
      }
    });
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor<T extends S2C["t"]>(
    type: T,
    timeoutMs = 60_000,
  ): Promise<Extract<S2C, { t: T }>> {
    const existing = this.messages.find((m) => m.t === type);
    if (existing) {
      this.messages = this.messages.filter((m) => m !== existing);
      return existing as Extract<S2C, { t: T }>;
    }
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(() => {
        const m = this.messages.find((x) => x.t === type);
        if (m) {
          clearInterval(iv);
          this.messages = this.messages.filter((x) => x !== m);
          resolve(m as Extract<S2C, { t: T }>);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(iv);
          reject(new Error(`timeout waiting for ${type}`));
        }
      }, 20);
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe("integration: full match", () => {
  let app: App;
  let url: string;

  beforeAll(async () => {
    app = await createApp({ port: 0, host: "127.0.0.1" });
    url = `ws://127.0.0.1:${app.port}/ws`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("completes a 7-round match with identical flashData and correct scoring", async () => {
    const a = new TestClient(url);
    const b = new TestClient(url);
    await a.connect();
    await b.connect();

    a.send({ t: "createRoom", name: "Alice" });
    const welcomeA = await a.waitFor("welcome");
    const code = welcomeA.room.code;
    expect(code).toMatch(/^\d{2}$/);

    b.send({ t: "joinRoom", code, name: "Bob" });
    await b.waitFor("welcome");

    a.send({ t: "ready", ready: true });
    b.send({ t: "ready", ready: true });
    // Wait until both seats show ready
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(() => {
        const room = app.rooms.get(code);
        if (room && [...room.players.values()].every((p) => p.ready)) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - start > 5000) {
          clearInterval(iv);
          reject(new Error("players never became ready"));
        }
      }, 20);
    });

    a.send({ t: "startMatch" });
    await a.waitFor("matchStart", 10_000);
    await b.waitFor("matchStart", 10_000);

    let expectedA = 0;
    let expectedB = 0;

    for (let round = 1; round <= 7; round++) {
      const introA = await a.waitFor("roundIntro");
      const introB = await b.waitFor("roundIntro");
      expect(introA.flashAt).toBe(introB.flashAt);
      expect(introA.round).toBe(round);

      const flashA = await a.waitFor("flashData");
      const flashB = await b.waitFor("flashData");
      expect(flashA.grid).toEqual(flashB.grid);
      expect(flashA.seed).toBe(flashB.seed);

      const truth = flashA.grid.flat().reduce((s, h) => s + h, 0);

      await a.waitFor("answerOpen");
      await b.waitFor("answerOpen");

      // A guesses exact, B guesses exact+2
      for (let i = 0; i < truth; i++)
        a.send({ t: "adjust", delta: 1, seq: i + 1 });
      for (let i = 0; i < truth + 2; i++)
        b.send({ t: "adjust", delta: 1, seq: i + 1 });
      await new Promise((r) => setTimeout(r, 200)); // flush counters
      a.send({ t: "lock" });
      await new Promise((r) => setTimeout(r, 50));
      b.send({ t: "lock" });

      const revealA = await a.waitFor("reveal");
      const revealB = await b.waitFor("reveal");
      expect(revealA.truth).toBe(truth);
      expect(revealB.truth).toBe(truth);
      expect(revealA.truth).toBe(
        revealA.grid.flat().reduce((s, h) => s + h, 0),
      );

      const ra = revealA.results.find((r) => r.playerId === a.playerId)!;
      const rb = revealA.results.find((r) => r.playerId === b.playerId)!;
      expect(ra.points).toBe(3);
      expect(rb.points).toBe(0);
      expectedA += 3;
      expectedB += 0;
      expect(revealA.scores.find((s) => s.playerId === a.playerId)!.score).toBe(
        expectedA,
      );
      expect(revealA.scores.find((s) => s.playerId === b.playerId)!.score).toBe(
        expectedB,
      );

      // Drain nextRound wait — server has reveal + intermission
      // Don't wait full time if we can wait for next event
      if (round < 7) {
        // wait for next roundIntro in loop
      }
    }

    const endA = await a.waitFor("matchEnd", 120_000);
    const endB = await b.waitFor("matchEnd", 120_000);
    expect(endA.winnerIds).toEqual([a.playerId]);
    expect(endB.winnerIds).toEqual([a.playerId]);
    expect(endA.scores.find((s) => s.playerId === a.playerId)!.score).toBe(
      expectedA,
    );

    a.close();
    b.close();
  }, 180_000);

  it("reconnects mid-ANSWER with token and preserves counter", async () => {
    const a = new TestClient(url);
    const b = new TestClient(url);
    await a.connect();
    await b.connect();

    a.send({ t: "createRoom", name: "Host" });
    const w = await a.waitFor("welcome");
    b.send({ t: "joinRoom", code: w.room.code, name: "Guest" });
    await b.waitFor("welcome");
    const tokenB = b.token;
    const idB = b.playerId;

    b.send({ t: "ready", ready: true });
    await new Promise((r) => setTimeout(r, 50));
    a.send({ t: "startMatch" });

    await a.waitFor("roundIntro", 30_000);
    const flashA = await a.waitFor("flashData", 30_000);
    await a.waitFor("answerOpen", 30_000);
    await b.waitFor("answerOpen", 30_000);

    for (let i = 0; i < 5; i++)
      b.send({ t: "adjust", delta: 1, seq: i + 1 });
    await new Promise((r) => setTimeout(r, 200));

    const room = app.rooms.get(w.room.code)!;
    expect(room.players.get(idB)!.counter).toBe(5);

    b.close();
    await new Promise((r) => setTimeout(r, 100));

    const b2 = new TestClient(url);
    await b2.connect();
    b2.send({
      t: "joinRoom",
      code: w.room.code,
      name: "Guest",
      playerToken: tokenB,
    });
    const welcome2 = await b2.waitFor("welcome");
    expect(welcome2.playerId).toBe(idB);
    const sync = await b2.waitFor("phaseSync");
    expect(sync.phase).toBe("ANSWER");
    if (sync.phase === "ANSWER") {
      expect(sync.answerEndsAt).toBeGreaterThan(sync.serverNow);
      expect(
        sync.counters.find((counter) => counter.playerId === idB)?.value,
      ).toBe(5);
    }
    expect(room.players.get(idB)!.counter).toBe(5);
    expect(room.players.get(idB)!.connected).toBe(true);

    const truth = flashA.grid.flat().reduce((s, h) => s + h, 0);
    for (let i = 0; i < truth; i++)
      a.send({ t: "adjust", delta: 1, seq: i + 1 });
    a.send({ t: "lock" });
    b2.send({ t: "lock" });

    await a.waitFor("reveal", 30_000);
    a.close();
    b2.close();
  }, 120_000);

  it("validates codes, reconciles limited adjustments, and retains an offline result", async () => {
    const invalid = new TestClient(url);
    await invalid.connect();
    invalid.send({ t: "joinRoom", code: "A1", name: "Invalid" });
    const badCode = await invalid.waitFor("error");
    expect(badCode.code).toBe("BAD_ROOM_CODE");
    invalid.close();

    const host = new TestClient(url);
    const guest = new TestClient(url);
    await host.connect();
    await guest.connect();
    host.send({ t: "createRoom", name: "Host" });
    const welcome = await host.waitFor("welcome");
    expect(welcome.room.code).toMatch(/^\d{2}$/);
    guest.send({ t: "joinRoom", code: welcome.room.code, name: "Guest" });
    await guest.waitFor("welcome");

    guest.send({ t: "ready", ready: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    host.send({ t: "startMatch" });
    await host.waitFor("answerOpen", 30_000);
    await guest.waitFor("answerOpen", 30_000);

    guest.send({ t: "endMatch" });
    const denied = await guest.waitFor("error");
    expect(denied.code).toBe("NOT_HOST");

    guest.send({ t: "adjust", delta: -1, seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const room = app.rooms.get(welcome.room.code)!;
    expect(room.players.get(guest.playerId)!.counter).toBe(0);

    for (let seq = 1; seq <= 50; seq++) {
      host.send({ t: "adjust", delta: 1, seq });
    }
    for (let seq = 2; seq <= 6; seq++) {
      guest.send({ t: "adjust", delta: 1, seq });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    const authoritativeHost = room.players.get(host.playerId)!.counter;
    expect(authoritativeHost).toBeGreaterThan(0);
    expect(authoritativeHost).toBeLessThan(50);
    expect(room.players.get(host.playerId)!.lastAdjustSeq).toBe(50);
    expect(room.players.get(guest.playerId)!.counter).toBe(5);

    const guestId = guest.playerId;
    guest.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    room.dropSeat(guestId);
    expect(room.players.has(guestId)).toBe(false);

    host.send({ t: "endMatch" });
    const final = await host.waitFor("matchEnd", 10_000);
    expect(final.scores.find((score) => score.playerId === host.playerId)?.score)
      .toBe(0);
    expect(final.scores.find((score) => score.playerId === guestId)).toMatchObject({
      connected: false,
      score: 0,
    });

    host.close();
  }, 120_000);
});
