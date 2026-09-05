import { t } from '../i18n';
import type { City } from './city';
import { COST, MAX_ELEV, Overlay, Terrain } from './types';

export interface TerraformPlan {
  /** corner index -> new height */
  changes: Map<number, number>;
  /** tiles whose shape changes (for the preview) */
  tiles: number[];
  cost: number;
  valid: boolean;
  reason?: string;
}

/** Raise (+1) or lower (-1) the four corners of a tile. */
export function planRaise(city: City, x: number, y: number, dir: 1 | -1): TerraformPlan {
  const cs = city.size + 1;
  const changes = new Map<number, number>();
  for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) {
    const ci = cy * cs + cx;
    const h = city.elev[ci] + dir;
    if (h < 0 || h > MAX_ELEV) return invalid(t(dir > 0 ? 'reason.terraMax' : 'reason.terraMin'));
    changes.set(ci, h);
  }
  return finish(city, changes);
}

/** Bring every corner of a rectangle of tiles to height `h`. */
export function planLevel(city: City, x0: number, y0: number, x1: number, y1: number, h: number): TerraformPlan {
  const cs = city.size + 1;
  const changes = new Map<number, number>();
  for (let cy = Math.min(y0, y1); cy <= Math.max(y0, y1) + 1; cy++) {
    for (let cx = Math.min(x0, x1); cx <= Math.max(x0, x1) + 1; cx++) {
      if (cx < 0 || cy < 0 || cx >= cs || cy >= cs) continue;
      const ci = cy * cs + cx;
      if (city.elev[ci] !== h) changes.set(ci, h);
    }
  }
  return finish(city, changes);
}

function invalid(reason: string): TerraformPlan {
  return { changes: new Map(), tiles: [], cost: 0, valid: false, reason };
}

/** Propagates the one-level rule outward, then checks what the change would disturb. */
function finish(city: City, changes: Map<number, number>): TerraformPlan {
  const cs = city.size + 1;
  const h = (ci: number) => changes.get(ci) ?? city.elev[ci];
  const queue = [...changes.keys()];
  let steps = 0;
  while (queue.length) {
    if (++steps > 200000) return invalid(t('reason.terraTooBig'));
    const ci = queue.pop()!;
    const hc = h(ci);
    const cx = ci % cs;
    const nbs = [cx > 0 ? ci - 1 : -1, cx < cs - 1 ? ci + 1 : -1, ci >= cs ? ci - cs : -1, ci + cs < cs * cs ? ci + cs : -1];
    for (const n of nbs) {
      if (n < 0) continue;
      const hn = h(n);
      if (hn < hc - 1) { changes.set(n, hc - 1); queue.push(n); }
      else if (hn > hc + 1) { changes.set(n, hc + 1); queue.push(n); }
    }
  }
  for (const [ci, nh] of [...changes]) if (nh === city.elev[ci]) changes.delete(ci);
  if (changes.size === 0) return invalid(t('reason.terraNone'));

  const tiles = new Set<number>();
  for (const ci of changes.keys()) {
    const cx = ci % cs, cy = (ci - cx) / cs;
    for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
      if (city.inBounds(tx, ty)) tiles.add(city.idx(tx, ty));
    }
  }
  for (const i of tiles) {
    if (city.terrain[i] === Terrain.Water) return invalid(t('reason.terraShore'));
    const o = city.overlay[i];
    if (o !== Overlay.None && o !== Overlay.Tree && o !== Overlay.Road) return invalid(t('reason.occupied'));
  }
  return { changes, tiles: [...tiles], cost: changes.size * COST.terraform, valid: true };
}

export function applyTerraform(city: City, plan: TerraformPlan): void {
  for (const [ci, nh] of plan.changes) city.elev[ci] = nh;
}
