import type { Actor, City } from './city';
import { STRUCTS } from './structs';
import { t } from '../i18n';
import { Overlay, Terrain, isZone, type DisasterKind } from './types';

/** ticks a fire burns before the tile is lost */
const BURN_TICKS = 60;
/** a fire put out this early leaves the building standing */
const SAVED_BEFORE = 24;

function flammable(city: City, i: number): boolean {
  const o = city.overlay[i] as Overlay;
  if (o === Overlay.Tree) return true;
  if (isZone(o)) return city.level[i] > 0;
  if (o === Overlay.Struct) {
    const st = city.structAt(i);
    return !!st && STRUCTS[st.type].category !== 'water';
  }
  return false;
}

export function ignite(city: City, i: number): boolean {
  if (city.fire[i] || !flammable(city, i)) return false;
  city.fire[i] = BURN_TICKS;
  return true;
}

/** Per-tick fire spread, extinguishing and burn-out. */
function fireTick(city: City): void {
  const { fire, size, count, cover, funding, rng } = city;
  const fEff = funding.fire / 100;
  let burning = 0;
  for (let i = 0; i < count; i++) {
    const t = fire[i];
    if (!t) continue;
    burning++;
    const protection = (cover.fire[i] / 255) * fEff; // 0..1
    // firefighters put it out; early enough and nothing is lost
    if (rng() < 0.012 + protection * 0.06) {
      fire[i] = 0;
      if (BURN_TICKS - t >= SAVED_BEFORE) city.destroyTile(i);
      continue;
    }
    if (t === 1) {
      fire[i] = 0;
      city.destroyTile(i);
      continue;
    }
    fire[i] = t - 1;
    const spread = 0.025 * (1 - protection * 0.7);
    const x = i % size;
    const nbs = [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i >= size ? i - size : -1, i + size < count ? i + size : -1];
    for (const j of nbs) if (j >= 0 && rng() < spread) ignite(city, j);
  }
  city.burning = burning;
}

function actorTick(city: City, a: Actor): void {
  const { rng, size } = city;
  a.ticks--;
  a.dir += (rng() - 0.5) * 0.6;
  a.x += Math.cos(a.dir) * 0.3;
  a.y += Math.sin(a.dir) * 0.3;
  smash(city, a.x, a.y, 1, 0.3);
  if (a.x < 1 || a.y < 1 || a.x > size - 2 || a.y > size - 2) a.dir += Math.PI;
}

function smash(city: City, cx: number, cy: number, r: number, p: number): void {
  const x0 = Math.round(cx), y0 = Math.round(cy);
  for (let y = y0 - r; y <= y0 + r; y++) {
    for (let x = x0 - r; x <= x0 + r; x++) {
      if (!city.inBounds(x, y)) continue;
      const i = city.idx(x, y);
      const o = city.overlay[i] as Overlay;
      if (o === Overlay.None || o === Overlay.Rubble) continue;
      if (city.rng() >= p) continue;
      city.destroyTile(i);
    }
  }
}

export function disasterTick(city: City): void {
  if (city.burning || city.fire.some((t) => t > 0)) fireTick(city);
  for (const a of city.actors) actorTick(city, a);
  city.actors = city.actors.filter((a) => a.ticks > 0);
}

/** Monthly: floods recede, and maybe something random happens. */
export function disasterMonth(city: City): void {
  const { flood, count } = city;
  for (let i = 0; i < count; i++) if (flood[i]) flood[i]--;
  if (!city.randomDisasters) return;
  const ind = city.stats.developed[Overlay.Ind];
  const k = city.diff.disasterMul;
  // small industrial fires are the everyday risk, the rest is rare
  if (city.rng() < (0.008 + ind / 5000) * k) startDisaster(city, 'fire');
  else if (city.stats.pop > 3000 && city.rng() < 0.003 * k) {
    const kinds: DisasterKind[] = ['tornado', 'quake', 'flood'];
    startDisaster(city, kinds[Math.floor(city.rng() * kinds.length)]);
  }
}

/** Picks a spot in town: a developed tile if any, else the map centre. */
function pickTarget(city: City): [number, number] {
  const cands: number[] = [];
  for (let i = 0; i < city.count; i += 3) if (isZone(city.overlay[i] as Overlay) && city.level[i] > 0) cands.push(i);
  if (!cands.length) return [city.size / 2, city.size / 2];
  const i = cands[Math.floor(city.rng() * cands.length)];
  return [i % city.size, Math.floor(i / city.size)];
}

export function startDisaster(city: City, kind: DisasterKind): string {
  const [tx, ty] = pickTarget(city);
  switch (kind) {
    case 'fire': {
      let lit = 0;
      for (let k = 0; k < 40 && lit < 2; k++) {
        const x = tx + Math.floor(city.rng() * 5) - 2, y = ty + Math.floor(city.rng() * 5) - 2;
        if (city.inBounds(x, y) && ignite(city, city.idx(x, y))) lit++;
      }
      if (!lit) return t('disaster.nothing');
      city.burning = lit;
      city.addLog('log.fire', { x: tx, y: ty }, 'disaster');
      break;
    }
    case 'flood': {
      let hit = 0;
      for (let y = 0; y < city.size; y++) {
        for (let x = 0; x < city.size; x++) {
          const i = city.idx(x, y);
          if (city.terrain[i] !== Terrain.Land || city.waterDist[i] > 2 || city.base(x, y) > 1) continue;
          if (city.rng() < 0.5) {
            city.flood[i] = 3 + Math.floor(city.rng() * 3);
            if (city.overlay[i] !== Overlay.None) { city.destroyTile(i); hit++; }
          }
        }
      }
      city.addLog('log.flood', { n: hit }, 'disaster');
      break;
    }
    case 'tornado':
      city.actors.push({ kind: 'tornado', x: tx, y: ty, dir: city.rng() * Math.PI * 2, ticks: 90 });
      city.addLog('log.tornado', { x: tx, y: ty }, 'disaster');
      break;
    case 'quake': {
      const R = 14;
      let hit = 0;
      for (let y = ty - R; y <= ty + R; y++) {
        for (let x = tx - R; x <= tx + R; x++) {
          if (!city.inBounds(x, y)) continue;
          const d = Math.hypot(x - tx, y - ty);
          if (d > R) continue;
          const i = city.idx(x, y);
          const o = city.overlay[i] as Overlay;
          if (o === Overlay.None || o === Overlay.Rubble) continue;
          const p = 0.35 * (1 - d / R);
          if (city.rng() < p) {
            if (city.rng() < 0.25 && ignite(city, i)) continue;
            city.destroyTile(i);
            hit++;
          }
        }
      }
      city.shakeMs = 1500;
      city.addLog('log.quake', { x: tx, y: ty, n: hit }, 'disaster');
      break;
    }
  }
  return t('disaster.go', { name: t(`disaster.${kind}`) });
}
