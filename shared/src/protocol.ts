/** YAMI CUBE RUSH shared protocol — single source of truth for client & server. */

export type Grid = number[][]; // 5×5; level 2: stack height 0–3; level 1: 0 or 1 tile

/** 1 = flat anime portrait tiles; 2 = classic stacked cubes */
export type GameLevel = 1 | 2;

export type RoomState =
  | "LOBBY"
  | "STARTING"
  | "COUNTDOWN"
  | "FLASH"
  | "ANSWER"
  | "REVEAL"
  | "INTERMISSION"
  | "FINAL";

export type ErrCode =
  | "ROOM_NOT_FOUND"
  | "BAD_ROOM_CODE"
  | "ROOM_FULL"
  | "ROOM_IN_MATCH"
  | "SEAT_EXPIRED"
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
  outcomes: ("exact" | "closest" | "none")[];
}

export interface RoomSnapshot {
  code: string;
  state: RoomState;
  players: PlayerPub[];
  hostId: string;
  round: number;
  rounds: number;
  hideOpponentCount: boolean;
  level: GameLevel;
}

export interface RoundResult {
  playerId: string;
  value: number;
  lockAt: number | null;
  error: number;
  points: 0 | 1 | 3;
  outcome: "exact" | "closest" | "none";
  connected: boolean;
}

export interface ScoreTotal {
  playerId: string;
  score: number;
  connected: boolean;
}

export interface CounterState {
  playerId: string;
  value: number;
  locked: boolean;
  ackSeq: number;
}

export interface RevealState {
  round: number;
  grid: Grid;
  truth: number;
  seed: number;
  order: [number, number, number][];
  results: RoundResult[];
  scores: ScoreTotal[];
  nextRoundAt?: number;
}

export type C2S =
  | { t: "createRoom"; name: string; level: GameLevel }
  | { t: "joinRoom"; code: string; name: string; playerToken?: string }
  | { t: "ready"; ready: boolean }
  | { t: "startMatch" }
  | { t: "adjust"; delta: -1 | 1; seq: number }
  | { t: "lock" }
  | { t: "endMatch" }
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
  | { t: "matchStart"; rounds: number; roundAt: number }
  | {
      t: "roundIntro";
      round: number;
      countdownAt: number;
      flashAt: number;
      holdMs: number;
    }
  | { t: "flashData"; round: number; grid: Grid; seed: number; level: GameLevel }
  | { t: "answerOpen"; round: number; answerEndsAt: number }
  | { t: "counter"; playerId: string; value: number; ackSeq: number }
  | { t: "locked"; playerId: string }
  | ({ t: "reveal" } & RevealState)
  | {
      t: "matchEnd";
      scores: ScoreTotal[];
      winnerIds: string[];
      endAt: number;
    }
  | PhaseSync
  | { t: "timePong"; t0: number; t1: number }
  | { t: "ping" }
  | { t: "error"; code: ErrCode; msg: string };

export type PhaseSync =
  | { t: "phaseSync"; phase: "LOBBY"; serverNow: number }
  | {
      t: "phaseSync";
      phase: "STARTING";
      serverNow: number;
      rounds: number;
      roundAt: number;
    }
  | {
      t: "phaseSync";
      phase: "COUNTDOWN";
      serverNow: number;
      round: number;
      countdownAt: number;
      flashAt: number;
      holdMs: number;
      flash?: { grid: Grid; seed: number };
    }
  | {
      t: "phaseSync";
      phase: "FLASH";
      serverNow: number;
      round: number;
      flashAt: number;
      answerAt: number;
      holdMs: number;
      grid: Grid;
      seed: number;
    }
  | {
      t: "phaseSync";
      phase: "ANSWER";
      serverNow: number;
      round: number;
      answerEndsAt: number;
      counters: CounterState[];
    }
  | {
      t: "phaseSync";
      phase: "REVEAL";
      serverNow: number;
      reveal: RevealState;
      revealEndsAt: number;
    }
  | {
      t: "phaseSync";
      phase: "INTERMISSION";
      serverNow: number;
      reveal: RevealState;
      nextRoundAt: number;
    }
  | {
      t: "phaseSync";
      phase: "FINAL";
      serverNow: number;
      scores: ScoreTotal[];
      winnerIds: string[];
      endAt: number;
    };
