import type { Grid } from "./protocol.js";

/**
 * Back-to-front (x+y ascending), bottom-up per stack.
 * Returns [x, y, layer] for each cube (layer 0 = bottom).
 */
export function revealOrder(grid: Grid): [number, number, number][] {
  const cells: { x: number; y: number; h: number; diag: number }[] = [];
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x++) {
      const h = row[x] ?? 0;
      if (h > 0) cells.push({ x, y, h, diag: x + y });
    }
  }
  cells.sort((a, b) => a.diag - b.diag || a.y - b.y || a.x - b.x);

  const order: [number, number, number][] = [];
  for (const c of cells) {
    for (let layer = 0; layer < c.h; layer++) {
      order.push([c.x, c.y, layer]);
    }
  }
  return order;
}
