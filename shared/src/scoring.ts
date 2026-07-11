import type { RoundResult } from "./protocol.js";

export interface ScoreInput {
  playerId: string;
  value: number;
  lockAt: number | null; // null = timeout auto-lock (treated as late)
}

/**
 * Score a round per BRD §3.6.
 * Exact → +3 each. Else unique closest → +1.
 * Error tie → earliest lockAt; residual same-ms → lowest playerId.
 */
export function scoreRound(
  truth: number,
  guesses: ScoreInput[],
): RoundResult[] {
  const withError = guesses.map((g) => ({
    ...g,
    error: Math.abs(g.value - truth),
  }));

  const exactIds = new Set(
    withError.filter((g) => g.error === 0).map((g) => g.playerId),
  );

  let closestId: string | null = null;
  if (exactIds.size === 0 && withError.length > 0) {
    const sorted = [...withError].sort((a, b) => {
      if (a.error !== b.error) return a.error - b.error;
      const aLock = a.lockAt ?? Number.POSITIVE_INFINITY;
      const bLock = b.lockAt ?? Number.POSITIVE_INFINITY;
      if (aLock !== bLock) return aLock - bLock;
      return a.playerId.localeCompare(b.playerId);
    });
    closestId = sorted[0]?.playerId ?? null;
  }

  return withError.map((g) => {
    let points: 0 | 1 | 3 = 0;
    let outcome: RoundResult["outcome"] = "none";
    if (exactIds.has(g.playerId)) {
      points = 3;
      outcome = "exact";
    } else if (closestId === g.playerId) {
      points = 1;
      outcome = "closest";
    }
    return {
      playerId: g.playerId,
      value: g.value,
      lockAt: g.lockAt,
      error: g.error,
      points,
      outcome,
    };
  });
}

export function matchWinner(
  scores: { playerId: string; score: number }[],
): string[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores.map((s) => s.score));
  return scores.filter((s) => s.score === max).map((s) => s.playerId);
}

export function needsSuddenDeath(
  scores: { playerId: string; score: number }[],
): boolean {
  return matchWinner(scores).length > 1;
}
