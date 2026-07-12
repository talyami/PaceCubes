/** Timings, difficulty, palette, limits — locked per BRD §3. */

export const VERSION = "1.0.0";

export const GRID_SIZE = 5;
export const MAX_STACK = 3;
export const MAX_ANIME_TILES = GRID_SIZE * GRID_SIZE;
export const ANIME_PORTRAIT_COUNT = 36;
export const ROOM_CODE_CAPACITY = 100;
export const MAX_COUNTER = 99;
export const MATCH_ROUNDS = 7;
export const MAX_SUDDEN_DEATH = 3;
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;

export const ROOM_CODE_ALPHABET = "0123456789";
export const ROOM_CODE_LENGTH = 2;
export const NAME_MAX_LEN = 16;

export const EMPTY_ROOM_TTL_MS = 60_000;
export const IDLE_LOBBY_TTL_MS = 30 * 60_000;
export const SEAT_DISCONNECT_TTL_MS = 60_000;

export const MATCH_INTRO_MS = 800;
export const COUNTDOWN_MS = 3000;
export const SLIDE_IN_MS = 600;
export const SLIDE_STAGGER_MS = 40;
export const VANISH_MS = 250;
export const ROUND_HOLD_INCREMENT_MS = 2000;
export const ANSWER_TIMEOUT_MS = 10_000;
export const REVEAL_CUBE_MS = 120;
export const REVEAL_HOLD_MS = 1500;
export const INTERMISSION_MS = 2000;
export const FLASH_DATA_LEAD_MS = 300;
export const LOCK_GUARD_MS = 300;

export const HEARTBEAT_PING_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 30_000;
export const COUNTER_FLUSH_MS = 100;

export const CLOCK_BURST_COUNT = 5;
export const CLOCK_BURST_GAP_MS = 150;
export const CLOCK_REFRESH_MS = 10_000;

export interface DifficultyRow {
  round: number;
  minCubes: number;
  maxCubes: number;
  maxHeight: number;
  holdMs: number;
}

export const DIFFICULTY: readonly DifficultyRow[] = [
  { round: 1, minCubes: 4, maxCubes: 6, maxHeight: 1, holdMs: 1500 },
  { round: 2, minCubes: 6, maxCubes: 9, maxHeight: 2, holdMs: 1500 },
  { round: 3, minCubes: 8, maxCubes: 12, maxHeight: 2, holdMs: 1200 },
  { round: 4, minCubes: 11, maxCubes: 15, maxHeight: 3, holdMs: 1200 },
  { round: 5, minCubes: 14, maxCubes: 19, maxHeight: 3, holdMs: 1000 },
  { round: 6, minCubes: 18, maxCubes: 24, maxHeight: 3, holdMs: 1000 },
  { round: 7, minCubes: 22, maxCubes: 30, maxHeight: 3, holdMs: 800 },
] as const;

/** Level 1 — single-story anime tiles only (max 25 occupied cells). */
export const ANIME_DIFFICULTY: readonly DifficultyRow[] = [
  { round: 1, minCubes: 3, maxCubes: 5, maxHeight: 1, holdMs: 2000 },
  { round: 2, minCubes: 5, maxCubes: 8, maxHeight: 1, holdMs: 1800 },
  { round: 3, minCubes: 7, maxCubes: 10, maxHeight: 1, holdMs: 1600 },
  { round: 4, minCubes: 9, maxCubes: 13, maxHeight: 1, holdMs: 1400 },
  { round: 5, minCubes: 12, maxCubes: 16, maxHeight: 1, holdMs: 1200 },
  { round: 6, minCubes: 15, maxCubes: 19, maxHeight: 1, holdMs: 1000 },
  { round: 7, minCubes: 18, maxCubes: 22, maxHeight: 1, holdMs: 900 },
] as const;

export function difficultyTable(level: 1 | 2): readonly DifficultyRow[] {
  return level === 1 ? ANIME_DIFFICULTY : DIFFICULTY;
}

export function difficultyForRound(round: number, level: 1 | 2 = 2): DifficultyRow {
  const table = difficultyTable(level);
  if (round <= 7) {
    const row = table[round - 1];
    if (!row) throw new Error(`missing difficulty for round ${round}`);
    return row;
  }
  return table[6]!;
}

export function parseGameLevel(raw: unknown): 1 | 2 | null {
  if (raw === 1 || raw === 2) return raw;
  return null;
}

export const PALETTE = {
  background: "#f7f7f5",
  gridLine: "#c8c8c8",
  cubeFace: "#f4f4f8",
  revealFill: "#34d434",
  text: "#222222",
  endWipe: "#1a1a1a",
} as const;

export const RATE = {
  press: { rate: 25, burst: 40 },
  join: { rate: 1, burst: 3 },
  message: { rate: 60, burst: 100 },
  roomCreatePerIp: { windowMs: 60_000, max: 10 },
  syncPerSocket: 3,
} as const;
