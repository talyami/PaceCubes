import { GRID_SIZE, type Grid, portraitIndex } from "@yamicuberush/shared";
import { portraitDataUrl } from "./animePortraits.js";

interface TileMeta {
  x: number;
  y: number;
  portrait: number;
  el: HTMLElement;
}

export class AnimeBoard {
  readonly root: HTMLElement;
  private gridEl: HTMLElement;
  private tiles: TileMeta[] = [];
  private animId = 0;
  private reducedMotion = false;

  constructor() {
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.root = document.createElement("div");
    this.root.className = "anime-board hidden";
    this.root.setAttribute("aria-hidden", "true");
    this.gridEl = document.createElement("div");
    this.gridEl.className = "anime-grid";
    this.root.append(this.gridEl);
  }

  mount(stage: HTMLElement): void {
    if (!this.root.isConnected) stage.append(this.root);
  }

  show(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }

  resize(): void {
    const stage = document.getElementById("game-stage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    // Keep the board clear of the top HUD and bottom notifications.
    const safeWidth = Math.max(1, rect.width - 28);
    const safeHeight = Math.max(1, rect.height - 104);
    const side = Math.min(safeWidth, safeHeight, 640);
    this.root.style.width = `${side}px`;
    this.root.style.height = `${side}px`;
  }

  clear(): void {
    this.animId++;
    this.tiles = [];
    this.gridEl.innerHTML = "";
  }

  private buildTiles(grid: Grid, seed: number, visible: boolean): void {
    this.clear();
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if ((grid[y]?.[x] ?? 0) < 1) continue;
        const portrait = portraitIndex(seed, x, y);
        const cell = document.createElement("div");
        cell.className = "anime-cell";
        // Preserve coordinates instead of packing occupied cells together.
        cell.style.gridColumn = String(x + 1);
        cell.style.gridRow = String(y + 1);
        cell.style.setProperty("--x", String(x));
        cell.style.setProperty("--y", String(y));
        cell.style.setProperty("--tilt", `${((portrait + x * 3 + y * 5) % 7) - 3}deg`);
        const img = document.createElement("img");
        img.src = portraitDataUrl(portrait);
        img.alt = "";
        img.draggable = false;
        img.className = "anime-portrait";
        cell.classList.toggle("is-entering", !visible);
        cell.append(img);
        this.gridEl.append(cell);
        this.tiles.push({ x, y, portrait, el: cell });
      }
    }
    this.resize();
  }

  setGrid(grid: Grid, seed: number, visible = true): void {
    this.buildTiles(grid, seed, visible);
    if (visible) {
      for (const tile of this.tiles) {
        tile.el.classList.remove("is-entering", "revealed");
      }
    }
  }

  showReveal(grid: Grid, seed: number): void {
    this.setGrid(grid, seed, true);
    for (const tile of this.tiles) tile.el.classList.add("revealed");
  }

  async animateSlideIn(grid: Grid, seed: number): Promise<void> {
    this.buildTiles(grid, seed, false);
    if (this.reducedMotion) {
      this.setGrid(grid, seed, true);
      return;
    }
    const duration = 600;
    const stagger = 40;
    const start = performance.now();
    const id = ++this.animId;

    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        if (id !== this.animId) {
          resolve();
          return;
        }
        let done = true;
        for (const tile of this.tiles) {
          const delay = (tile.x + tile.y) * stagger;
          const t = Math.max(0, Math.min(1, (now - start - delay) / duration));
          const eased = 1 - (1 - t) ** 3;
          tile.el.style.setProperty("--pop", String(eased));
          if (t < 1) done = false;
        }
        if (done) {
          for (const tile of this.tiles) {
            tile.el.classList.remove("is-entering");
            tile.el.style.removeProperty("--pop");
          }
          resolve();
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  async animateVanish(): Promise<void> {
    if (this.tiles.length === 0) return;
    if (this.reducedMotion) {
      this.clear();
      return;
    }
    const duration = 250;
    const start = performance.now();
    const id = ++this.animId;
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        if (id !== this.animId) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / duration);
        const scale = Math.max(0.001, 1 - t);
        for (const tile of this.tiles) {
          tile.el.style.setProperty("--pop", String(scale));
          tile.el.style.opacity = String(1 - t);
        }
        if (t >= 1) {
          this.clear();
          resolve();
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  async animateReveal(
    grid: Grid,
    seed: number,
    order: [number, number, number][],
    onTick: (filled: number) => void,
  ): Promise<void> {
    this.setGrid(grid, seed, true);
    const tileMs = this.reducedMotion ? 40 : 120;
    const byCell = new Map<string, HTMLElement>();
    for (const tile of this.tiles) {
      byCell.set(`${tile.x},${tile.y}`, tile.el);
    }
    let filled = 0;
    for (const [x, y] of order) {
      const el = byCell.get(`${x},${y}`);
      if (el) {
        el.classList.add("revealed");
        if (!this.reducedMotion) {
          await new Promise<void>((resolve) => {
            el.classList.add("pop");
            setTimeout(() => {
              el.classList.remove("pop");
              resolve();
            }, tileMs);
          });
        }
      }
      filled++;
      onTick(filled);
      if (!this.reducedMotion && tileMs >= 50) {
        await new Promise((r) => setTimeout(r, tileMs));
      }
    }
  }

  cancelAnims(): void {
    this.animId++;
  }
}
