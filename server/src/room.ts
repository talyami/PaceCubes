import { randomInt } from "node:crypto";
import type { WebSocket } from "ws";
import {
  ANSWER_TIMEOUT_MS,
  COUNTDOWN_MS,
  COUNTER_FLUSH_MS,
  FLASH_DATA_LEAD_MS,
  INTERMISSION_MS,
  MATCH_INTRO_MS,
  MATCH_ROUNDS,
  MAX_COUNTER,
  MAX_PLAYERS,
  MAX_SUDDEN_DEATH,
  ROUND_HOLD_INCREMENT_MS,
  REVEAL_CUBE_MS,
  REVEAL_HOLD_MS,
  SEAT_DISCONNECT_TTL_MS,
  SLIDE_IN_MS,
  VANISH_MS,
  difficultyForRound,
  generateGrid,
  matchWinner,
  needsSuddenDeath,
  pickTargetCubes,
  revealOrder,
  scoreRound,
  sumGrid,
  type C2S,
  type Grid,
  type GameLevel,
  type RevealState,
  type RoomSnapshot,
  type RoomState,
  type ScoreTotal,
  type S2C,
} from "@yamicuberush/shared";
import { Analytics } from "./analytics.js";
import { log } from "./log.js";
import { Player, sanitizeName } from "./player.js";

export type RoomCallbacks = {
  onEmpty: (code: string) => void;
};

export class Room {
  readonly code: string;
  state: RoomState = "LOBBY";
  players = new Map<string, Player>();
  hostId = "";
  round = 0;
  rounds = MATCH_ROUNDS;
  hideOpponentCount = true;
  readonly level: GameLevel;
  createdAt = Date.now();
  lastActivity = Date.now();

  private grid: Grid | null = null;
  private seed = 0;
  private truth = 0;
  private holdMs = 1500;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private counterFlush: ReturnType<typeof setInterval> | null = null;
  private suddenDeathRound = 0;
  private suddenDeathIds: string[] | null = null;
  private matchStartedAt = 0;
  private destroyed = false;
  /** Stable match records; entries survive live seat expiry. */
  private matchPlayers = new Map<string, Player>();
  private roundAt = 0;
  private countdownAt = 0;
  private flashAt = 0;
  private answerAt = 0;
  private answerEndsAt = 0;
  private revealEndsAt = 0;
  private nextRoundAt = 0;
  private flashDataSent = false;
  private lastReveal: RevealState | null = null;
  private finalScores: ScoreTotal[] = [];
  private finalWinnerIds: string[] = [];
  private finalEndAt = 0;

  constructor(
    code: string,
    level: GameLevel,
    private readonly analytics: Analytics,
    private readonly cbs: RoomCallbacks,
  ) {
    this.code = code;
    this.level = level;
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  snapshot(): RoomSnapshot {
    const source =
      this.state === "LOBBY" ? this.players : this.matchPlayers;
    return {
      code: this.code,
      state: this.state,
      players: [...source.values()].map((p) => p.toPub()),
      hostId: this.hostId,
      round: this.round,
      rounds: this.rounds,
      hideOpponentCount: this.hideOpponentCount,
      level: this.level,
    };
  }

  broadcast(msg: S2C): void {
    const raw = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === p.ws.OPEN) p.ws.send(raw);
    }
  }

  sendTo(player: Player, msg: S2C): void {
    player.send(msg);
  }

  addPlayer(name: string, ws: WebSocket, token?: string): Player | { error: S2C } {
    this.touch();

    // Rejoin by token
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) {
        // A backgrounded phone can leave a zombie OPEN socket behind. A valid,
        // unguessable player token owns the seat, so the newest connection wins.
        if (existing.ws && existing.ws !== ws) {
          const staleSocket = existing.ws;
          existing.ws = null;
          try {
            staleSocket.close(4001, "session resumed");
          } catch {
            /* stale transport is already gone */
          }
        }
        if (existing.disconnectTimer) {
          clearTimeout(existing.disconnectTimer);
          existing.disconnectTimer = null;
        }
        existing.ws = ws;
        existing.connected = true;
        const matchRecord = this.matchPlayers.get(existing.id);
        if (matchRecord) matchRecord.connected = true;
        existing.lastPong = Date.now();
        if (name) {
          const n = sanitizeName(name);
          if (n) existing.name = n;
        }
        this.analytics.track("player_rejoined", { phase: this.state }, this.code);
        return existing;
      }
      const expired = [...this.matchPlayers.values()].some(
        (p) => p.token === token,
      );
      if (expired) {
        return {
          error: {
            t: "error",
            code: "SEAT_EXPIRED",
            msg: "Your seat expired",
          },
        };
      }
    }

    if (this.state !== "LOBBY") {
      return {
        error: {
          t: "error",
          code: "ROOM_IN_MATCH",
          msg: "Match already in progress",
        },
      };
    }
    if (this.players.size >= MAX_PLAYERS) {
      return {
        error: { t: "error", code: "ROOM_FULL", msg: "Room is full" },
      };
    }

    const n = sanitizeName(name);
    if (!n) {
      return {
        error: { t: "error", code: "BAD_NAME", msg: "Invalid nickname" },
      };
    }

    const id = `p${this.players.size + 1}`;
    // Ensure unique id if seats were dropped
    let seatId = id;
    let i = this.players.size + 1;
    while (this.players.has(seatId)) {
      i++;
      seatId = `p${i}`;
    }

    const player = new Player(seatId, n, ws);
    this.players.set(seatId, player);
    if (!this.hostId) this.hostId = seatId;
    return player;
  }

  removeSocket(ws: WebSocket): void {
    for (const p of this.players.values()) {
      if (p.ws === ws) {
        this.markDisconnected(p);
        return;
      }
    }
  }

  markDisconnected(player: Player): void {
    player.connected = false;
    player.ws = null;
    if (this.state === "ANSWER" && !player.locked) {
      player.locked = true;
      player.lockAt = null;
      player.counterDirty = false;
      this.broadcast({
        t: "counter",
        playerId: player.id,
        value: player.counter,
        ackSeq: player.lastAdjustSeq,
      });
      this.broadcast({ t: "locked", playerId: player.id });
    }
    this.broadcast({ t: "roomUpdate", room: this.snapshot() });
    this.analytics.track(
      "player_disconnected",
      { phase: this.state },
      this.code,
    );

    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = setTimeout(() => {
      this.dropSeat(player.id);
    }, SEAT_DISCONNECT_TTL_MS);

    // Host migration if host left
    if (player.id === this.hostId) {
      const next = [...this.players.values()]
        .filter((p) => p.id !== player.id && p.connected)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (next) {
        this.hostId = next.id;
        this.broadcast({ t: "roomUpdate", room: this.snapshot() });
      }
    }

    if ([...this.players.values()].every((p) => !p.connected)) {
      // all disconnected — empty room TTL handled by manager
    }

    if (this.state === "ANSWER" && this.allRelevantLocked()) {
      this.finishAnswer();
    }
  }

  dropSeat(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || p.connected) return;
    p.disconnectTimer = null;
    this.players.delete(playerId);
    if (this.hostId === playerId) {
      const next = [...this.players.values()][0];
      this.hostId = next?.id ?? "";
    }
    this.broadcast({ t: "roomUpdate", room: this.snapshot() });
    if (this.players.size === 0) this.cbs.onEmpty(this.code);
  }

  handle(player: Player, msg: C2S): void {
    this.touch();
    switch (msg.t) {
      case "ready":
        if (this.state !== "LOBBY") return;
        player.ready = !!msg.ready;
        this.broadcast({ t: "roomUpdate", room: this.snapshot() });
        break;
      case "startMatch":
        this.startMatch(player);
        break;
      case "adjust":
        this.onAdjust(player, msg.delta, msg.seq);
        break;
      case "lock":
        this.onLock(player);
        break;
      case "endMatch":
        this.onEndMatch(player);
        break;
      case "rematch":
        this.onRematch(player);
        break;
      case "leave":
        this.markDisconnected(player);
        this.dropSeat(player.id);
        break;
      case "sync":
        if (player.syncCount >= 3) return;
        player.syncCount++;
        this.analytics.track(
          "client_sync_sample",
          { skew: msg.skew, rtt: msg.rtt, offset: msg.offset },
          this.code,
        );
        break;
      default:
        break;
    }
  }

  private startMatch(host: Player): void {
    if (this.state !== "LOBBY") return;
    if (host.id !== this.hostId) {
      this.sendTo(host, {
        t: "error",
        code: "NOT_HOST",
        msg: "Only host can start",
      });
      return;
    }
    // Solo practice allowed; if others present, require at least one other ready
    const others = [...this.players.values()].filter((p) => p.id !== host.id);
    if (others.length > 0 && !others.some((p) => p.ready && p.connected)) {
      this.sendTo(host, {
        t: "error",
        code: "BAD_PHASE",
        msg: "Wait for at least one ready player",
      });
      return;
    }

    this.matchPlayers = new Map(this.players);
    for (const p of this.matchPlayers.values()) p.resetForMatch();
    this.round = 0;
    this.rounds = MATCH_ROUNDS;
    this.suddenDeathRound = 0;
    this.suddenDeathIds = null;
    this.matchStartedAt = Date.now();
    this.state = "STARTING";

    this.roundAt = Date.now() + MATCH_INTRO_MS;
    this.broadcast({ t: "matchStart", rounds: this.rounds, roundAt: this.roundAt });
    this.analytics.track(
      "match_started",
      { players: this.players.size, rounds: this.rounds },
      this.code,
    );

    this.setPhase("STARTING", this.roundAt, () => this.beginRound(1));
  }

  private beginRound(round: number): void {
    if (this.destroyed) return;
    this.round = round;
    const diff = difficultyForRound(Math.min(round, 7), this.level);
    this.seed = randomInt(1, 0x7fffffff);
    const target = pickTargetCubes(this.seed, diff.minCubes, diff.maxCubes);
    this.grid = generateGrid(this.seed, target, diff.maxHeight);
    this.truth = sumGrid(this.grid);
    // Give players two additional seconds after every completed round.
    this.holdMs = diff.holdMs + Math.max(0, round - 1) * ROUND_HOLD_INCREMENT_MS;

    for (const p of this.matchPlayers.values()) {
      const eligible =
        !this.suddenDeathIds || this.suddenDeathIds.includes(p.id);
      p.roundActive = eligible && p.connected;
      if (p.roundActive) p.resetForRound();
    }

    const now = Date.now();
    this.countdownAt = now + 50;
    this.flashAt = this.countdownAt + COUNTDOWN_MS;
    this.answerAt = this.flashAt + SLIDE_IN_MS + this.holdMs + VANISH_MS;
    this.flashDataSent = false;
    this.lastReveal = null;

    this.state = "COUNTDOWN";
    this.broadcast({
      t: "roundIntro",
      round,
      countdownAt: this.countdownAt,
      flashAt: this.flashAt,
      holdMs: this.holdMs,
    });

    // Send flashData at flashAt − 300ms
    const dataAt = this.flashAt - FLASH_DATA_LEAD_MS;
    this.setPhase("COUNTDOWN", dataAt, () => {
      if (!this.grid) return;
      this.flashDataSent = true;
      this.broadcast({
        t: "flashData",
        round,
        grid: this.grid,
        seed: this.seed,
        level: this.level,
      });
      this.setPhase("COUNTDOWN", this.flashAt, () => {
        this.state = "FLASH";
        this.setPhase("FLASH", this.answerAt, () => this.enterAnswer());
      });
    });
  }

  private enterAnswer(): void {
    this.state = "ANSWER";
    this.startCounterFlush();
    this.answerEndsAt = Date.now() + ANSWER_TIMEOUT_MS;
    for (const p of this.relevantPlayers()) {
      if (!p.connected) {
        p.locked = true;
        p.lockAt = null;
      }
    }
    this.broadcast({
      t: "answerOpen",
      round: this.round,
      answerEndsAt: this.answerEndsAt,
    });
    this.setPhase("ANSWER", this.answerEndsAt, () => this.finishAnswer());
    if (this.allRelevantLocked()) this.finishAnswer();
  }

  private startCounterFlush(): void {
    this.stopCounterFlush();
    this.counterFlush = setInterval(() => {
      for (const p of this.matchPlayers.values()) {
        if (!p.counterDirty) continue;
        p.counterDirty = false;
        const msg: S2C = {
          t: "counter",
          playerId: p.id,
          value: p.counter,
          ackSeq: p.lastAdjustSeq,
        };
        if (this.hideOpponentCount) {
          this.sendTo(p, msg);
        } else {
          this.broadcast(msg);
        }
      }
    }, COUNTER_FLUSH_MS);
  }

  private stopCounterFlush(): void {
    if (this.counterFlush) {
      clearInterval(this.counterFlush);
      this.counterFlush = null;
    }
  }

  private onAdjust(player: Player, delta: -1 | 1, seq: number): void {
    if (this.state !== "ANSWER") {
      this.sendTo(player, {
        t: "error",
        code: "BAD_PHASE",
        msg: "Counter is closed",
      });
      return;
    }
    if (delta !== -1 && delta !== 1) {
      this.sendTo(player, {
        t: "error",
        code: "BAD_MESSAGE",
        msg: "Invalid counter adjustment",
      });
      return;
    }
    if (!Number.isSafeInteger(seq) || seq <= player.lastAdjustSeq) return;
    player.lastAdjustSeq = seq;
    player.counterDirty = true;
    if (player.locked) return;
    if (this.suddenDeathIds && !this.suddenDeathIds.includes(player.id)) return;
    if (!player.adjustBucket.tryTake()) return;
    player.counter = Math.max(0, Math.min(MAX_COUNTER, player.counter + delta));
  }

  private onLock(player: Player): void {
    if (this.state !== "ANSWER") return;
    if (player.locked) return;
    if (this.suddenDeathIds && !this.suddenDeathIds.includes(player.id)) return;
    player.locked = true;
    player.lockAt = Date.now();
    player.counterDirty = false;
    this.broadcast({
      t: "counter",
      playerId: player.id,
      value: player.counter,
      ackSeq: player.lastAdjustSeq,
    });
    this.broadcast({ t: "locked", playerId: player.id });

    if (this.allRelevantLocked()) {
      this.finishAnswer();
    }
  }

  private relevantPlayers(): Player[] {
    const all = [...this.matchPlayers.values()].filter((p) => p.roundActive);
    if (this.suddenDeathIds) {
      return all.filter((p) => this.suddenDeathIds!.includes(p.id));
    }
    return all;
  }

  private allRelevantLocked(): boolean {
    return this.relevantPlayers().every((p) => p.locked || !p.connected);
  }

  private onEndMatch(player: Player): void {
    if (player.id !== this.hostId) {
      this.sendTo(player, {
        t: "error",
        code: "NOT_HOST",
        msg: "Only the host can end the game",
      });
      return;
    }
    if (this.state === "LOBBY" || this.state === "FINAL") {
      this.sendTo(player, {
        t: "error",
        code: "BAD_PHASE",
        msg: "There is no active game to end",
      });
      return;
    }
    const scores = [...this.matchPlayers.values()].map((p) => ({
      playerId: p.id,
      score: p.score,
      connected: p.connected,
    }));
    this.endMatch(matchWinner(scores));
  }

  private finishAnswer(): void {
    if (this.state !== "ANSWER") return;
    this.clearPhaseTimer();
    this.stopCounterFlush();

    for (const p of this.relevantPlayers()) {
      if (!p.locked) {
        p.locked = true;
        p.lockAt = null;
        this.broadcast({
          t: "counter",
          playerId: p.id,
          value: p.counter,
          ackSeq: p.lastAdjustSeq,
        });
        this.broadcast({ t: "locked", playerId: p.id });
      }
    }

    this.enterReveal();
  }

  private enterReveal(): void {
    if (!this.grid) return;
    this.state = "REVEAL";
    const results = scoreRound(
      this.truth,
      this.relevantPlayers().map((p) => ({
        playerId: p.id,
        value: p.counter,
        lockAt: p.lockAt,
        connected: p.connected,
      })),
    );

    for (const r of results) {
      const p = this.matchPlayers.get(r.playerId);
      if (!p) continue;
      p.score += r.points;
      p.roundOutcomes.push(r.outcome);
    }

    const order = revealOrder(this.grid);
    const revealDuration = order.length * REVEAL_CUBE_MS + REVEAL_HOLD_MS;
    const scores = [...this.matchPlayers.values()].map((p) => ({
      playerId: p.id,
      score: p.score,
      connected: p.connected,
    }));

    const isLastNormal = this.round >= this.rounds && !this.suddenDeathIds;
    this.revealEndsAt = Date.now() + revealDuration;
    this.nextRoundAt = this.revealEndsAt + INTERMISSION_MS;
    this.lastReveal = {
      round: this.round,
      grid: this.grid,
      truth: this.truth,
      seed: this.seed,
      order,
      results,
      scores,
      nextRoundAt: isLastNormal ? undefined : this.nextRoundAt,
    };

    this.broadcast({
      t: "reveal",
      ...this.lastReveal,
    });

    this.analytics.track(
      "round_result",
      {
        round: this.round,
        truth: this.truth,
        results: results.map((r) => ({
          value: r.value,
          error: r.error,
          points: r.points,
        })),
      },
      this.code,
    );

    this.setPhase("REVEAL", this.revealEndsAt, () => {
      this.state = "INTERMISSION";
      this.setPhase("INTERMISSION", this.nextRoundAt, () => this.afterIntermission());
    });
  }

  private afterIntermission(): void {
    if (this.suddenDeathIds) {
      // Continue sudden death or end
      const tied = matchWinner(
        this.suddenDeathIds.map((id) => {
          const p = this.matchPlayers.get(id)!;
          return { playerId: id, score: p.score };
        }),
      );
      if (tied.length === 1 || this.suddenDeathRound >= MAX_SUDDEN_DEATH) {
        this.endMatch(tied.length === 1 ? tied : this.suddenDeathIds);
        return;
      }
      this.suddenDeathRound++;
      this.beginRound(7 + this.suddenDeathRound);
      return;
    }

    if (this.round >= this.rounds) {
      const scores = [...this.matchPlayers.values()].map((p) => ({
        playerId: p.id,
        score: p.score,
        connected: p.connected,
      }));
      if (needsSuddenDeath(scores)) {
        this.suddenDeathIds = matchWinner(scores);
        this.suddenDeathRound = 1;
        this.beginRound(8);
        return;
      }
      this.endMatch(matchWinner(scores));
      return;
    }

    this.beginRound(this.round + 1);
  }

  private endMatch(winnerIds: string[]): void {
    this.state = "FINAL";
    this.clearPhaseTimer();
    this.stopCounterFlush();
    const scores = [...this.matchPlayers.values()].map((p) => ({
      playerId: p.id,
      score: p.score,
      connected: p.connected,
    }));
    const endAt = Date.now() + 100;
    this.finalScores = scores;
    this.finalWinnerIds = winnerIds;
    this.finalEndAt = endAt;
    this.broadcast({ t: "matchEnd", scores, winnerIds, endAt });
    this.analytics.track(
      "match_end",
      {
        scores,
        durationMs: Date.now() - this.matchStartedAt,
      },
      this.code,
    );
  }

  private onRematch(host: Player): void {
    if (this.state !== "FINAL") return;
    if (host.id !== this.hostId) {
      this.sendTo(host, {
        t: "error",
        code: "NOT_HOST",
        msg: "Only host can rematch",
      });
      return;
    }
    this.state = "LOBBY";
    for (const p of this.players.values()) {
      p.resetForMatch();
      p.ready = false;
    }
    this.round = 0;
    this.suddenDeathIds = null;
    this.broadcast({ t: "roomUpdate", room: this.snapshot() });
    // Auto-start rematch
    this.startMatch(host);
  }

  /** Schedule a single absolute-time transition. */
  setPhase(
    _phase: RoomState,
    at: number,
    fn: () => void,
  ): void {
    this.clearPhaseTimer();
    const delay = Math.max(0, at - Date.now());
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      fn();
    }, delay);
  }

  clearPhaseTimer(): void {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clearPhaseTimer();
    this.stopCounterFlush();
    for (const p of this.players.values()) {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
  }

  /** Resync a rejoining player with current phase state. */
  resyncPlayer(player: Player): void {
    this.sendTo(player, {
      t: "welcome",
      playerId: player.id,
      playerToken: player.token,
      room: this.snapshot(),
      serverNow: Date.now(),
    });
    const serverNow = Date.now();
    switch (this.state) {
      case "LOBBY":
        this.sendTo(player, { t: "phaseSync", phase: "LOBBY", serverNow });
        break;
      case "STARTING":
        this.sendTo(player, {
          t: "phaseSync",
          phase: "STARTING",
          serverNow,
          rounds: this.rounds,
          roundAt: this.roundAt,
        });
        break;
      case "COUNTDOWN":
        this.sendTo(player, {
          t: "phaseSync",
          phase: "COUNTDOWN",
          serverNow,
          round: this.round,
          countdownAt: this.countdownAt,
          flashAt: this.flashAt,
          holdMs: this.holdMs,
          flash:
            this.flashDataSent && this.grid
              ? { grid: this.grid, seed: this.seed }
              : undefined,
        });
        break;
      case "FLASH":
        if (this.grid) {
          this.sendTo(player, {
            t: "phaseSync",
            phase: "FLASH",
            serverNow,
            round: this.round,
            flashAt: this.flashAt,
            answerAt: this.answerAt,
            holdMs: this.holdMs,
            grid: this.grid,
            seed: this.seed,
          });
        }
        break;
      case "ANSWER":
        this.sendTo(player, {
          t: "phaseSync",
          phase: "ANSWER",
          serverNow,
          round: this.round,
          answerEndsAt: this.answerEndsAt,
          counters: [...this.matchPlayers.values()].map((p) => ({
            playerId: p.id,
            value: p.counter,
            locked: p.locked,
            ackSeq: p.lastAdjustSeq,
          })),
        });
        break;
      case "REVEAL":
        if (this.lastReveal) {
          this.sendTo(player, {
            t: "phaseSync",
            phase: "REVEAL",
            serverNow,
            reveal: this.lastReveal,
            revealEndsAt: this.revealEndsAt,
          });
        }
        break;
      case "INTERMISSION":
        if (this.lastReveal) {
          this.sendTo(player, {
            t: "phaseSync",
            phase: "INTERMISSION",
            serverNow,
            reveal: this.lastReveal,
            nextRoundAt: this.nextRoundAt,
          });
        }
        break;
      case "FINAL":
        this.sendTo(player, {
          t: "phaseSync",
          phase: "FINAL",
          serverNow,
          scores: this.finalScores,
          winnerIds: this.finalWinnerIds,
          endAt: this.finalEndAt,
        });
        break;
    }
    this.broadcast({ t: "roomUpdate", room: this.snapshot() });
  }
}
