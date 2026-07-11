import * as THREE from "three";
import { GRID_SIZE, PALETTE } from "@pacecubs/shared";

const CELL = 1;
const CUBE = 0.92;

function makeFaceTexture(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = PALETTE.cubeFace;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  private gridLines: THREE.LineSegments | null = null;
  private cubes: THREE.InstancedMesh | null = null;
  private readonly dummy = new THREE.Object3D();
  private readonly white = new THREE.Color(PALETTE.cubeFace);
  private readonly green = new THREE.Color(PALETTE.revealFill);
  private readonly tmpColor = new THREE.Color();
  private instanceCount = 0;
  private readonly instanceMeta: { x: number; y: number; layer: number }[] = [];
  private reducedMotion = false;
  private animId = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    const frustum = 5.5;
    this.camera = new THREE.OrthographicCamera(
      -frustum,
      frustum,
      frustum,
      -frustum,
      0.1,
      100,
    );
    // True isometric: direction (1,1,1)
    const d = 20;
    this.camera.position.set(d, d, d);
    this.camera.lookAt(0, 0.5, 0);
    this.camera.updateProjectionMatrix();

    const amb = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(amb);
    const d1 = new THREE.DirectionalLight(0xffffff, 0.5);
    d1.position.set(5, 10, 7);
    this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.25);
    d2.position.set(-3, 6, -5);
    this.scene.add(d2);

    this.buildGrid();
    this.buildCubes();
    this.resize();
  }

  private buildGrid(): void {
    const positions: number[] = [];
    const half = (GRID_SIZE * CELL) / 2;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const a = -half + i * CELL;
      // lines along X
      positions.push(-half, 0, a, half, 0, a);
      // lines along Z
      positions.push(a, 0, -half, a, 0, half);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const mat = new THREE.LineDashedMaterial({
      color: PALETTE.gridLine,
      dashSize: 0.08,
      gapSize: 0.06,
    });
    this.gridLines = new THREE.LineSegments(geo, mat);
    this.gridLines.computeLineDistances();
    this.scene.add(this.gridLines);
  }

  private buildCubes(): void {
    const geo = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
    const mat = new THREE.MeshLambertMaterial({ map: makeFaceTexture() });
    this.cubes = new THREE.InstancedMesh(geo, mat, 75);
    this.cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cubes.count = 0;
    this.scene.add(this.cubes);
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement ?? document.body;
    // Game HUD is 60vh; canvas is positioned fixed to match
    const w = window.innerWidth;
    const h = window.innerHeight * 0.6;
    this.renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const aspect = w / Math.max(h, 1);
    const base = 5.5;
    if (aspect > 1) {
      this.camera.left = -base * aspect;
      this.camera.right = base * aspect;
      this.camera.top = base;
      this.camera.bottom = -base;
    } else {
      this.camera.left = -base;
      this.camera.right = base;
      this.camera.top = base / aspect;
      this.camera.bottom = -base / aspect;
    }
    this.camera.updateProjectionMatrix();
  }

  cellWorld(x: number, y: number, layer: number): THREE.Vector3 {
    const half = (GRID_SIZE * CELL) / 2;
    const wx = -half + x * CELL + CELL / 2;
    const wz = -half + y * CELL + CELL / 2;
    const wy = layer * CUBE + CUBE / 2;
    return new THREE.Vector3(wx, wy, wz);
  }

  clearCubes(): void {
    if (!this.cubes) return;
    this.cubes.count = 0;
    this.instanceCount = 0;
    this.instanceMeta.length = 0;
  }

  /** Place cubes instantly (no anim) at grid positions. */
  setGrid(grid: number[][], visible = true): void {
    if (!this.cubes) return;
    this.instanceMeta.length = 0;
    let i = 0;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const h = grid[y]?.[x] ?? 0;
        for (let layer = 0; layer < h; layer++) {
          const pos = this.cellWorld(x, y, layer);
          this.dummy.position.copy(pos);
          this.dummy.scale.setScalar(visible ? 1 : 0.001);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.updateMatrix();
          this.cubes.setMatrixAt(i, this.dummy.matrix);
          this.cubes.setColorAt(i, this.white);
          this.instanceMeta.push({ x, y, layer });
          i++;
        }
      }
    }
    this.instanceCount = i;
    this.cubes.count = i;
    this.cubes.instanceMatrix.needsUpdate = true;
    if (this.cubes.instanceColor) this.cubes.instanceColor.needsUpdate = true;
  }

  private easeOutCubic(t: number): number {
    return 1 - (1 - t) ** 3;
  }

  /**
   * Slide-in from nearest screen edge, 0.6s + 40ms stagger by x+y.
   */
  async animateSlideIn(grid: number[][]): Promise<void> {
    this.setGrid(grid, false);
    if (!this.cubes) return;

    if (this.reducedMotion) {
      this.setGrid(grid, true);
      return;
    }

    const duration = 600;
    const stagger = 40;
    const start = performance.now();
    const starts: number[] = this.instanceMeta.map(
      (m) => (m.x + m.y) * stagger,
    );
    const origins: THREE.Vector3[] = this.instanceMeta.map((m) => {
      const target = this.cellWorld(m.x, m.y, m.layer);
      // Nearest edge in xz
      const half = (GRID_SIZE * CELL) / 2 + 2;
      const edges = [
        new THREE.Vector3(-half, target.y, target.z),
        new THREE.Vector3(half, target.y, target.z),
        new THREE.Vector3(target.x, target.y, -half),
        new THREE.Vector3(target.x, target.y, half),
      ];
      // Pick edge closest to camera-forward projection (screen edge-ish)
      let best = edges[0]!;
      let bestD = Infinity;
      for (const e of edges) {
        const d = e.distanceTo(this.camera.position);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      // Actually "nearest screen edge" — use max |offset| axis from center
      const cx = target.x;
      const cz = target.z;
      if (Math.abs(cx) >= Math.abs(cz)) {
        return new THREE.Vector3(Math.sign(cx || 1) * half, target.y, cz);
      }
      return new THREE.Vector3(cx, target.y, Math.sign(cz || 1) * half);
    });

    const targets = this.instanceMeta.map((m) =>
      this.cellWorld(m.x, m.y, m.layer),
    );

    await this.runAnim((now) => {
      let done = true;
      for (let i = 0; i < this.instanceCount; i++) {
        const localT = (now - start - starts[i]!) / duration;
        if (localT < 1) done = false;
        const t = Math.max(0, Math.min(1, localT));
        const e = this.easeOutCubic(t);
        const o = origins[i]!;
        const tgt = targets[i]!;
        this.dummy.position.lerpVectors(o, tgt, e);
        this.dummy.scale.setScalar(t <= 0 ? 0.001 : 1);
        this.dummy.updateMatrix();
        this.cubes!.setMatrixAt(i, this.dummy.matrix);
      }
      this.cubes!.instanceMatrix.needsUpdate = true;
      return done;
    });
  }

  async animateVanish(): Promise<void> {
    if (!this.cubes || this.instanceCount === 0) return;
    if (this.reducedMotion) {
      this.clearCubes();
      return;
    }
    const duration = 250;
    const start = performance.now();
    const scales = new Array(this.instanceCount).fill(1);
    await this.runAnim((now) => {
      const t = Math.min(1, (now - start) / duration);
      const s = Math.max(0.001, 1 - t);
      for (let i = 0; i < this.instanceCount; i++) {
        this.cubes!.getMatrixAt(i, this.dummy.matrix);
        this.dummy.matrix.decompose(
          this.dummy.position,
          this.dummy.quaternion,
          this.dummy.scale,
        );
        this.dummy.scale.setScalar(s * scales[i]!);
        this.dummy.updateMatrix();
        this.cubes!.setMatrixAt(i, this.dummy.matrix);
      }
      this.cubes!.instanceMatrix.needsUpdate = true;
      return t >= 1;
    });
    this.clearCubes();
  }

  /**
   * Reveal fill: color → green per order, 120ms/cube with pop scale.
   * Calls onTick(index, truthSoFar) each cube.
   */
  async animateReveal(
    grid: number[][],
    order: [number, number, number][],
    onTick: (filled: number) => void,
  ): Promise<void> {
    this.setGrid(grid, true);
    if (!this.cubes) return;

    const indexOf = (x: number, y: number, layer: number): number => {
      for (let i = 0; i < this.instanceMeta.length; i++) {
        const m = this.instanceMeta[i]!;
        if (m.x === x && m.y === y && m.layer === layer) return i;
      }
      return -1;
    };

    const cubeMs = this.reducedMotion ? 40 : 120;
    for (let step = 0; step < order.length; step++) {
      const [x, y, layer] = order[step]!;
      const idx = indexOf(x, y, layer);
      if (idx >= 0) {
        await this.fillCube(idx, cubeMs);
      }
      onTick(step + 1);
    }
  }

  private fillCube(idx: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.cubes) {
        resolve();
        return;
      }
      this.cubes.setColorAt(idx, this.green);
      if (this.cubes.instanceColor) this.cubes.instanceColor.needsUpdate = true;

      if (this.reducedMotion || duration < 50) {
        resolve();
        return;
      }

      const start = performance.now();
      this.cubes.getMatrixAt(idx, this.dummy.matrix);
      this.dummy.matrix.decompose(
        this.dummy.position,
        this.dummy.quaternion,
        this.dummy.scale,
      );
      const basePos = this.dummy.position.clone();

      const pop = (now: number): boolean => {
        const t = Math.min(1, (now - start) / duration);
        // 0→0.4 scale up to 1.15, 0.4→1 back to 1
        let s = 1;
        if (t < 0.4) s = 1 + 0.15 * (t / 0.4);
        else s = 1.15 - 0.15 * ((t - 0.4) / 0.6);
        this.dummy.position.copy(basePos);
        this.dummy.scale.setScalar(s);
        this.dummy.updateMatrix();
        this.cubes!.setMatrixAt(idx, this.dummy.matrix);
        this.cubes!.instanceMatrix.needsUpdate = true;
        return t >= 1;
      };

      void this.runAnim(pop).then(resolve);
    });
  }

  private runAnim(
    step: (now: number) => boolean,
  ): Promise<void> {
    const id = ++this.animId;
    return new Promise((resolve) => {
      const frame = (now: number) => {
        if (id !== this.animId) {
          resolve();
          return;
        }
        if (step(now)) {
          resolve();
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  cancelAnims(): void {
    this.animId++;
  }

  startLoop(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stopLoop(): void {
    this.running = false;
  }

  show(visible: boolean): void {
    this.renderer.domElement.style.display = visible ? "block" : "none";
  }
}
