import type { City } from './city';
import { hash2 } from './rng';
import { computeStats, recomputeRoadDist, refreshGrid, tick } from './sim';
import { STRUCTS } from './structs';
import { applyPlan, planTool } from './tools';
import { relaxSlopes } from './terrain';
import { Overlay, TICKS_PER_MONTH, Terrain, type StructType, type Tool } from './types';

export interface DemoOptions {
  /** side of the square area to flatten and urbanise */
  size?: number;
  mode?: 'mixed' | 'res-only';
  /** years to simulate right away */
  years?: number;
  /** leave out plants, water and services (to test the failure modes) */
  bare?: boolean;
  /** force a few 2x2 and 3x3 buildings so they can be looked at */
  showcase?: boolean;
}

export interface DemoArea {
  x: number;
  y: number;
  size: number;
  land: number;
}

/** Levels the area to its median corner height (free: this is set-up, not play). */
function flattenArea(city: City, x0: number, y0: number, S: number): void {
  const { elev, cs } = city;
  const touchesWater = (cx: number, cy: number): boolean => {
    for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
      if (city.inBounds(tx, ty) && city.terrain[city.idx(tx, ty)] === Terrain.Water) return true;
    }
    return false;
  };
  const hs: number[] = [];
  for (let cy = y0; cy <= y0 + S; cy++) for (let cx = x0; cx <= x0 + S; cx++) hs.push(elev[cy * cs + cx]);
  hs.sort((a, b) => a - b);
  const h = hs[hs.length >> 1];
  for (let d = 0; d <= h; d++) {
    for (let cy = y0 - d; cy <= y0 + S + d; cy++) {
      for (let cx = x0 - d; cx <= x0 + S + d; cx++) {
        if (cx < 0 || cy < 0 || cx >= cs || cy >= cs) continue;
        const ring = Math.max(x0 - cx, cx - (x0 + S), y0 - cy, cy - (y0 + S), 0);
        if (ring !== d || touchesWater(cx, cy)) continue;
        const ci = cy * cs + cx;
        if (d === 0) elev[ci] = h;
        else if (elev[ci] < h - d) elev[ci] = h - d;
      }
    }
  }
  relaxSlopes(elev, cs);
}

/**
 * Lays out a demo town with an organic outline: a blob around the centre of
 * the most land-rich window, streets at irregular spacing, shops in the
 * middle, homes around, industry on the far side, a railway, services and
 * parks scattered, and a few blocks left as open land.
 */
export function buildDemoCity(city: City, opts: DemoOptions = {}): DemoArea {
  const S = opts.size ?? 60;
  const mode = opts.mode ?? 'mixed';
  const seed = city.seed;
  // the demo must stay readable and repeatable: no random disasters (the menu still works)
  city.randomDisasters = false;

  let best: DemoArea = { x: 0, y: 0, size: S, land: -1 };
  for (let y = 0; y + S <= city.size; y += 4) {
    for (let x = 0; x + S <= city.size; x += 4) {
      let land = 0;
      for (let yy = y; yy < y + S; yy++) {
        for (let xx = x; xx < x + S; xx++) {
          if (city.terrain[city.idx(xx, yy)] === Terrain.Land) land++;
        }
      }
      if (land > best.land) best = { x, y, size: S, land };
    }
  }
  const { x: bx, y: by } = best;
  flattenArea(city, bx, by, S);

  const cx = bx + S / 2, cy = by + S / 2, R = S / 2 - 2;
  const noise = (k: number) => (hash2(seed, k, 77) / 4294967296) * 2 - 1;
  const radiusAt = (a: number) => R * (0.74 + 0.14 * Math.sin(3 * a + noise(1) * 3) + 0.1 * Math.cos(5 * a + noise(2) * 3) + 0.05 * Math.sin(8 * a));
  const inside = (x: number, y: number): boolean => {
    if (!city.inBounds(x, y) || city.terrain[city.idx(x, y)] !== Terrain.Land || !city.isFlat(x, y)) return false;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    return Math.hypot(dx, dy) < radiusAt(Math.atan2(dy, dx));
  };
  const polar = (x: number, y: number) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    return { d: Math.hypot(dx, dy) / R, a: Math.atan2(dy, dx) };
  };

  const savedMoney = city.money;
  city.money = 1e9;
  const apply = (tool: Tool, from: { x: number; y: number }, to = from) => applyPlan(city, planTool(city, tool, from, to));

  // streets: rows and columns at 4/5/4/3 spacing, clipped to the blob
  const rows: number[] = [], cols: number[] = [];
  const pattern = [4, 5, 4, 3, 5, 4];
  for (let y = by + 1, k = 0; y < by + S; y += pattern[k++ % pattern.length]) rows.push(y);
  for (let x = bx + 2, k = 2; x < bx + S; x += pattern[k++ % pattern.length]) cols.push(x);
  for (const y of rows) for (let x = bx; x < bx + S; x++) if (inside(x, y)) apply('road', { x, y });
  for (const x of cols) for (let y = by; y < by + S; y++) if (inside(x, y)) apply('road', { x, y });

  // a railway on its own line, two blocks below the centre, and stations against it
  // rail two rows below a street whose block is 5 deep: a row of zones stays between
  // street and rail (power hops across one tile only), and a 2x2 station fits below the rail
  const tallRows = rows.filter((r, k) => k + 1 < rows.length && rows[k + 1] - r === 5);
  const railBase = (tallRows.length ? tallRows : rows).reduce((b, r) => Math.abs(r - (cy + 6)) < Math.abs(b - (cy + 6)) ? r : b);
  const railRow = railBase + 2;
  if (!opts.bare) {
    // one plan per continuous run, so the track goes straight across the streets (level crossings)
    for (let x = bx; x < bx + S; x++) {
      if (!inside(x, railRow)) continue;
      let x1 = x;
      while (x1 + 1 < bx + S && inside(x1 + 1, railRow)) x1++;
      apply('rail', { x, y: railRow }, { x: x1, y: railRow });
      x = x1;
    }
  }

  // structures placed near preferred spots, before zoning, on free land
  const place = (type: StructType, px: number, py: number, maxR = 9): boolean => {
    const n = STRUCTS[type].size;
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const ox = Math.round(px) + dx, oy = Math.round(py) + dy;
          let ok = true;
          for (let yy = oy; yy < oy + n && ok; yy++) for (let xx = ox; xx < ox + n; xx++) {
            if (!inside(xx, yy) || city.overlay[city.idx(xx, yy)] > Overlay.Tree || city.rail[city.idx(xx, yy)]) { ok = false; break; }
          }
          if (!ok) continue;
          const p = planTool(city, type, { x: ox, y: oy }, { x: ox, y: oy });
          if (p.valid) { applyPlan(city, p); return true; }
        }
      }
    }
    return false;
  };
  const at = (d: number, a: number) => ({ x: cx + Math.cos(a) * R * d, y: cy + Math.sin(a) * R * d });
  const DOWN = Math.PI / 2; // industry faces the bottom of the screen
  if (!opts.bare && mode === 'mixed') {
    for (const k of [-0.5, 0.15, 0.7]) { const p = at(0.78, DOWN + k); place('coal', p.x, p.y); }
    { const p = at(0.7, DOWN - 0.9); place('gas', p.x, p.y); }
    for (let k = 0; k < 6; k++) { const p = at(0.48, k * Math.PI / 3 + 0.3); place('tower', p.x, p.y); }
    place('tower', cx, cy - 4);
    for (let k = 0; k < 3; k++) { const p = at(0.36, k * 2.1 + 0.8); place('police', p.x, p.y); }
    for (let k = 0; k < 3; k++) { const p = at(0.55, k * 2.1 + 1.9); place('fire', p.x, p.y); }
    for (let k = 0; k < 3; k++) { const p = at(0.42, k * 2.1 + 3.0); place('school', p.x, p.y); }
    for (let k = 0; k < 2; k++) { const p = at(0.22, k * Math.PI + 2.3); place('hospital', p.x, p.y); }
    for (let k = 0; k < 4; k++) { const p = at(0.58, k * Math.PI / 2 + 0.4); place('bigpark', p.x, p.y); }
    for (let k = 0; k < 6; k++) { const p = at(0.3 + 0.35 * (k % 3) / 2, k * 1.05 + 0.5); place('park', p.x, p.y, 5); }
    { const p = at(0.16, -1.2); place('bus', p.x, p.y); }
    let stations = 0, lastX = -99;
    for (let sx = Math.floor(cx - R * 0.6); sx < cx + R * 0.6 && stations < 2; sx++) {
      if (sx - lastX < 12) continue;
      const p = planTool(city, 'station', { x: sx, y: railRow + 1 }, { x: sx, y: railRow + 1 });
      if (p.valid) { applyPlan(city, p); stations++; lastX = sx; }
    }
  } else if (!opts.bare) {
    for (const k of [-0.5, 0.15, 0.7]) { const p = at(0.78, DOWN + k); place('coal', p.x, p.y); }
    for (let k = 0; k < 6; k++) { const p = at(0.48, k * Math.PI / 3 + 0.3); place('tower', p.x, p.y); }
  }

  // zoning, decided per block from its centre; some blocks stay open land
  const edgesY = [by, ...rows, by + S], edgesX = [bx, ...cols, bx + S];
  for (let j = 0; j + 1 < edgesY.length; j++) {
    for (let i = 0; i + 1 < edgesX.length; i++) {
      const x0 = edgesX[i] + (i ? 1 : 0), x1 = edgesX[i + 1];
      const y0 = edgesY[j] + (j ? 1 : 0), y1 = edgesY[j + 1];
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const { d, a } = polar((x0 + x1) / 2, (y0 + y1) / 2);
      const h = hash2(i, j, seed);
      let tool: Tool;
      if (mode === 'res-only') tool = 'res';
      else if (d < 0.3) tool = 'com';
      else if (d > 0.4 && Math.abs(((a - DOWN + Math.PI) % (2 * Math.PI)) - Math.PI) < 0.8) tool = 'ind';
      else if ((h & 15) === 0) continue; // an open block now and then
      else tool = (h & 15) === 1 && d > 0.3 ? 'com' : 'res';
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (inside(x, y) && city.overlay[city.idx(x, y)] <= Overlay.Tree && !city.rail[city.idx(x, y)]) apply(tool, { x, y });
        }
      }
    }
  }
  // one power line along a street, to exercise the wire sprites
  if (!opts.bare && rows.length > 2) {
    const wy = rows[1];
    for (let x = bx; x < bx + S; x++) if (city.isRoad(x, wy)) apply('wire', { x, y: wy });
  }

  city.money = savedMoney;
  recomputeRoadDist(city);
  refreshGrid(city);
  computeStats(city);

  const ticks = (opts.years ?? 0) * 12 * TICKS_PER_MONTH;
  for (let t = 0; t < ticks; t++) tick(city);

  if (opts.showcase) forceShowcase(city, cx, cy, R, polar);
  return best;
}

/** Forces a few dense buildings near the centre and an airport and a port on the edges. */
function forceShowcase(city: City, cx: number, cy: number, R: number, polar: (x: number, y: number) => { d: number; a: number }): void {
  const square = (zone: number, size: number, x: number, y: number): boolean => {
    for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) {
      if (!city.inBounds(xx, yy)) return false;
      const i = city.idx(xx, yy);
      if (city.overlay[i] !== zone || city.bldId[i]) return false;
    }
    return true;
  };
  const wanted: [number, number, number, number][] = [[Overlay.Com, 3, 5, 2], [Overlay.Res, 3, 5, 1], [Overlay.Res, 2, 5, 2], [Overlay.Com, 2, 5, 1], [Overlay.Ind, 3, 5, 1], [Overlay.Ind, 2, 4, 1], [Overlay.Res, 2, 4, 2]];
  for (const [zone, size, level, count] of wanted) {
    let done = 0;
    const cands: { x: number; y: number; d: number }[] = [];
    for (let y = Math.floor(cy - R); y < cy + R && done < count; y++) {
      for (let x = Math.floor(cx - R); x < cx + R; x++) {
        if (square(zone, size, x, y)) cands.push({ x, y, d: polar(x + size / 2, y + size / 2).d });
      }
    }
    cands.sort((p, q) => p.d - q.d);
    for (const c of cands) {
      if (done >= count) break;
      if (!square(zone, size, c.x, c.y)) continue;
      city.addBuilding(zone as 3 | 4 | 5, size, c.x, c.y, level);
      done++;
    }
  }
  city.money += 1e6;
  outer: for (let y = Math.floor(cy - R); y < cy + R; y++) {
    for (let x = Math.floor(cx - R); x < cx + R; x++) {
      if (polar(x + 2, y + 2).d < 0.62) continue;
      let ok = true;
      for (let yy = y; yy < y + 4 && ok; yy++) for (let xx = x; xx < x + 4; xx++) {
        if (!city.inBounds(xx, yy) || city.overlay[city.idx(xx, yy)] === Overlay.Struct || city.overlay[city.idx(xx, yy)] === Overlay.Road || !city.isFlat(xx, yy)) { ok = false; break; }
      }
      if (!ok) continue;
      applyPlan(city, planTool(city, 'bulldoze', { x, y }, { x: x + 3, y: y + 3 }));
      const p = planTool(city, 'airport', { x, y }, { x, y });
      if (p.valid) { applyPlan(city, p); break outer; }
    }
  }
  outer2: for (let y = 0; y < city.size - 3; y++) {
    for (let x = 0; x < city.size - 3; x++) {
      const p = planTool(city, 'port', { x, y }, { x, y });
      if (p.valid) { applyPlan(city, p); break outer2; }
    }
  }
  city.money -= 1e6;
  refreshGrid(city);
}
