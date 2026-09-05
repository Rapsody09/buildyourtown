import { hash2 } from './rng';
import { MAX_ELEV, Overlay, Terrain } from './types';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Interpolated lattice noise in [0, 1). */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const v = (ix: number, iy: number) => hash2(ix, iy, seed) / 4294967296;
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * fx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * fx;
  return a + (b - a) * fy;
}

function fbm(x: number, y: number, seed: number, baseFreq: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < 4; o++) {
    sum += valueNoise(x * freq, y * freq, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export interface TerrainResult {
  terrain: Uint8Array;
  overlay: Uint8Array;
  /** corner heights, (size + 1) x (size + 1) */
  elev: Uint8Array;
}

const SEA = 0.34;

/**
 * Generates a map with lakes, one coastline along a random edge, patches of
 * forest and gentle terraced hills. Adjacent corners never differ by more
 * than one level, so every height change is a slope, never a cliff.
 */
export function generateTerrain(size: number, seed: number): TerrainResult {
  const terrain = new Uint8Array(size * size);
  const overlay = new Uint8Array(size * size);
  const cs = size + 1;
  const elev = new Uint8Array(cs * cs);
  const coastEdge = hash2(seed, 7, seed) % 4; // 0=N 1=E 2=S 3=W

  const elevation = (x: number, y: number): number => {
    let e = fbm(x, y, seed, 1 / 28);
    const dEdge = [y, size - 1 - x, size - 1 - y, x][coastEdge];
    e -= Math.max(0, 1 - dEdge / 22) * 0.45;
    return e;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const e = elevation(x + 0.5, y + 0.5);
      if (e < SEA) {
        terrain[i] = Terrain.Water;
        continue;
      }
      terrain[i] = Terrain.Land;
      const forest = fbm(x, y, seed ^ 0x5bd1e995, 1 / 14);
      if (e > SEA + 0.03 && forest > 0.6) overlay[i] = Overlay.Tree;
    }
  }

  // corner heights: flat plains near sea level, terraces further inland
  for (let cy = 0; cy < cs; cy++) {
    for (let cx = 0; cx < cs; cx++) {
      const e = elevation(cx, cy);
      const t = Math.max(0, Math.min(1, (e - SEA - 0.02) / (1 - SEA)));
      elev[cy * cs + cx] = Math.min(MAX_ELEV, Math.round(Math.pow(t, 1.6) * 16));
    }
  }
  // water sits at level 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (terrain[y * size + x] !== Terrain.Water) continue;
      elev[y * cs + x] = 0; elev[y * cs + x + 1] = 0;
      elev[(y + 1) * cs + x] = 0; elev[(y + 1) * cs + x + 1] = 0;
    }
  }
  relaxSlopes(elev, cs);
  return { terrain, overlay, elev };
}

/** Lowers corners until no two neighbours differ by more than one level. */
export function relaxSlopes(elev: Uint8Array, cs: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let cy = 0; cy < cs; cy++) {
      for (let cx = 0; cx < cs; cx++) {
        const i = cy * cs + cx;
        const h = elev[i];
        if (cx < cs - 1 && elev[i + 1] > h + 1) { elev[i + 1] = h + 1; changed = true; }
        if (cy < cs - 1 && elev[i + cs] > h + 1) { elev[i + cs] = h + 1; changed = true; }
        if (cx > 0 && elev[i - 1] > h + 1) { elev[i - 1] = h + 1; changed = true; }
        if (cy > 0 && elev[i - cs] > h + 1) { elev[i - cs] = h + 1; changed = true; }
      }
    }
  }
}
