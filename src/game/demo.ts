import type { City } from './city';
import { relaxSlopes } from './terrain';
import { computeStats, recomputeRoadDist, refreshGrid, tick } from './sim';
import { applyPlan, planTool } from './tools';
import { Overlay, TICKS_PER_MONTH, Terrain, type StructType, type Tool } from './types';

export interface DemoOptions {
  /** side of the square area to urbanise */
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
  // plateau, then a raised apron around it so the edge is a gentle slope;
  // corners shared with water stay at sea level and relaxSlopes settles the rest
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

/** 3x3 blocks (grid coordinates) reserved for structures in a 10x10 block grid. */
const BLOCK_STRUCTS: Record<string, StructType> = {
  '0,9': 'coal', '9,9': 'coal', '9,8': 'coal',
  '1,1': 'tower', '5,1': 'tower', '8,1': 'tower', '1,5': 'tower', '5,5': 'tower', '8,5': 'tower', '1,8': 'tower', '5,8': 'tower', '8,8': 'tower',
  '2,2': 'police', '7,2': 'police', '4,6': 'police',
  '2,6': 'fire', '7,6': 'fire',
  '3,1': 'school', '6,7': 'school',
  '5,3': 'hospital',
  '1,4': 'bigpark', '8,4': 'bigpark', '4,3': 'bigpark',
  '5,2': 'bus', '2,5': 'station', '6,5': 'station',
};

/** Industry along the bottom rows, commerce in the middle, housing elsewhere. */
function blockZone(gx: number, gy: number): 'res' | 'com' | 'ind' {
  if (gy >= 8) return 'ind';
  if ((gy === 4 || gy === 5) && gx >= 3 && gx <= 6) return 'com';
  if ((gy === 3 || gy === 6) && (gx === 4 || gx === 5)) return 'com';
  return 'res';
}

/**
 * Lays out a grid city (roads every 4 tiles, 3x3 blocks of zones or
 * structures) on the most land-rich window of the map.
 */
export function buildDemoCity(city: City, opts: DemoOptions = {}): DemoArea {
  const S = opts.size ?? 40;
  const mode = opts.mode ?? 'mixed';

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

  const savedMoney = city.money;
  city.money = 1e9;
  const { x: bx, y: by } = best;
  const pending: StructType[] = [];
  flattenArea(city, bx, by, S);
  for (let k = 0; k <= S; k += 4) {
    applyPlan(city, planTool(city, 'road', { x: bx + k, y: by }, { x: bx + k, y: by + S }));
    applyPlan(city, planTool(city, 'road', { x: bx, y: by + k }, { x: bx + S, y: by + k }));
  }
  // a power line along one avenue and a railway along another, mostly to exercise the sprites
  if (!opts.bare) {
    applyPlan(city, planTool(city, 'wire', { x: bx, y: by + 8 }, { x: bx + S, y: by + 8 }));
    applyPlan(city, planTool(city, 'rail', { x: bx, y: by + 24 }, { x: bx + S, y: by + 24 }));
  }
  for (let gy = 0; gy < S / 4; gy++) {
    for (let gx = 0; gx < S / 4; gx++) {
      const from = { x: bx + gx * 4 + 1, y: by + gy * 4 + 1 };
      const st = opts.bare ? undefined : BLOCK_STRUCTS[`${gx},${gy}`];
      let tool: Tool = mode === 'res-only' ? 'res' : blockZone(gx, gy);
      if (st) {
        // clear trees first, then place; the structure is queued if the spot is unusable
        applyPlan(city, planTool(city, 'bulldoze', from, { x: from.x + 2, y: from.y + 2 }));
        // stations sit in the lower corner of their block so they touch the railway avenue
        const at = st === 'station' ? { x: from.x + 1, y: from.y + 1 } : from;
        const p = planTool(city, st, at, at);
        if (p.valid) { applyPlan(city, p); continue; }
        pending.push(st);
        tool = 'res';
      }
      applyPlan(city, planTool(city, tool, from, { x: from.x + 2, y: from.y + 2 }));
    }
  }
  // structures that did not fit take over the first usable zone block instead
  for (const st of pending) {
    outer: for (let gy = 0; gy < S / 4; gy++) {
      for (let gx = 0; gx < S / 4; gx++) {
        const from = { x: bx + gx * 4 + 1, y: by + gy * 4 + 1 };
        const to = { x: from.x + 2, y: from.y + 2 };
        const i = city.idx(from.x, from.y);
        const o = city.overlay[i];
        if (o === Overlay.Struct) continue;
        const zoneTool: Tool | null = o === Overlay.Res ? 'res' : o === Overlay.Com ? 'com' : o === Overlay.Ind ? 'ind' : null;
        applyPlan(city, planTool(city, 'bulldoze', from, to));
        const p = planTool(city, st, from, from);
        if (p.valid) { applyPlan(city, p); break outer; }
        if (zoneTool) applyPlan(city, planTool(city, zoneTool, from, to)); // put the zoning back
      }
    }
  }
  city.money = savedMoney;
  recomputeRoadDist(city);
  refreshGrid(city);
  computeStats(city);

  const ticks = (opts.years ?? 0) * 12 * TICKS_PER_MONTH;
  for (let t = 0; t < ticks; t++) tick(city);

  if (opts.showcase) {
    const force = (gx: number, gy: number, size: number, level: number) => {
      const x = bx + gx * 4 + 1, y = by + gy * 4 + 1;
      const zone = city.overlay[city.idx(x, y)];
      if (zone < Overlay.Res || zone > Overlay.Ind) return;
      for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) {
        if (city.overlay[city.idx(xx, yy)] !== zone) return;
      }
      city.addBuilding(zone as 3 | 4 | 5, size, x, y, level);
    };
    force(1, 2, 3, 5); force(2, 3, 2, 5); force(0, 3, 2, 4);
    force(4, 4, 3, 5); force(5, 5, 2, 5); force(3, 4, 2, 4);
    force(2, 8, 3, 5); force(4, 8, 2, 5); force(6, 8, 2, 4);
    // an airport on the first 2x2 group of plain zone blocks, and a port on the first usable shore
    airport: for (let gy = 0; gy < S / 4 - 1; gy++) {
      for (let gx = 0; gx < S / 4 - 1; gx++) {
        const x = bx + gx * 4 + 1, y = by + gy * 4 + 1;
        let plain = true;
        for (let yy = y; yy < y + 7 && plain; yy++) {
          for (let xx = x; xx < x + 7; xx++) {
            const o = city.overlay[city.idx(xx, yy)];
            if (o === Overlay.Struct || !city.isFlat(xx, yy)) { plain = false; break; }
          }
        }
        if (!plain) continue;
        applyPlan(city, planTool(city, 'bulldoze', { x, y }, { x: x + 6, y: y + 6 }));
        const p = planTool(city, 'airport', { x, y }, { x, y });
        if (p.valid) { applyPlan(city, p); break airport; }
      }
    }
    outer: for (let y = 0; y < city.size - 3; y++) {
      for (let x = 0; x < city.size - 3; x++) {
        const p = planTool(city, 'port', { x, y }, { x, y });
        if (p.valid) { applyPlan(city, p); break outer; }
      }
    }
    refreshGrid(city);
  }
  return best;
}
