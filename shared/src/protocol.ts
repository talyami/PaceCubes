/** Pace Cubs shared protocol — single source of truth for client & server. */

export type Grid = number[][]; // 5×5, values 0–3 (stack height per cell)

export type RoomState =
  | "LOBBY"
  | "STARTING"
  | "COUNTDOWN"
  | "FLASH"
  | "ANSWER"
  | "REVEAL"
  | "INTERMISSION"
  | "FINAL";

export type Lang = "en" | "zh-CN";

export type ErrCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_IN_MATCH"
  | "BAD_NAME"
  | "NOT_HOST"
  | "BAD_PHASE"
  | "RATE_LIMITED"
  | "BAD_MESSAGE"
  | "SEAT_TAKEN"
  | "SERVER_FULL"
  | "SERVER_RESTART";

export interface PlayerPub {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  score: number;
}

export interface RoomSnapshot {
  code: string;
  state: RoomState;
  players: PlayerPub[];
  hostId: string;
  round: number;
  rounds: number;
  hideOpponentCount: boolean;
  lang: Lang;
}

export interface RoundResult {
  playerId: string;
  value: number;
  lockAt: number | null;
  error: number;
  points: 0 | 1 | 3;
  outcome: "exact" | "closest" | "none";
}

export type C2S =
  | { t: "createRoom"; name: string; lang?: Lang }
  | { t: "joinRoom"; code: string; name: string; playerToken?: string }
  | { t: "ready"; ready: boolean }
  | { t: "startMatch" }
  | { t: "press" }
  | { t: "lock" }
  | { t: "timePing"; t0: number }
  | { t: "pong" }
  | { t: "rematch" }
  | { t: "leave" }
  | { t: "sync"; skew: number; rtt: number; offset: number };

export type S2C =
  | {
      t: "welcome";
      playerId: string;
      playerToken: string;
      room: RoomSnapshot;
      serverNow: number;
    }
  | { t: "roomUpdate"; room: RoomSnapshot }
  | { t: "matchStart"; rounds: number; introAt: number }
  | {
      t: "roundIntro";
      round: number;
      countdownAt: number;
      flashAt: number;
      holdMs: number;
    }
  | { t: "flashData"; round: number; grid: Grid; seed: number }
  | { t: "counter"; playerId: string; value: number }
  | { t: "locked"; playerId: string }
  | {
      t: "reveal";
      round: number;
      grid: Grid;
      truth: number;
      order: [number, number, number][];
      results: RoundResult[];
      scores: { playerId: string; score: number }[];
      nextRoundAt?: number;
    }
  | {
      t: "matchEnd";
      scores: { playerId: string; score: number }[];
      winnerIds: string[];
      endAt: number;
    }
  | { t: "timePong"; t0: number; t1: number }
  | { t: "ping" }
  | { t: "error"; code: ErrCode; msg: string };
