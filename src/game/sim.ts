import { budgetExpenses, budgetIncome, emptyBudget, type City } from './city';
import { disasterMonth, disasterTick } from './disasters';
import { t } from '../i18n';
import { STRUCTS, structName } from './structs';
import {
  BOND_AMOUNT, COST, DEPTS, HIGHWAY_CAPACITY, JOBS_C_PER_LEVEL, JOBS_I_PER_LEVEL, MAX_LEVEL, MAX_TRIP, NO_ROAD, ORDINANCES, ORDINANCE_KEYS, Overlay, POP_PER_LEVEL, POWER_USE, ROAD_CAPACITY, ROAD_REACH, START_YEAR, TICKS_PER_MONTH, Terrain, isZone, type ZoneType,
} from './types';

const MILESTONES = [1000, 2500, 5000, 10000, 25000, 50000, 100000];

/** Growth gets harder as density rises (index = current level). */
const GROW_FACTOR = [1, 0.8, 0.6, 0.45, 0.3];
const BASE_GROW = 0.012;
const BASE_DECAY = 0.003;
/** unpowered or disconnected buildings empty out at this rate per tick (slow: the mayor gets months to repair) */
const ABANDON = 0.004;

export interface TickResult {
  monthEnded: boolean;
  messages: string[];
}

export function tick(city: City): TickResult {
  disasterTick(city);
  if (city.roadsDirty) recomputeRoadDist(city);
  if (city.gridDirty) refreshGrid(city);
  growthPass(city);

  city.tickInMonth++;
  if (city.tickInMonth < TICKS_PER_MONTH) return { monthEnded: false, messages: [] };
  city.tickInMonth = 0;
  return { monthEnded: true, messages: endMonth(city) };
}

/** Everything that depends on the placement of wires, zones and structures. */
export function refreshGrid(city: City): void {
  recomputePower(city);
  recomputeWater(city);
  recomputeCoverage(city);
  recomputeTraffic(city);
  city.gridDirty = false;
}

/** density cap from land value, residential and commercial only */
function landValueCap(lv: number): number {
  return lv < 30 ? 2 : lv < 60 ? 3 : lv < 100 ? 4 : 5;
}

/** true when the tile may host density `target` (land value, water, pollution) */
function tileAllows(city: City, i: number, o: ZoneType, target: number): boolean {
  if (target > 2 && !city.watered[i]) return false;
  if (o !== Overlay.Ind && target > landValueCap(city.landValue[i])) return false;
  if (o === Overlay.Res && target > 2 && city.pollution[i] > 90) return false;
  return true;
}

/**
 * Tries to merge the tiles around `i` into a size x size building at level
 * `target` (2x2 at level 4, 3x3 at level 5). Existing smaller buildings fully
 * inside the square are absorbed.
 */
function tryMerge(city: City, i: number, o: ZoneType, target: number): boolean {
  const size = target === 4 ? 2 : 3;
  const { overlay, level, roadDist, powered, bldId } = city;
  const x = i % city.size, y = (i - x) / city.size;
  const h = city.base(x, y);
  for (let oy = y - size + 1; oy <= y; oy++) {
    for (let ox = x - size + 1; ox <= x; ox++) {
      if (!city.inBounds(ox, oy) || !city.inBounds(ox + size - 1, oy + size - 1)) continue;
      let ok = true;
      let hasRoad = false;
      for (let yy = oy; yy < oy + size && ok; yy++) {
        for (let xx = ox; xx < ox + size; xx++) {
          const j = city.idx(xx, yy);
          if (overlay[j] !== o || level[j] < target - 1 || !powered[j] || !city.isFlat(xx, yy) || city.base(xx, yy) !== h) { ok = false; break; }
          if (!tileAllows(city, j, o, target)) { ok = false; break; }
          const b = bldId[j] ? city.buildings.get(bldId[j]) : undefined;
          if (b && (b.size >= size || b.x < ox || b.y < oy || b.x + b.size > ox + size || b.y + b.size > oy + size)) { ok = false; break; }
          if (roadDist[j] !== NO_ROAD && city.access[j]) hasRoad = true;
        }
      }
      if (!ok || !hasRoad) continue;
      city.addBuilding(o, size, ox, oy, target);
      city.builtAt[city.idx(ox, oy)] = city.year * 12 + city.month;
      return true;
    }
  }
  return false;
}

function growthPass(city: City): void {
  const { overlay, level, roadDist, powered, landValue, crime, demand, rng, bldId, access } = city;
  for (let i = 0; i < city.count; i++) {
    const o = overlay[i] as Overlay;
    if (!isZone(o)) continue;
    const b = bldId[i] ? city.buildings.get(bldId[i]) : undefined;
    if (b && city.idx(b.x, b.y) !== i) continue; // a merged building is handled once, at its origin
    if (city.fire[i] || city.flood[i]) continue;
    const lvl = level[i];

    if (roadDist[i] === NO_ROAD || !access[i] || !powered[i]) {
      if (lvl > 0 && rng() < ABANDON) {
        if (b) city.removeBuilding(b, lvl - 1);
        else level[i] = lvl - 1;
      }
      continue;
    }

    const d = o === Overlay.Res ? demand.r : o === Overlay.Com ? demand.c : demand.i;
    let cap = MAX_LEVEL;
    while (cap > 0 && !tileAllows(city, i, o, cap)) cap--;

    if (d > 0 && lvl < cap) {
      // any positive demand builds at a decent pace; strong demand builds faster
      let p = BASE_GROW * (0.25 + d) * GROW_FACTOR[lvl];
      p *= 0.6 + (landValue[i] / 255) * 0.8;
      p *= 1 - crime[i] / 400;
      if (o === Overlay.Res) p *= 1 - Math.min(0.9, city.pollution[i] / 120);
      if (rng() >= p) continue;
      const target = lvl + 1;
      if (target >= 4 && tryMerge(city, i, o, target)) continue;
      if (b) {
        for (let yy = b.y; yy < b.y + b.size; yy++) for (let xx = b.x; xx < b.x + b.size; xx++) level[city.idx(xx, yy)] = target;
      } else {
        level[i] = target;
      }
      if (target >= 2) city.builtAt[i] = city.year * 12 + city.month;
    } else if ((d < -0.15 || lvl > cap) && lvl > 0) {
      const strength = lvl > cap ? 0.5 : -d;
      if (rng() < BASE_DECAY * strength) {
        if (b) city.removeBuilding(b, lvl - 1);
        else level[i] = lvl - 1;
      }
    }
  }
}

export function endMonth(city: City): string[] {
  computeStats(city);
  recomputeCoverage(city);
  computePollution(city);
  recomputePower(city);
  recomputeWater(city);
  recomputeTraffic(city);
  computeLandValue(city);
  computeCrime(city);
  computeAverages(city);
  computeDemand(city);
  computeBudget(city);
  disasterMonth(city);

  const msgs = monthlyMessages(city);
  recordMonth(city);
  city.month++;
  if (city.month >= 12) {
    city.month = 0;
    city.year++;
  }
  return msgs;
}

function recordMonth(city: City): void {
  const { history, stats } = city;
  history.pop.push(stats.pop);
  history.money.push(city.money);
  if (history.pop.length > 120) { history.pop.shift(); history.money.shift(); }
  for (const m of MILESTONES) {
    if (city.maxPop < m && stats.pop >= m) {
      city.addLog('log.milestone', { n: m }, 'info');
      for (const [type, def] of Object.entries(STRUCTS)) {
        if (def.unlockPop === m) city.addLog('log.reward', { name: structName(type as keyof typeof STRUCTS) }, 'reward');
      }
    }
  }
  if (stats.pop > city.maxPop) city.maxPop = stats.pop;
  // the fire count changes every month and would flood the log; the fire itself is logged when it starts
  const first = adviceKeys(city)[0];
  // a piece of advice is logged once, then again only if it left the journal's last 12 entries
  if (first && first.key !== 'advice.fire' && !city.log.slice(0, 12).some((e) => e.key === first.key)) city.addLog(first.key, first.params, 'warn');
}

export function computeStats(city: City): void {
  const s = city.stats;
  s.pop = 0; s.jobsC = 0; s.jobsI = 0; s.roads = 0; s.wires = 0; s.unpowered = 0; s.rails = 0; s.highways = 0;
  s.zoned.fill(0);
  s.developed.fill(0);
  const { overlay, level, wire, rail, powered } = city;
  for (let i = 0; i < city.count; i++) {
    if (wire[i]) s.wires++;
    if (rail[i]) s.rails++;
    const o = overlay[i];
    if (o === Overlay.Highway) { s.highways++; continue; }
    if (o === Overlay.Road) { s.roads++; continue; }
    if (!isZone(o)) continue;
    const l = level[i];
    s.zoned[o]++;
    if (l > 0) s.developed[o]++;
    if (!powered[i]) s.unpowered++;
    if (o === Overlay.Res) s.pop += POP_PER_LEVEL[l];
    else if (o === Overlay.Com) s.jobsC += JOBS_C_PER_LEVEL[l];
    else s.jobsI += JOBS_I_PER_LEVEL[l];
  }
  for (const st of city.structs.values()) {
    const def = STRUCTS[st.type];
    if (def.pop && powered[city.idx(st.x, st.y)]) { s.pop += def.pop; s.jobsC += def.jobs ?? 0; }
  }
}

function computeAverages(city: City): void {
  const s = city.stats;
  const { overlay, level, watered, landValue, crime, cover } = city;
  let zoned = 0, lvSum = 0, dev = 0, crimeSum = 0, wateredDev = 0, resDev = 0;
  const covered: Record<string, number> = { police: 0, fire: 0, education: 0, health: 0 };
  for (let i = 0; i < city.count; i++) {
    const o = overlay[i];
    if (!isZone(o)) continue;
    zoned++;
    lvSum += landValue[i];
    if (level[i] === 0) continue;
    dev++;
    crimeSum += crime[i];
    if (watered[i]) wateredDev++;
    if (o === Overlay.Res) {
      resDev++;
      for (const d of DEPTS) if (cover[d][i] >= 64) covered[d]++;
    }
  }
  s.avgLandValue = zoned ? lvSum / zoned : 60;
  s.avgCrime = dev ? crimeSum / dev : 0;
  s.waterShare = dev ? wateredDev / dev : 0;
  for (const d of DEPTS) s.coverage[d] = resDev ? covered[d] / resDev : 0;
}

function computeDemand(city: City): void {
  const { pop, jobsC, jobsI, avgLandValue, avgCrime } = city.stats;
  const labor = pop * 0.5;
  const jobs = jobsC + jobsI;
  let ports = 0, airports = 0;
  for (const st of city.structs.values()) {
    if (st.type === 'port' && city.powered[city.idx(st.x, st.y)]) ports++;
    if (st.type === 'airport' && city.powered[city.idx(st.x, st.y)]) airports++;
  }
  const mul = city.diff.demandMul;
  const external = (300 + (city.year - START_YEAR) * 20) * mul + 400 * Math.min(ports, 2) + 150 * Math.min(airports, 2);

  let r = (jobs - labor + 200 * mul) / Math.max(jobs, labor, 200);
  const cWanted = pop * 0.22 * (1 + 0.3 * Math.min(airports, 2));
  let c = (cWanted - jobsC) / Math.max(cWanted, jobsC, 50);
  const iWanted = pop * 0.3 + external;
  let i = (iWanted - jobsI) / Math.max(iWanted, jobsI, 50);

  const taxPenalty = (city.taxRate - 7) * 0.05;
  const attract = clamp((avgLandValue - 60) / 300, -0.1, 0.2) - (avgCrime / 255) * 0.3;
  const ord = city.ordinances;
  r = r * mul + attract - taxPenalty - (ord.parking ? 0.05 : 0);
  c = c * mul + attract * 0.5 - taxPenalty + (ord.tourism ? 0.15 : 0);
  i = i * mul - taxPenalty - (ord.cleanAir ? 0.1 : 0);

  // demand follows its target with some lag, which gives the RCI bars the
  // familiar overshoot when a wave of new zones fills up
  const k = 0.35;
  const dm = city.demand;
  dm.r += (clamp(r, -1, 1) - dm.r) * k;
  dm.c += (clamp(c, -1, 1) - dm.c) * k;
  dm.i += (clamp(i, -1, 1) - dm.i) * k;
}

function computeBudget(city: City): void {
  const b = emptyBudget();
  const { overlay, level, landValue } = city;
  const rate = city.taxRate / 100;
  for (let i = 0; i < city.count; i++) {
    const o = overlay[i];
    if (!isZone(o) || level[i] === 0) continue;
    const lvF = 0.6 + (landValue[i] / 255) * 0.8;
    if (o === Overlay.Res) b.taxR += POP_PER_LEVEL[level[i]] * 0.5 * lvF * rate;
    else if (o === Overlay.Com) b.taxC += JOBS_C_PER_LEVEL[level[i]] * 0.8 * lvF * rate;
    else b.taxI += JOBS_I_PER_LEVEL[level[i]] * 0.6 * lvF * rate;
  }
  b.roads = city.stats.roads * COST.roadUpkeep + city.stats.wires * COST.wireUpkeep
    + city.stats.rails * COST.railUpkeep + city.stats.highways * COST.highwayUpkeep;
  for (const s of city.structs.values()) {
    const def = STRUCTS[s.type];
    if (def.dept) b[def.dept] += def.upkeep * city.funding[def.dept] / 100;
    else if (def.category === 'power') b.power += def.upkeep;
    else if (def.category === 'water') b.water += def.upkeep;
    else if (def.category === 'transport') b.transport += def.upkeep;
    else b.parks += def.upkeep;
  }
  for (const k of ORDINANCE_KEYS) if (city.ordinances[k]) b.ordinances += ORDINANCES[k].costPerCapita * city.stats.pop;
  const cm = city.diff.costMul;
  b.roads *= cm; b.power *= cm; b.water *= cm; b.parks *= cm; b.transport *= cm;
  for (const d of DEPTS) b[d] *= cm;
  b.interest = city.bonds * BOND_AMOUNT * city.diff.bondRate / 12;
  city.lastBudget = b;
  city.money = Math.round(city.money + budgetIncome(b) - budgetExpenses(b));
}

function computePollution(city: City): void {
  const { size, overlay, level, pollution } = city;
  pollution.fill(0);
  const emitAt = (cx: number, cy: number, emit: number, R: number) => {
    const y0 = Math.max(0, cy - R), y1 = Math.min(size - 1, cy + R);
    const x0 = Math.max(0, cx - R), x1 = Math.min(size - 1, cx + R);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dist = Math.max(Math.abs(xx - cx), Math.abs(yy - cy));
        const j = yy * size + xx;
        pollution[j] = Math.min(255, pollution[j] + emit * (1 - dist / (R + 1)));
      }
    }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (overlay[i] === Overlay.Ind && level[i] > 0) emitAt(x, y, level[i] * (city.ordinances.cleanAir ? 15 : 22), 4);
    }
  }
  for (const s of city.structs.values()) {
    const def = STRUCTS[s.type];
    if (def.pollution) {
      const c = Math.floor(def.size / 2);
      emitAt(s.x + c, s.y + c, def.pollution, def.pollutionRadius ?? 5);
    }
  }
  // busy roads smell too
  const { traffic } = city;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = traffic[y * size + x];
      if (t > 200) emitAt(x, y, Math.min(40, t / 25), 1);
    }
  }
}

/** Multi-source flood from every plant; nearest consumers are served first. */
export function recomputePower(city: City): void {
  const { size, count, overlay, level, powered, structId } = city;
  powered.fill(0);
  const comp = new Int32Array(count).fill(-1);
  const supply: number[] = [];
  const sources: number[] = [];

  // conductive neighbours; a lone road, highway or railway tile in between does not break the link
  const crossable = (j: number) => overlay[j] === Overlay.Road || overlay[j] === Overlay.Highway || (overlay[j] === Overlay.None && city.rail[j] === 1);
  const neighbours = (i: number, out: number[]) => {
    out.length = 0;
    const x = i % size;
    const steps = [x > 0 ? -1 : 0, x < size - 1 ? 1 : 0, i >= size ? -size : 0, i + size < count ? size : 0];
    for (const d of steps) {
      if (d === 0) continue;
      const j = i + d;
      if (city.conducts(j)) { out.push(j); continue; }
      if (!crossable(j)) continue;
      const jx = j % size;
      if ((d === -1 && jx === 0) || (d === 1 && jx === size - 1) || (d === -size && j < size) || (d === size && j + size >= count)) continue;
      const k = j + d;
      if (city.conducts(k)) out.push(k);
    }
  };
  const nb: number[] = [];

  // pass 1: label connected components that contain at least one plant
  for (const s of city.structs.values()) {
    const def = STRUCTS[s.type];
    if (!def.power) continue;
    const origin = city.idx(s.x, s.y);
    let c = comp[origin];
    if (c === -1) {
      c = supply.length;
      supply.push(0);
      comp[origin] = c;
      const stack = [origin];
      while (stack.length) {
        const i = stack.pop()!;
        neighbours(i, nb);
        for (const j of nb) {
          if (comp[j] === -1) { comp[j] = c; stack.push(j); }
        }
      }
    }
    supply[c] += def.power;
    for (let yy = s.y; yy < s.y + def.size; yy++) {
      for (let xx = s.x; xx < s.x + def.size; xx++) sources.push(city.idx(xx, yy));
    }
  }

  // pass 2: breadth-first from all plants, budget per component
  const used = new Float64Array(supply.length);
  let demand = 0;
  const seen = new Uint8Array(count);
  let frontier: number[] = [];
  for (const i of sources) { seen[i] = 1; powered[i] = 1; frontier.push(i); }
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      neighbours(i, nb);
      for (const j of nb) {
        if (seen[j]) continue;
        seen[j] = 1;
        const c = comp[j];
        let draw = 0;
        const o = overlay[j];
        if (isZone(o)) draw = POWER_USE[o] * level[j] * (city.ordinances.energy ? 0.85 : 1);
        else if (o === Overlay.Struct) {
          const st = city.structs.get(structId[j])!;
          if (city.idx(st.x, st.y) === j) draw = STRUCTS[st.type].consumes ?? 0;
        }
        demand += draw;
        used[c] += draw;
        if (used[c] <= supply[c]) powered[j] = 1;
        next.push(j);
      }
    }
    frontier = next;
  }

  // zones that are not even connected still count as demand for the indicator
  for (let i = 0; i < count; i++) {
    const o = overlay[i] as Overlay;
    if (!seen[i] && isZone(o)) demand += POWER_USE[o] * level[i];
  }
  city.power.supply = supply.reduce((a, b) => a + b, 0);
  city.power.demand = demand;
}

export function recomputeWater(city: City): void {
  const { size, watered, powered, terrain } = city;
  watered.fill(0);
  for (const s of city.structs.values()) {
    const def = STRUCTS[s.type];
    if (def.category !== 'water') continue;
    if (!powered[city.idx(s.x, s.y)]) continue;
    if (def.needsShore && !touchesWater(city, s.x, s.y, def.size)) continue;
    const r = def.radius!;
    const cx = s.x + (def.size - 1) / 2, cy = s.y + (def.size - 1) / 2;
    forCircle(size, cx, cy, r, (j) => { if (terrain[j] === 0) watered[j] = 1; });
  }
}

/** Does the n×n footprint at (x, y) share an edge with water? Diagonal corners do not count. */
export function touchesWater(city: City, x: number, y: number, n: number): boolean {
  const water = (xx: number, yy: number) => city.inBounds(xx, yy) && city.terrain[city.idx(xx, yy)] === Terrain.Water;
  for (let k = 0; k < n; k++) {
    if (water(x + k, y - 1) || water(x + k, y + n) || water(x - 1, y + k) || water(x + n, y + k)) return true;
  }
  return false;
}

function forCircle(size: number, cx: number, cy: number, r: number, fn: (j: number, dist: number) => void): void {
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const d = Math.hypot(xx - cx, yy - cy);
      if (d <= r) fn(yy * size + xx, d);
    }
  }
}

export function recomputeCoverage(city: City): void {
  const { cover, size } = city;
  for (const k of Object.keys(cover) as (keyof typeof cover)[]) cover[k].fill(0);
  for (const s of city.structs.values()) {
    const def = STRUCTS[s.type];
    const layer = def.dept ?? (def.category === 'park' || def.category === 'reward' ? 'park' : null);
    if (!layer || !def.radius) continue;
    const arr = cover[layer];
    const r = def.radius;
    const cx = s.x + (def.size - 1) / 2, cy = s.y + (def.size - 1) / 2;
    forCircle(size, cx, cy, r, (j, d) => {
      arr[j] = Math.min(255, arr[j] + 255 * (1 - d / (r + 1)));
    });
  }
}

function computeLandValue(city: City): void {
  const { size, overlay, terrain, pollution, crime, cover, waterDist, landValue, funding } = city;
  const fPolice = funding.police / 100, fFire = funding.fire / 100;
  const fEdu = funding.education / 100, fHealth = funding.health / 100;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (terrain[i] !== 0) { landValue[i] = 0; continue; }
      let v = 70 + city.base(x, y) * 2;
      const wd = waterDist[i];
      if (wd <= 4) v += 30 * (1 - wd / 5);
      let trees = 0;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(size - 1, y + 2); yy++) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(size - 1, x + 2); xx++) {
          if (overlay[yy * size + xx] === Overlay.Tree) trees++;
        }
      }
      v += Math.min(15, trees * 2.5);
      v += cover.park[i] * 0.15;
      v += cover.education[i] * fEdu * 0.08 + cover.health[i] * fHealth * 0.06;
      v += cover.fire[i] * fFire * 0.04 + cover.police[i] * fPolice * 0.04;
      v -= pollution[i] * 0.35;
      v -= crime[i] * 0.25;
      v -= Math.max(0, city.congestion[i] - 100) * 0.3;
      landValue[i] = Math.round(clamp(landValue[i] * 0.5 + v * 0.5, 0, 255));
    }
  }
}

function computeCrime(city: City): void {
  const { overlay, level, landValue, crime, cover, funding } = city;
  const fPolice = funding.police / 100;
  for (let i = 0; i < city.count; i++) {
    const o = overlay[i];
    let raw = 0;
    if (isZone(o) && level[i] > 0) {
      const density = level[i] * (o === Overlay.Res ? 20 : o === Overlay.Com ? 16 : 8);
      raw = density * (1.6 - landValue[i] / 255) - cover.police[i] * fPolice * 0.7;
      if (city.ordinances.watch) raw *= 0.8;
      if (raw < 0) raw = 0;
    }
    crime[i] = Math.round(clamp(crime[i] * 0.5 + raw * 0.5, 0, 255));
  }
}

/** BFS from every road tile, 4-neighbourhood, capped at ROAD_REACH. */
export function recomputeRoadDist(city: City): void {
  const { size, overlay, roadDist, entry } = city;
  roadDist.fill(NO_ROAD);
  entry.fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < city.count; i++) {
    if (overlay[i] === Overlay.Road) { roadDist[i] = 0; entry[i] = i; frontier.push(i); }
  }
  for (let d = 1; d <= ROAD_REACH && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % size, y = (i - x) / size;
      const visit = (j: number) => {
        if (roadDist[j] !== NO_ROAD) return;
        roadDist[j] = d;
        entry[j] = entry[i];
        next.push(j);
      };
      if (x > 0) visit(i - 1);
      if (x < size - 1) visit(i + 1);
      if (y > 0) visit(i - size);
      if (y < size - 1) visit(i + size);
    }
    frontier = next;
  }
  city.roadsDirty = false;
  city.gridDirty = true;
}

// ---- traffic ---------------------------------------------------------------

/** Binary min-heap of (cost, node) pairs stored in flat arrays. */
class Heap {
  private cost: number[] = [];
  private node: number[] = [];
  get size(): number { return this.cost.length; }
  push(c: number, n: number): void {
    const cost = this.cost, node = this.node;
    cost.push(c); node.push(n);
    let i = cost.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cost[p] <= cost[i]) break;
      [cost[p], cost[i]] = [cost[i], cost[p]];
      [node[p], node[i]] = [node[i], node[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const cost = this.cost, node = this.node;
    const top: [number, number] = [cost[0], node[0]];
    const lc = cost.pop()!, ln = node.pop()!;
    if (cost.length) {
      cost[0] = lc; node[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < cost.length && cost[l] < cost[m]) m = l;
        if (r < cost.length && cost[r] < cost[m]) m = r;
        if (m === i) break;
        [cost[m], cost[i]] = [cost[i], cost[m]];
        [node[m], node[i]] = [node[i], node[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Commuting model. Nodes are roadway tiles (road layer) and rail tiles (rail
 * layer, offset by `count`); stations bridge the two. Everyone drives to the
 * nearest jobs (or, for shops and plants, the nearest homes); the commuters
 * are summed on each roadway tile and last month's congestion makes a tile
 * more expensive to cross, so traffic spreads out and long jams cut zones off.
 */
export function recomputeTraffic(city: City): { toJobs: { dist: Float32Array; next: Int32Array }; toHomes: { dist: Float32Array; next: Int32Array }; jobTargets: number[] } {
  const { size, count, overlay, level, rail, entry, traffic, access, congestion, structId } = city;
  const N2 = count * 2;
  const prev = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = overlay[i];
    // a jammed tile costs up to 2.5x a free one
    if (o === Overlay.Road) prev[i] = Math.min(1.5, Math.max(0, traffic[i] / ROAD_CAPACITY - 0.5));
    else if (o === Overlay.Highway) prev[i] = Math.min(1.5, Math.max(0, traffic[i] / HIGHWAY_CAPACITY - 0.5));
  }
  const isStation = (i: number) => overlay[i] === Overlay.Struct && city.structs.get(structId[i])?.type === 'station';
  const roadNode = (i: number) => overlay[i] === Overlay.Road || overlay[i] === Overlay.Highway || isStation(i);

  const nbs: number[] = [];
  const costs: number[] = [];
  const neighbours = (n: number) => {
    nbs.length = 0; costs.length = 0;
    const i = n % count;
    const onRail = n >= count;
    const x = i % size;
    const around = [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i >= size ? i - size : -1, i + size < count ? i + size : -1];
    for (const j of around) {
      if (j < 0) continue;
      if (onRail) {
        if (rail[j]) { nbs.push(j + count); costs.push(0.5); }
        if (isStation(j)) { nbs.push(j); costs.push(2); }
      } else {
        const o = overlay[j];
        if (o === Overlay.Highway) { nbs.push(j); costs.push(0.4 + prev[j]); }
        else if (o === Overlay.Road) { nbs.push(j); costs.push(1 + prev[j]); }
        else if (isStation(j)) { nbs.push(j); costs.push(1); }
        if (isStation(i) && rail[j]) { nbs.push(j + count); costs.push(2); }
      }
    }
  };

  const dijkstra = (sources: number[]): { dist: Float32Array; next: Int32Array } => {
    const dist = new Float32Array(N2).fill(Infinity);
    const next = new Int32Array(N2).fill(-1);
    const heap = new Heap();
    for (const s of sources) { dist[s] = 0; heap.push(0, s); }
    while (heap.size) {
      const [c, n] = heap.pop();
      if (c > dist[n] || c > MAX_TRIP) continue;
      neighbours(n);
      for (let k = 0; k < nbs.length; k++) {
        const m = nbs[k];
        const nc = c + costs[k];
        if (nc < dist[m]) { dist[m] = nc; next[m] = n; heap.push(nc, m); }
      }
    }
    return { dist, next };
  };

  // where do the trips end? road tiles serving job zones, and road tiles serving homes
  const jobTargets = new Set<number>();
  const homeTargets = new Set<number>();
  for (let i = 0; i < count; i++) {
    const e = entry[i];
    if (e < 0 || !roadNode(e)) continue;
    const o = overlay[i];
    if (o === Overlay.Res) homeTargets.add(e);
    else if (o === Overlay.Com || o === Overlay.Ind) jobTargets.add(e);
  }
  const toJobs = dijkstra([...jobTargets]);
  const toHomes = dijkstra([...homeTargets]);

  // bus depots take part of the commuters off the road
  const busCover = new Uint8Array(count);
  for (const st of city.structs.values()) {
    if (st.type !== 'bus' || !city.powered[city.idx(st.x, st.y)]) continue;
    const r = STRUCTS.bus.radius!;
    const cx = st.x + 0.5, cy = st.y + 0.5;
    for (let yy = Math.max(0, Math.floor(cy - r)); yy <= Math.min(size - 1, Math.ceil(cy + r)); yy++) {
      for (let xx = Math.max(0, Math.floor(cx - r)); xx <= Math.min(size - 1, Math.ceil(cx + r)); xx++) {
        if (Math.hypot(xx - cx, yy - cy) <= r) busCover[yy * size + xx] = 1;
      }
    }
  }

  const load = new Float32Array(count);
  let trips = 0, failed = 0;
  for (let i = 0; i < count; i++) {
    const o = overlay[i];
    if (!isZone(o)) { access[i] = 0; continue; }
    const e = entry[i];
    if (e < 0) { access[i] = 0; continue; }
    if (o === Overlay.Res) {
      const ok = toJobs.dist[e] <= MAX_TRIP;
      access[i] = ok ? 1 : 0;
      const pop = POP_PER_LEVEL[level[i]];
      if (pop === 0) continue;
      trips++;
      if (!ok) { failed++; continue; }
      // half the residents commute, fewer when a bus depot serves the area
      const w = pop * 0.5 * (busCover[i] ? 0.6 : 1) * (city.ordinances.parking ? 0.9 : 1);
      let n = e, steps = 0;
      while (n >= 0 && steps++ < 400) {
        if (n < count && overlay[n] !== Overlay.Struct) load[n] += w;
        n = toJobs.next[n];
      }
    } else {
      access[i] = toHomes.dist[e] <= MAX_TRIP ? 1 : 0;
      if (level[i] > 0) { trips++; if (!access[i]) failed++; }
    }
  }
  city.tripFailShare = trips ? failed / trips : 0;

  let jammed = 0;
  for (let i = 0; i < count; i++) {
    const t = Math.round(traffic[i] * 0.5 + load[i] * 0.5);
    traffic[i] = Math.min(65535, t);
    const cap = overlay[i] === Overlay.Highway ? HIGHWAY_CAPACITY : ROAD_CAPACITY;
    if (t > cap) jammed++;
  }
  city.jammed = jammed;
  congestion.fill(0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const o = overlay[i];
      if (o !== Overlay.Road && o !== Overlay.Highway) continue;
      const cap = o === Overlay.Highway ? HIGHWAY_CAPACITY : ROAD_CAPACITY;
      const c = Math.min(255, Math.round(traffic[i] / cap * 100));
      for (let yy = Math.max(0, y - 1); yy <= Math.min(size - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(size - 1, x + 1); xx++) {
          const j = yy * size + xx;
          if (c > congestion[j]) congestion[j] = c;
        }
      }
    }
  }
  return { toJobs, toHomes, jobTargets: [...jobTargets] };
}

export function issueBond(city: City): boolean {
  if (city.bonds >= 10) return false;
  city.bonds++;
  city.money += BOND_AMOUNT;
  return true;
}

export function repayBond(city: City): boolean {
  if (city.bonds === 0 || city.money < BOND_AMOUNT) return false;
  city.bonds--;
  city.money -= BOND_AMOUNT;
  return true;
}

export interface Advice {
  key: string;
  params?: Record<string, string | number>;
}

/** Every piece of advice that applies right now, most pressing first. */
export function adviceKeys(city: City): Advice[] {
  const out: Advice[] = [];
  const { demand, stats, power } = city;
  const free = (z: Overlay) => stats.zoned[z] - stats.developed[z];
  const zonedTotal = stats.zoned[Overlay.Res] + stats.zoned[Overlay.Com] + stats.zoned[Overlay.Ind];
  const add = (key: string, params?: Record<string, string | number>) => out.push({ key, params });
  if (city.burning > 0) add('advice.fire', { n: city.burning });
  if (city.money < 0) add('advice.broke');
  if (zonedTotal > 0 && power.supply === 0) add('advice.noPlant');
  else if (power.demand > power.supply && power.supply > 0) add('advice.powerShort');
  else if (stats.unpowered > zonedTotal * 0.2) add('advice.unconnected');
  if (city.tripFailShare > 0.3 && stats.zoned[Overlay.Com] + stats.zoned[Overlay.Ind] === 0) add('advice.noJobsZones');
  else if (city.tripFailShare > 0.3) add('advice.tripsFail');
  else if (city.jammed > 15) add('advice.jams');
  if (stats.pop > 1500 && stats.waterShare < 0.5) add('advice.water');
  if (stats.avgCrime > 60) add('advice.crime');
  if (stats.pop > 2000 && stats.coverage.fire < 0.3) add('advice.fewFire');
  if (stats.avgLandValue < 50 && stats.pop > 3000) add('advice.lowLV');
  if (demand.r > 0.5 && free(Overlay.Res) < 5) add('advice.needR');
  if (demand.c > 0.5 && free(Overlay.Com) < 5) add('advice.needC');
  if (demand.i > 0.5 && free(Overlay.Ind) < 5) add('advice.needI');
  if (demand.r < -0.4 && stats.pop > 0) add('advice.noJobs');
  return out;
}

export function advice(city: City): string[] {
  return adviceKeys(city).map((a) => t(a.key, a.params));
}

function monthlyMessages(city: City): string[] {
  return advice(city).slice(0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
