import { hash2 } from './rng';
import { MAX_ELEV, Overlay, Terrain, type MapKind } from './types';

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
 * Generates a map of the given family: `coast` has lakes and a sea along one edge, `river` a
 * meandering river with a tributary, `lakes` inland water only, `islands` an archipelago,
 * `mountain` steep terraced relief around a few lakes.
 * Forests come in clumps and thicken near water. Adjacent corners never differ by more than
 * one level, so every height change is a slope, never a cliff.
 */
export function generateTerrain(size: number, seed: number, kind: MapKind = 'coast'): TerrainResult {
  const terrain = new Uint8Array(size * size);
  const overlay = new Uint8Array(size * size);
  const cs = size + 1;
  const elev = new Uint8Array(cs * cs);
  const coastEdge = hash2(seed, 7, seed) % 4; // 0=N 1=E 2=S 3=W
  const bank = kind === 'river' ? riverBanks(size, seed) : null;

  const elevation = (x: number, y: number, valley = true): number => {
    let e = fbm(x, y, seed, kind === 'lakes' ? 1 / 34 : kind === 'mountain' ? 1 / 20 : 1 / 28);
    if (kind === 'coast') {
      const dEdge = [y, size - 1 - x, size - 1 - y, x][coastEdge];
      e -= Math.max(0, 1 - dEdge / 22) * 0.45;
    } else if (kind === 'islands') {
      const dEdge = Math.min(x, y, size - 1 - x, size - 1 - y);
      e -= Math.max(0, 1 - dEdge / 14) * 0.5;
    } else if (bank && valley) {
      // a valley around the river: banks stay low and flat
      const d = bank[Math.min(size - 1, Math.max(0, Math.floor(y))) * size + Math.min(size - 1, Math.max(0, Math.floor(x)))];
      e -= Math.max(0, 1 - Math.max(0, d) / 9) * 0.35;
    }
    return e;
  };

  // sea level: fixed, except for the archipelago where it is chosen to leave 45 % of land
  let sea = kind === 'lakes' ? 0.36 : kind === 'river' || kind === 'mountain' ? 0.28 : SEA;
  if (kind === 'islands') {
    const all = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) all[y * size + x] = elevation(x + 0.5, y + 0.5);
    all.sort();
    sea = all[Math.floor(all.length * 0.55)];
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const e = elevation(x + 0.5, y + 0.5, false);
      terrain[i] = e < sea || (bank !== null && bank[i] < 0) ? Terrain.Water : Terrain.Land;
    }
  }

  // forests: broad patches with ragged, clumpy edges, thicker near the water
  const wd = distanceFrom(terrain, size, Terrain.Water, 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (terrain[i] !== Terrain.Land) continue;
      const f = 0.62 * fbm(x, y, seed ^ 0x5bd1e995, 1 / 12) + 0.38 * fbm(x, y, seed ^ 0x27d4eb2f, 1 / 4.5) + 0.12 * Math.max(0, 1 - wd[i] / 4);
      if (f > 0.61) overlay[i] = Overlay.Tree;
    }
  }

  // corner heights: flat plains near sea level, terraces further inland
  for (let cy = 0; cy < cs; cy++) {
    for (let cx = 0; cx < cs; cx++) {
      const e = elevation(cx, cy);
      const t = Math.max(0, Math.min(1, (e - sea - 0.02) / (1 - sea)));
      // mountains climb sooner and higher: more terraces to level before building
      elev[cy * cs + cx] = Math.min(MAX_ELEV, Math.round(kind === 'mountain' ? Math.pow(t, 1.15) * 26 : Math.pow(t, 1.6) * 16));
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

/**
 * Signed distance from each tile to the nearest river bank (negative inside the water): a
 * meandering main river from one edge to the opposite one, and a tributary joining it.
 */
function riverBanks(size: number, seed: number): Float32Array {
  const bank = new Float32Array(size * size).fill(99);
  const rnd = (k: number) => hash2(seed, k, 0x9e37) / 4294967296;
  const stamp = (px: number, py: number, w: number) => {
    const R = 12;
    for (let y = Math.max(0, Math.floor(py - R)); y <= Math.min(size - 1, Math.ceil(py + R)); y++) {
      for (let x = Math.max(0, Math.floor(px - R)); x <= Math.min(size - 1, Math.ceil(px + R)); x++) {
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) - w;
        const i = y * size + x;
        if (d < bank[i]) bank[i] = d;
      }
    }
  };
  const vertical = rnd(1) < 0.5;
  const a1 = size * (0.12 + rnd(2) * 0.1), f1 = 0.8 + rnd(3) * 0.6, p1 = rnd(4) * Math.PI * 2;
  const a2 = a1 * 0.35, f2 = f1 * 2.7, p2 = rnd(5) * Math.PI * 2;
  const drift = (rnd(6) - 0.5) * size * 0.3;
  const across = (t: number) => size / 2 + drift * (t - 0.5) * 2 + a1 * Math.sin(2 * Math.PI * f1 * t + p1) + a2 * Math.sin(2 * Math.PI * f2 * t + p2);
  const width = (t: number) => 1.7 + valueNoise(t * 5, 0.5, seed + 77) * 1.1;
  const main: [number, number][] = [];
  for (let k = 0; k <= 400; k++) {
    const t = k / 400;
    const along = t * (size - 1), c = across(t);
    const px = vertical ? c : along, py = vertical ? along : c;
    main.push([px, py]);
    stamp(px, py, width(t));
  }
  // the tributary starts on a side edge and meets the river between a third and two thirds of its course
  const tj = 0.35 + rnd(8) * 0.35;
  const [ex, ey] = main[Math.round(tj * 400)];
  const side = rnd(9) < 0.5 ? 0 : size - 1;
  const start = 0.15 * size + rnd(10) * 0.7 * size;
  const sx = vertical ? side : start, sy = vertical ? start : side;
  const b1 = size * (0.04 + rnd(11) * 0.05), g1 = 1 + rnd(12), q1 = rnd(13) * Math.PI * 2;
  const len = Math.hypot(ex - sx, ey - sy) || 1;
  const nx = -(ey - sy) / len, ny = (ex - sx) / len;
  for (let k = 0; k <= 200; k++) {
    const s = k / 200;
    const m = b1 * Math.sin(2 * Math.PI * g1 * s + q1) * Math.sin(Math.PI * s);
    stamp(sx + (ex - sx) * s + nx * m, sy + (ey - sy) * s + ny * m, 0.9 + s * 0.6);
  }
  return bank;
}

/** Steps from each tile to the nearest tile of the given kind, capped at `max` (max + 1 beyond). */
function distanceFrom(terrain: Uint8Array, size: number, from: Terrain, max: number): Uint8Array {
  const dist = new Uint8Array(size * size).fill(max + 1);
  let frontier: number[] = [];
  for (let i = 0; i < dist.length; i++) if (terrain[i] === from) { dist[i] = 0; frontier.push(i); }
  for (let d = 1; d <= max && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % size;
      const nb = [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i >= size ? i - size : -1, i + size < dist.length ? i + size : -1];
      for (const j of nb) if (j >= 0 && dist[j] > d) { dist[j] = d; next.push(j); }
    }
    frontier = next;
  }
  return dist;
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
