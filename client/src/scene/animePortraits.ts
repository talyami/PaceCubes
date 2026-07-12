import { ANIME_PORTRAIT_COUNT } from "@yamicuberush/shared";

const cache = new Map<number, string>();

const PALETTES = [
  { hair: "#2b1b3d", skin: "#ffe8d6", accent: "#ff6b9d", eye: "#4a90e2" },
  { hair: "#1a2f4d", skin: "#f8dcc8", accent: "#7c5cff", eye: "#2ec4b6" },
  { hair: "#4a1942", skin: "#ffe0cf", accent: "#ff9f1c", eye: "#e71d36" },
  { hair: "#0f3d2e", skin: "#f5d7c4", accent: "#06d6a0", eye: "#118ab2" },
  { hair: "#3d1f0f", skin: "#ffd9ba", accent: "#ef476f", eye: "#8338ec" },
  { hair: "#1f2937", skin: "#f3d2c3", accent: "#f72585", eye: "#3a86ff" },
  { hair: "#5c2d91", skin: "#ffe5d9", accent: "#ffbe0b", eye: "#219ebc" },
  { hair: "#134e4a", skin: "#f7d9c4", accent: "#fb5607", eye: "#9b5de5" },
  { hair: "#4c1d95", skin: "#ffdbc8", accent: "#00bbf9", eye: "#00f5d4" },
  { hair: "#7f1d1d", skin: "#ffd6ba", accent: "#ffd60a", eye: "#4361ee" },
  { hair: "#1e3a8a", skin: "#f8e0d0", accent: "#ff006e", eye: "#38b000" },
  { hair: "#312e81", skin: "#ffe8d1", accent: "#ff7b00", eye: "#7209b7" },
] as const;

function drawPortrait(index: number): HTMLCanvasElement {
  const palette = PALETTES[index % PALETTES.length]!;
  const style = Math.floor(index / PALETTES.length) % 3;
  const variant = index % PALETTES.length;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = "#f4f4f8";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#222222";
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  const cx = size / 2;
  const cy = size * 0.56;

  // Distinct silhouette families: long hair, twin tails, and short/spiky hair.
  if (style === 1) {
    ctx.fillStyle = palette.hair;
    ctx.beginPath(); ctx.arc(cx - 38, cy - 8, 18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 38, cy - 8, 18, 0, Math.PI * 2); ctx.fill();
  } else if (style === 2) {
    ctx.fillStyle = palette.hair;
    ctx.beginPath();
    ctx.moveTo(cx - 42, cy - 16); ctx.lineTo(cx - 26, cy - 48); ctx.lineTo(cx - 10, cy - 35);
    ctx.lineTo(cx + 8, cy - 52); ctx.lineTo(cx + 22, cy - 35); ctx.lineTo(cx + 42, cy - 16);
    ctx.closePath(); ctx.fill();
  }

  // Hair back
  ctx.fillStyle = palette.hair;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 8, 42, 48, 0, 0, Math.PI * 2);
  ctx.fill();

  // Neck
  ctx.fillStyle = palette.skin;
  ctx.fillRect(cx - 14, cy + 18, 28, 22);

  // Face
  ctx.beginPath();
  ctx.ellipse(cx, cy, 34, 38, 0, 0, Math.PI * 2);
  ctx.fillStyle = palette.skin;
  ctx.fill();
  ctx.strokeStyle = "rgba(34,34,34,0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Bangs
  ctx.fillStyle = palette.hair;
  ctx.beginPath();
  ctx.moveTo(cx - 36, cy - 10);
  ctx.quadraticCurveTo(cx - 10, cy - 42, cx + 8, cy - 18);
  ctx.quadraticCurveTo(cx + 28, cy - 40, cx + 36, cy - 8);
  ctx.lineTo(cx + 30, cy + 2);
  ctx.quadraticCurveTo(cx, cy - 8, cx - 30, cy + 2);
  ctx.closePath();
  ctx.fill();

  // Eyes
  const eyeY = cy + 2;
  for (const ex of [cx - 14, cx + 14]) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 10, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = palette.eye;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + 1, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(ex, eyeY + 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex + 2, eyeY, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Blush
  ctx.fillStyle = "rgba(255, 120, 140, 0.28)";
  ctx.beginPath();
  ctx.ellipse(cx - 22, cy + 12, 8, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 22, cy + 12, 8, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy + 18, 6, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // Family-specific accessories make portraits read as different sources.
  if (style === 1) {
    ctx.strokeStyle = palette.accent; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy - 3, 45, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
  } else if (style === 2) {
    ctx.fillStyle = palette.accent;
    ctx.beginPath(); ctx.moveTo(cx + 23, cy - 27); ctx.lineTo(cx + 43, cy - 34);
    ctx.lineTo(cx + 38, cy - 15); ctx.closePath(); ctx.fill();
  }

  // Accent ribbon
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy - 34);
  ctx.lineTo(cx + 8, cy - 34);
  ctx.lineTo(cx + 4, cy - 24);
  ctx.lineTo(cx - 4, cy - 24);
  ctx.closePath();
  ctx.fill();

  return c;
}

export function portraitDataUrl(index: number): string {
  const key = ((index % ANIME_PORTRAIT_COUNT) + ANIME_PORTRAIT_COUNT) % ANIME_PORTRAIT_COUNT;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = drawPortrait(key).toDataURL("image/png");
  cache.set(key, url);
  return url;
}
