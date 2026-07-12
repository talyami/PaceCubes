import { GRID_SIZE, ANIME_PORTRAIT_COUNT } from "./constants.js";
import type { Grid } from "./protocol.js";

/** Mulberry32 PRNG — deterministic for a given seed. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emptyGrid(): Grid {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => 0),
  );
}

function neighbors(x: number, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
      out.push([nx, ny]);
    }
  }
  return out;
}

function randomEmptyCell(
  rng: () => number,
  grid: Grid,
): [number, number] | null {
  const empties: [number, number][] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y]![x] === 0) empties.push([x, y]);
    }
  }
  if (empties.length === 0) return null;
  return empties[Math.floor(rng() * empties.length)]!;
}

function randomEmptyNeighbor(
  rng: () => number,
  grid: Grid,
  occupied: [number, number][],
): [number, number] | null {
  if (occupied.length === 0) return null;
  const pivot = occupied[Math.floor(rng() * occupied.length)]!;
  const candidates = neighbors(pivot[0], pivot[1]).filter(
    ([x, y]) => grid[y]![x] === 0,
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)]!;
}

/**
 * Clustered random-walk layout (BRD §3.5).
 * Invariant: sum(grid) === targetCubes; all heights ∈ [0, maxH].
 */
export function generateGrid(
  seed: number,
  targetCubes: number,
  maxH: number,
): Grid {
  if (targetCubes < 0) throw new Error("targetCubes must be >= 0");
  if (maxH < 1 || maxH > 3) throw new Error("maxH must be 1..3");

  const rng = mulberry32(seed);
  const grid = emptyGrid();
  const occupied: [number, number][] = [];
  let total = 0;

  while (total < targetCubes) {
    const pickNew = occupied.length === 0 || rng() < 0.35;
    let cell: [number, number] | null = pickNew
      ? randomEmptyCell(rng, grid)
      : (randomEmptyNeighbor(rng, grid, occupied) ??
        randomEmptyCell(rng, grid));

    if (!cell) {
      // No empty cells left — bump existing stacks (shouldn't happen for our targets)
      const bumpable = occupied.filter(([x, y]) => (grid[y]![x] ?? 0) < maxH);
      if (bumpable.length === 0) break;
      cell = bumpable[Math.floor(rng() * bumpable.length)]!;
      const [bx, by] = cell;
      const room = Math.min(maxH - (grid[by]![bx] ?? 0), targetCubes - total);
      if (room <= 0) break;
      const add = 1 + Math.floor(rng() * room);
      grid[by]![bx] = (grid[by]![bx] ?? 0) + add;
      total += add;
      continue;
    }

    const [x, y] = cell;
    const remaining = targetCubes - total;
    const h = Math.min(1 + Math.floor(rng() * maxH), remaining);
    grid[y]![x] = h;
    occupied.push([x, y]);
    total += h;
  }

  return grid;
}

export function sumGrid(grid: Grid): number {
  let s = 0;
  for (const row of grid) {
    for (const v of row) s += v;
  }
  return s;
}

export function pickTargetCubes(
  seed: number,
  minCubes: number,
  maxCubes: number,
): number {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  return minCubes + Math.floor(rng() * (maxCubes - minCubes + 1));
}

/** Deterministic portrait pick for level-1 occupied cells. */
export function portraitIndex(seed: number, x: number, y: number): number {
  const rng = mulberry32(seed ^ (x * GRID_SIZE + y) ^ 0x51ed270b);
  return Math.floor(rng() * ANIME_PORTRAIT_COUNT);
}
