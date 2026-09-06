import { generateTerrain } from '../game/terrain';
import { MAP_SIZE, Overlay, Terrain, type MapKind } from '../game/types';

/** Tiny isometric rendering of a map seed, for the welcome screen gallery. */
export function renderPreview(canvas: HTMLCanvasElement, seed: number, kind: MapKind): void {
  const { terrain, overlay, elev } = generateTerrain(MAP_SIZE, seed, kind);
  const S = MAP_SIZE, cs = S + 1;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#141a28';
  ctx.fillRect(0, 0, W, H);
  const k = W / (2 * S);
  const x0 = W / 2, y0 = 12;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const h = Math.min(elev[y * cs + x], elev[y * cs + x + 1], elev[(y + 1) * cs + x], elev[(y + 1) * cs + x + 1]);
      let color: string;
      if (terrain[i] === Terrain.Water) color = '#3b78b5';
      else if (overlay[i] === Overlay.Tree) color = `hsl(120, 40%, ${26 + h * 2}%)`;
      else color = `hsl(96, 42%, ${44 + h * 2.5}%)`;
      ctx.fillStyle = color;
      ctx.fillRect(x0 + (x - y) * k - k, y0 + (x + y) * k * 0.5 - h * k * 0.35, 2 * k + 0.6, k + 0.6);
    }
  }
}
