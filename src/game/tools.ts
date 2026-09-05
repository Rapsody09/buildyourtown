import type { City } from './city';
import { t } from '../i18n';
import { STRUCTS, isStructTool, structName } from './structs';
import { touchesWater } from './sim';
import { applyTerraform, planLevel, planRaise, type TerraformPlan } from './terraform';
import { COST, Overlay, Terrain, ZONE_OF_TOOL, isZone, type Tool } from './types';

const LINE_TOOLS: Tool[] = ['road', 'rail', 'highway', 'wire'];

export interface Pt {
  x: number;
  y: number;
}

export interface ToolPlan {
  tool: Tool;
  /** tile indices that will actually change */
  tiles: number[];
  cost: number;
  /** structure placement only: footprint tiles and whether the spot is valid */
  footprint?: number[];
  terra?: TerraformPlan;
  valid: boolean;
  reason?: string;
}

const FLAT_REASON = () => t('reason.flat');

/** Computes what a drag from `from` to `to` would do with the given tool. */
export function planTool(city: City, tool: Tool, from: Pt, to: Pt): ToolPlan {
  if (isStructTool(tool)) return planStruct(city, tool, to);
  if (tool === 'raise' || tool === 'lower' || tool === 'level') return planTerraform(city, tool, from, to);
  const candidates = LINE_TOOLS.includes(tool) ? lPath(from, to) : rect(from, to);
  const tiles: number[] = [];
  let cost = 0;
  let sloped = 0;
  for (let k = 0; k < candidates.length; k++) {
    const p = candidates[k];
    if (!city.inBounds(p.x, p.y)) continue;
    const i = city.idx(p.x, p.y);
    if (!canApply(city, tool, i)) {
      if (ZONE_OF_TOOL[tool] !== undefined && city.terrain[i] === Terrain.Land && !city.isFlat(p.x, p.y)) sloped++;
      continue;
    }
    if ((tool === 'rail' || tool === 'road') && !crossingOk(city, tool, candidates, k)) continue;
    tiles.push(i);
    cost += tileCost(city, tool, i);
  }
  const valid = tiles.length > 0;
  return { tool, tiles, cost, valid, reason: !valid && sloped ? FLAT_REASON() : undefined };
}

function planTerraform(city: City, tool: 'raise' | 'lower' | 'level', from: Pt, to: Pt): ToolPlan {
  if (!city.inBounds(to.x, to.y) || !city.inBounds(from.x, from.y)) return { tool, tiles: [], cost: 0, valid: false, reason: t('reason.offmap') };
  const terra = tool === 'level'
    ? planLevel(city, from.x, from.y, to.x, to.y, city.base(from.x, from.y))
    : planRaise(city, to.x, to.y, tool === 'raise' ? 1 : -1);
  return { tool, tiles: terra.tiles, cost: terra.cost, terra, valid: terra.valid, reason: terra.reason };
}

function planStruct(city: City, tool: Tool & keyof typeof STRUCTS, at: Pt): ToolPlan {
  const def = STRUCTS[tool];
  const n = def.size;
  const footprint: number[] = [];
  let valid = true;
  let reason: string | undefined;
  if (def.unlockPop && city.maxPop < def.unlockPop) {
    valid = false;
    reason = t('reason.locked', { pop: def.unlockPop.toLocaleString() });
  }
  const h = city.inBounds(at.x, at.y) ? city.base(at.x, at.y) : 0;
  for (let yy = at.y; yy < at.y + n; yy++) {
    for (let xx = at.x; xx < at.x + n; xx++) {
      if (!city.inBounds(xx, yy)) { valid = false; reason = t('reason.offmap'); continue; }
      const i = city.idx(xx, yy);
      footprint.push(i);
      const o = city.overlay[i] as Overlay;
      if (city.terrain[i] !== Terrain.Land || city.wire[i] || city.rail[i] || city.flood[i] || (o !== Overlay.None && o !== Overlay.Tree)) {
        valid = false;
        reason = reason ?? t('reason.occupied');
      } else if (!city.isFlat(xx, yy) || city.base(xx, yy) !== h) {
        valid = false;
        reason = reason ?? FLAT_REASON();
      }
    }
  }
  if (valid && def.needsShore && !touchesWater(city, at.x, at.y, n)) {
    valid = false;
    reason = t('reason.shore', { name: structName(tool) });
  }
  if (valid && tool === 'station') {
    let railOk = false, roadOk = false;
    for (let yy = at.y - 1; yy <= at.y + n; yy++) {
      for (let xx = at.x - 1; xx <= at.x + n; xx++) {
        const inside = xx >= at.x && xx < at.x + n && yy >= at.y && yy < at.y + n;
        if (inside || !city.inBounds(xx, yy)) continue;
        if (city.hasRail(xx, yy)) railOk = true;
        if (city.isRoad(xx, yy)) roadOk = true;
      }
    }
    if (!railOk || !roadOk) { valid = false; reason = t('reason.station'); }
  }
  return { tool, tiles: valid ? footprint : [], cost: def.cost, footprint, valid, reason };
}

/**
 * A railway may cross a road (and a road a railway) only at a level crossing:
 * the existing way runs straight through the tile and the new one goes
 * straight across it. No track laid along a street, no crossing on a bend.
 */
function crossingOk(city: City, tool: 'rail' | 'road', path: Pt[], k: number): boolean {
  const p = path[k];
  const i = city.idx(p.x, p.y);
  const onRoad = tool === 'rail' && city.overlay[i] === Overlay.Road;
  const onRail = tool === 'road' && city.rail[i] === 1;
  if (!onRoad && !onRail) return true;
  const isRoad = (x: number, y: number) => city.inBounds(x, y) && city.overlay[city.idx(x, y)] === Overlay.Road;
  const isRail = (x: number, y: number) => city.inBounds(x, y) && city.rail[city.idx(x, y)] === 1;
  const way = onRoad ? isRoad : isRail;
  // the way already there: continues on both sides along one axis, nothing on the other
  const wayX = way(p.x - 1, p.y) && way(p.x + 1, p.y) && !way(p.x, p.y - 1) && !way(p.x, p.y + 1);
  const wayY = way(p.x, p.y - 1) && way(p.x, p.y + 1) && !way(p.x - 1, p.y) && !way(p.x + 1, p.y);
  if (!wayX && !wayY) return false;
  // the new line: goes straight through along the other axis, via the plan or what is already built
  const mine = onRoad ? isRail : isRoad;
  const inPlan = (x: number, y: number) => (k > 0 && path[k - 1].x === x && path[k - 1].y === y)
    || (k + 1 < path.length && path[k + 1].x === x && path[k + 1].y === y);
  const link = (x: number, y: number) => inPlan(x, y) || mine(x, y);
  return wayX
    ? link(p.x, p.y - 1) && link(p.x, p.y + 1) && !link(p.x - 1, p.y) && !link(p.x + 1, p.y)
    : link(p.x - 1, p.y) && link(p.x + 1, p.y) && !link(p.x, p.y - 1) && !link(p.x, p.y + 1);
}

function tileCost(city: City, tool: Tool, i: number): number {
  const water = city.terrain[i] === Terrain.Water;
  if (tool === 'road') return water ? COST.bridge : COST.road;
  if (tool === 'rail') return water ? COST.railBridge : COST.rail;
  if (tool === 'highway') return water ? COST.highwayBridge : COST.highway;
  if (tool === 'wire') return water ? COST.wireWater : COST.wire;
  return unitCost(tool);
}

export function unitCost(tool: Tool): number {
  switch (tool) {
    case 'road': return COST.road;
    case 'rail': return COST.rail;
    case 'highway': return COST.highway;
    case 'wire': return COST.wire;
    case 'res': case 'com': case 'ind': return COST.zone;
    case 'bulldoze': return COST.bulldoze;
    default: return isStructTool(tool) ? STRUCTS[tool].cost : 0;
  }
}

function canApply(city: City, tool: Tool, i: number): boolean {
  const o = city.overlay[i] as Overlay;
  if (tool === 'bulldoze') return o !== Overlay.None || city.wire[i] === 1 || city.rail[i] === 1;
  if (o === Overlay.Rubble || city.flood[i]) return false;
  if (city.terrain[i] !== Terrain.Land) {
    // bridges: roads and highways on open water, rail on open water or over a road bridge, pylons in water
    if (tool === 'rail') return city.rail[i] === 0 && (o === Overlay.None || o === Overlay.Road);
    if (tool === 'wire') return city.wire[i] === 0 && o === Overlay.None;
    return (tool === 'road' || tool === 'highway') && o === Overlay.None;
  }
  if (tool === 'wire') return city.wire[i] === 0 && (o === Overlay.None || o === Overlay.Tree || o === Overlay.Road);
  if (tool === 'rail') return city.rail[i] === 0 && (o === Overlay.None || o === Overlay.Tree || o === Overlay.Road);
  const buildable = o === Overlay.None || o === Overlay.Tree || (isZone(o) && city.level[i] === 0);
  if (tool === 'road') return o !== Overlay.Road && buildable;
  if (tool === 'highway') return buildable && city.rail[i] === 0;
  const zone = ZONE_OF_TOOL[tool];
  if (zone === undefined) return false;
  return o !== zone && buildable && city.wire[i] === 0 && city.rail[i] === 0 && city.isFlatIdx(i);
}

export type ApplyResult = { ok: true; cost: number } | { ok: false; reason: string };

export function applyPlan(city: City, plan: ToolPlan): ApplyResult {
  if (!plan.valid || plan.tiles.length === 0) return { ok: false, reason: plan.reason ?? t('reason.nothing') };
  if (city.money < plan.cost) return { ok: false, reason: t('reason.funds') };

  if (isStructTool(plan.tool)) {
    const origin = plan.tiles[0];
    city.addStruct(plan.tool, origin % city.size, Math.floor(origin / city.size));
    city.money -= plan.cost;
    return { ok: true, cost: plan.cost };
  }
  if (plan.terra) {
    applyTerraform(city, plan.terra);
    city.money -= plan.cost;
    return { ok: true, cost: plan.cost };
  }

  for (const i of plan.tiles) {
    const before = city.overlay[i];
    switch (plan.tool) {
      case 'road':
        city.overlay[i] = Overlay.Road;
        city.level[i] = 0;
        break;
      case 'highway':
        city.overlay[i] = Overlay.Highway;
        city.level[i] = 0;
        city.wire[i] = 0;
        break;
      case 'rail':
        city.rail[i] = 1;
        if (before === Overlay.Tree) city.overlay[i] = Overlay.None;
        break;
      case 'wire':
        city.wire[i] = 1;
        if (before === Overlay.Tree) city.overlay[i] = Overlay.None;
        break;
      case 'bulldoze': {
        const s = city.structAt(i);
        if (s) city.removeStruct(s);
        const b = city.buildingAt(i);
        if (b) city.removeBuilding(b, 0); // the whole building goes, the zoning stays
        else {
          city.overlay[i] = Overlay.None;
          city.level[i] = 0;
        }
        city.wire[i] = 0;
        city.rail[i] = 0;
        break;
      }
      default: {
        const zone = ZONE_OF_TOOL[plan.tool];
        if (zone !== undefined) city.overlay[i] = zone;
        city.level[i] = 0;
      }
    }
    if (before === Overlay.Road || city.overlay[i] === Overlay.Road || plan.tool === 'rail' || plan.tool === 'highway') city.roadsDirty = true;
  }
  city.gridDirty = true;
  city.money -= plan.cost;
  return { ok: true, cost: plan.cost };
}

/** Horizontal then vertical segment: the classic L-shaped drag for roads and lines. */
function lPath(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  for (let x = a.x; x !== b.x; x += sx) out.push({ x, y: a.y });
  for (let y = a.y; y !== b.y; y += sy) out.push({ x: b.x, y });
  out.push({ x: b.x, y: b.y });
  return out;
}

function rect(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}
