import { mulberry32, randomSeed, type Rng } from './rng';
import { STRUCTS, type Struct } from './structs';
import { generateTerrain } from './terrain';
import {
  DEFAULT_TAX, DEPTS, DIFFICULTIES, MAP_SIZE, NO_ROAD, ORDINANCE_KEYS, Overlay, START_YEAR, Terrain,
  isZone, type Dept, type Difficulty, type DifficultyDef, type LogEntry, type Ordinance, type StructType, type ZoneType,
} from './types';

export interface Demand {
  r: number;
  c: number;
  i: number;
}

export interface Stats {
  pop: number;
  jobsC: number;
  jobsI: number;
  roads: number;
  rails: number;
  highways: number;
  wires: number;
  /** zone tile counts, indexed by Overlay (Res/Com/Ind) */
  zoned: number[];
  developed: number[];
  unpowered: number;
  /** share of developed zone tiles with water, 0..1 */
  waterShare: number;
  avgLandValue: number;
  avgCrime: number;
  /** share of developed residential tiles covered, 0..1 */
  coverage: Record<Dept, number>;
}

export interface Budget {
  taxR: number;
  taxC: number;
  taxI: number;
  roads: number;
  power: number;
  water: number;
  police: number;
  fire: number;
  education: number;
  health: number;
  parks: number;
  transport: number;
  ordinances: number;
  interest: number;
}

export function budgetIncome(b: Budget): number {
  return b.taxR + b.taxC + b.taxI;
}

export function budgetExpenses(b: Budget): number {
  return b.roads + b.power + b.water + b.police + b.fire + b.education + b.health + b.parks + b.transport + b.ordinances + b.interest;
}

export type Funding = Record<Dept, number>;

/** A dense zone building spanning size x size tiles (all at the same level). */
export interface Building {
  id: number;
  zone: ZoneType;
  size: number;
  x: number;
  y: number;
}

export type Corners = [number, number, number, number];

/** A moving disaster. */
export interface Actor {
  kind: 'tornado';
  x: number;
  y: number;
  /** heading in radians */
  dir: number;
  ticks: number;
}

export interface History {
  pop: number[];
  money: number[];
}

export class City {
  readonly size = MAP_SIZE;
  readonly count = MAP_SIZE * MAP_SIZE;
  /** corner grid side */
  readonly cs = MAP_SIZE + 1;

  terrain: Uint8Array;
  overlay: Uint8Array;
  level: Uint8Array;
  /** corner heights, cs x cs */
  elev: Uint8Array;
  /** 1 when a power line runs over the tile (bare ground or road) */
  wire: Uint8Array;
  /** 1 when a railway runs over the tile (bare ground, road crossing or water) */
  rail: Uint8Array;
  /** id of the structure occupying the tile, 0 = none */
  structId: Uint16Array;
  structs = new Map<number, Struct>();
  nextStructId = 1;
  /** id of the merged zone building occupying the tile, 0 = none */
  bldId: Uint16Array;
  buildings = new Map<number, Building>();
  nextBldId = 1;

  // ---- derived layers ----
  roadDist: Uint8Array;
  pollution: Uint8Array;
  powered: Uint8Array;
  watered: Uint8Array;
  landValue: Uint8Array;
  crime: Uint8Array;
  /** service and park reach, 0..255 */
  cover: Record<Dept | 'park', Uint8Array>;
  /** distance to nearest water tile, capped */
  waterDist: Uint8Array;
  /** index of the road tile a zone connects to, -1 if none within reach */
  entry: Int32Array;
  /** commuters per month on each roadway tile */
  traffic: Uint16Array;
  /** 1 when the zone can reach jobs (R) or workers (C/I) within MAX_TRIP */
  access: Uint8Array;
  /** worst congestion of the roadways next to the tile, 0..255 (255 = 2.5x capacity) */
  congestion: Uint8Array;
  /** share of trips that failed last month, 0..1 */
  tripFailShare = 0;
  /** tiles with traffic above capacity */
  jammed = 0;

  // ---- disasters ----
  /** ticks a tile keeps burning, 0 = not on fire */
  fire: Uint8Array;
  /** months a tile stays under water, 0 = dry */
  flood: Uint8Array;
  actors: Actor[] = [];
  /** ms of camera shake left to render */
  shakeMs = 0;
  randomDisasters = true;
  burning = 0;

  // ---- records ----
  maxPop = 0;
  ordinances: Record<Ordinance, boolean> = { watch: false, cleanAir: false, tourism: false, energy: false, parking: false };
  log: LogEntry[] = [];
  history: History = { pop: [], money: [] };

  seed: number;
  rng: Rng;
  name = 'Ville';
  difficulty: Difficulty = 'facile';
  money: number;
  year = START_YEAR;
  month = 0;
  tickInMonth = 0;
  taxRate = DEFAULT_TAX;
  bonds = 0;
  funding: Funding = { police: 100, fire: 100, education: 100, health: 100 };
  demand: Demand = { r: 0, c: 0, i: 0 };
  stats: Stats = emptyStats();
  power = { supply: 0, demand: 0 };
  lastBudget: Budget = emptyBudget();
  roadsDirty = true;
  /** wires, zones or structures changed: power, water and coverage need a refresh */
  gridDirty = true;

  private constructor(seed: number, terrain: Uint8Array, overlay: Uint8Array, elev: Uint8Array) {
    this.seed = seed;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.terrain = terrain;
    this.overlay = overlay;
    this.elev = elev;
    this.money = DIFFICULTIES.facile.money;
    const n = this.count;
    this.level = new Uint8Array(n);
    this.wire = new Uint8Array(n);
    this.rail = new Uint8Array(n);
    this.structId = new Uint16Array(n);
    this.bldId = new Uint16Array(n);
    this.roadDist = new Uint8Array(n).fill(NO_ROAD);
    this.pollution = new Uint8Array(n);
    this.powered = new Uint8Array(n);
    this.watered = new Uint8Array(n);
    this.landValue = new Uint8Array(n).fill(60);
    this.crime = new Uint8Array(n);
    this.cover = {
      police: new Uint8Array(n), fire: new Uint8Array(n), education: new Uint8Array(n),
      health: new Uint8Array(n), park: new Uint8Array(n),
    };
    this.waterDist = computeWaterDist(terrain, this.size, 6);
    this.entry = new Int32Array(n).fill(-1);
    this.traffic = new Uint16Array(n);
    this.access = new Uint8Array(n);
    this.congestion = new Uint8Array(n);
    this.fire = new Uint8Array(n);
    this.flood = new Uint8Array(n);
  }

  static generate(seed = randomSeed(), name = 'Ville', difficulty: Difficulty = 'facile'): City {
    const { terrain, overlay, elev } = generateTerrain(MAP_SIZE, seed);
    const city = new City(seed, terrain, overlay, elev);
    city.name = name;
    city.difficulty = difficulty;
    city.money = DIFFICULTIES[difficulty].money;
    return city;
  }

  idx(x: number, y: number): number {
    return y * this.size + x;
  }

  get diff(): DifficultyDef {
    return DIFFICULTIES[this.difficulty];
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  isLand(i: number): boolean {
    return this.terrain[i] === Terrain.Land;
  }

  isRoad(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.overlay[this.idx(x, y)] === Overlay.Road;
  }

  /** true when the tile carries current: wire, zone or structure */
  conducts(i: number): boolean {
    const o = this.overlay[i] as Overlay;
    return this.wire[i] === 1 || isZone(o) || o === Overlay.Struct;
  }

  addLog(key: string, params: Record<string, string | number> = {}, kind: LogEntry['kind'] = 'info'): void {
    this.log.unshift({ year: this.year, month: this.month, kind, key, params });
    if (this.log.length > 200) this.log.length = 200;
  }

  /**
   * Wipes whatever stands on a tile (building, structure, road, rail, wire,
   * trees) and leaves rubble, or bare ground for trees and roads.
   */
  destroyTile(i: number): void {
    const o = this.overlay[i] as Overlay;
    const st = this.structAt(i);
    if (st) {
      this.removeStruct(st);
      const n = STRUCTS[st.type].size;
      for (let yy = st.y; yy < st.y + n; yy++) for (let xx = st.x; xx < st.x + n; xx++) this.overlay[this.idx(xx, yy)] = Overlay.Rubble;
      return;
    }
    const b = this.buildingAt(i);
    if (b) this.removeBuilding(b, Math.max(0, this.level[i] - 1));
    if (isZone(o) && this.level[i] > 0) this.overlay[i] = Overlay.Rubble;
    else if (o === Overlay.Tree || o === Overlay.Road || o === Overlay.Highway) this.overlay[i] = Overlay.None;
    this.level[i] = 0;
    this.wire[i] = 0;
    this.rail[i] = 0;
    this.fire[i] = 0;
    this.roadsDirty = true;
    this.gridDirty = true;
  }

  isRoadway(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const o = this.overlay[this.idx(x, y)];
    return o === Overlay.Road || o === Overlay.Highway;
  }

  hasRail(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.rail[this.idx(x, y)] === 1;
  }

  // ---- terrain -----------------------------------------------------------

  /** heights of corners (x,y), (x+1,y), (x+1,y+1), (x,y+1) */
  corners(x: number, y: number): Corners {
    const { elev, cs } = this;
    const a = y * cs + x;
    return [elev[a], elev[a + 1], elev[a + cs + 1], elev[a + cs]];
  }

  /** lowest corner of the tile */
  base(x: number, y: number): number {
    const c = this.corners(x, y);
    return Math.min(c[0], c[1], c[2], c[3]);
  }

  isFlat(x: number, y: number): boolean {
    const c = this.corners(x, y);
    return c[0] === c[1] && c[1] === c[2] && c[2] === c[3];
  }

  isFlatIdx(i: number): boolean {
    const x = i % this.size;
    return this.isFlat(x, (i - x) / this.size);
  }

  // ---- structures --------------------------------------------------------

  structAt(i: number): Struct | undefined {
    const id = this.structId[i];
    return id ? this.structs.get(id) : undefined;
  }

  addStruct(type: StructType, x: number, y: number): Struct {
    const s: Struct = { id: this.nextStructId++, type, x, y };
    this.structs.set(s.id, s);
    const n = STRUCTS[type].size;
    for (let yy = y; yy < y + n; yy++) {
      for (let xx = x; xx < x + n; xx++) {
        const i = this.idx(xx, yy);
        this.overlay[i] = Overlay.Struct;
        this.level[i] = 0;
        this.wire[i] = 0;
        this.rail[i] = 0;
        this.structId[i] = s.id;
      }
    }
    this.gridDirty = true;
    return s;
  }

  removeStruct(s: Struct): void {
    const n = STRUCTS[s.type].size;
    for (let yy = s.y; yy < s.y + n; yy++) {
      for (let xx = s.x; xx < s.x + n; xx++) {
        const i = this.idx(xx, yy);
        this.overlay[i] = Overlay.None;
        this.structId[i] = 0;
      }
    }
    this.structs.delete(s.id);
    this.gridDirty = true;
  }

  // ---- merged zone buildings --------------------------------------------

  buildingAt(i: number): Building | undefined {
    const id = this.bldId[i];
    return id ? this.buildings.get(id) : undefined;
  }

  addBuilding(zone: ZoneType, size: number, x: number, y: number, level: number): Building {
    const b: Building = { id: this.nextBldId++, zone, size, x, y };
    this.buildings.set(b.id, b);
    for (let yy = y; yy < y + size; yy++) {
      for (let xx = x; xx < x + size; xx++) {
        const i = this.idx(xx, yy);
        const old = this.bldId[i];
        if (old && old !== b.id) this.buildings.delete(old);
        this.bldId[i] = b.id;
        this.overlay[i] = zone;
        this.level[i] = level;
      }
    }
    return b;
  }

  /** Dissolves the building; its tiles keep the zone at `level`. */
  removeBuilding(b: Building, level: number): void {
    for (let yy = b.y; yy < b.y + b.size; yy++) {
      for (let xx = b.x; xx < b.x + b.size; xx++) {
        const i = this.idx(xx, yy);
        if (this.bldId[i] !== b.id) continue;
        this.bldId[i] = 0;
        this.level[i] = level;
      }
    }
    this.buildings.delete(b.id);
  }

  // ---- persistence -------------------------------------------------------

  toJSON(): SavedCity {
    return {
      v: 5,
      seed: this.seed,
      size: this.size,
      name: this.name,
      difficulty: this.difficulty,
      terrain: encodeBytes(this.terrain),
      overlay: encodeBytes(this.overlay),
      level: encodeBytes(this.level),
      elev: encodeBytes(this.elev),
      wire: encodeBytes(this.wire),
      rail: encodeBytes(this.rail),
      structs: [...this.structs.values()].map((s) => [s.type, s.x, s.y]),
      buildings: [...this.buildings.values()].map((b) => [b.zone, b.size, b.x, b.y]),
      money: this.money,
      year: this.year,
      month: this.month,
      tickInMonth: this.tickInMonth,
      taxRate: this.taxRate,
      bonds: this.bonds,
      funding: { ...this.funding },
      maxPop: this.maxPop,
      ordinances: { ...this.ordinances },
      randomDisasters: this.randomDisasters,
      log: this.log.slice(0, 100),
      history: { pop: this.history.pop.slice(-120), money: this.history.money.slice(-120) },
    };
  }

  static fromJSON(s: SavedCity | SavedCityV4 | SavedCityV3 | SavedCityV2 | SavedCityV1): City {
    if ((s.v !== 1 && s.v !== 2 && s.v !== 3 && s.v !== 4 && s.v !== 5) || s.size !== MAP_SIZE) throw new Error('sauvegarde incompatible');
    const n = MAP_SIZE * MAP_SIZE;
    const cs = MAP_SIZE + 1;
    const elev = s.v !== 1 && s.v !== 2 ? decodeBytes(s.elev, cs * cs) : new Uint8Array(cs * cs);
    const city = new City(s.seed, decodeBytes(s.terrain, n), decodeBytes(s.overlay, n), elev);
    city.level = decodeBytes(s.level, n);
    city.money = s.money;
    city.year = s.year;
    city.month = s.month;
    city.tickInMonth = s.tickInMonth;
    city.taxRate = s.taxRate;
    city.rng = mulberry32(randomSeed());
    if (s.v !== 1) {
      city.name = s.name;
      city.difficulty = s.difficulty;
      city.wire = decodeBytes(s.wire, n);
      city.bonds = s.bonds;
      for (const d of DEPTS) city.funding[d] = s.funding[d] ?? 100;
      // structures are re-stamped so overlay/structId stay consistent
      for (const i of city.overlay.keys()) if (city.overlay[i] === Overlay.Struct) city.overlay[i] = Overlay.None;
      for (const [type, x, y] of s.structs) city.addStruct(type, x, y);
    }
    if (s.v !== 1 && s.v !== 2) {
      for (const [zone, size, x, y] of s.buildings) city.addBuilding(zone, size, x, y, city.level[city.idx(x, y)]);
    }
    if (s.v === 4 || s.v === 5) city.rail = decodeBytes(s.rail, n);
    if (s.v === 5) {
      city.maxPop = s.maxPop;
      for (const k of ORDINANCE_KEYS) city.ordinances[k] = !!s.ordinances[k];
      city.randomDisasters = s.randomDisasters;
      city.log = s.log;
      city.history = s.history;
    }
    return city;
  }
}

export interface SavedCity {
  v: 5;
  seed: number;
  size: number;
  name: string;
  difficulty: Difficulty;
  terrain: string;
  overlay: string;
  level: string;
  elev: string;
  wire: string;
  rail: string;
  structs: [StructType, number, number][];
  buildings: [ZoneType, number, number, number][];
  money: number;
  year: number;
  month: number;
  tickInMonth: number;
  taxRate: number;
  bonds: number;
  funding: Partial<Funding>;
  maxPop: number;
  ordinances: Partial<Record<Ordinance, boolean>>;
  randomDisasters: boolean;
  log: LogEntry[];
  history: History;
}

export interface SavedCityV4 {
  v: 4;
  seed: number;
  size: number;
  name: string;
  difficulty: Difficulty;
  terrain: string;
  overlay: string;
  level: string;
  elev: string;
  wire: string;
  rail: string;
  structs: [StructType, number, number][];
  buildings: [ZoneType, number, number, number][];
  money: number;
  year: number;
  month: number;
  tickInMonth: number;
  taxRate: number;
  bonds: number;
  funding: Partial<Funding>;
}

export interface SavedCityV3 {
  v: 3;
  seed: number;
  size: number;
  name: string;
  difficulty: Difficulty;
  terrain: string;
  overlay: string;
  level: string;
  elev: string;
  wire: string;
  structs: [StructType, number, number][];
  buildings: [ZoneType, number, number, number][];
  money: number;
  year: number;
  month: number;
  tickInMonth: number;
  taxRate: number;
  bonds: number;
  funding: Partial<Funding>;
}

export interface SavedCityV2 {
  v: 2;
  seed: number;
  size: number;
  name: string;
  difficulty: Difficulty;
  terrain: string;
  overlay: string;
  level: string;
  wire: string;
  structs: [StructType, number, number][];
  money: number;
  year: number;
  month: number;
  tickInMonth: number;
  taxRate: number;
  bonds: number;
  funding: Partial<Funding>;
}

export interface SavedCityV1 {
  v: 1;
  seed: number;
  size: number;
  terrain: string;
  overlay: string;
  level: string;
  money: number;
  year: number;
  month: number;
  tickInMonth: number;
  taxRate: number;
}

export function emptyStats(): Stats {
  return {
    pop: 0, jobsC: 0, jobsI: 0, roads: 0, rails: 0, highways: 0, wires: 0,
    zoned: [0, 0, 0, 0, 0, 0, 0], developed: [0, 0, 0, 0, 0, 0, 0],
    unpowered: 0, waterShare: 0, avgLandValue: 60, avgCrime: 0,
    coverage: { police: 0, fire: 0, education: 0, health: 0 },
  };
}

export function emptyBudget(): Budget {
  return { taxR: 0, taxC: 0, taxI: 0, roads: 0, power: 0, water: 0, police: 0, fire: 0, education: 0, health: 0, parks: 0, transport: 0, ordinances: 0, interest: 0 };
}

/** BFS distance to water, 4-neighbourhood, capped at `max` (max+1 = far). */
function computeWaterDist(terrain: Uint8Array, size: number, max: number): Uint8Array {
  const dist = new Uint8Array(size * size).fill(max + 1);
  let frontier: number[] = [];
  for (let i = 0; i < dist.length; i++) {
    if (terrain[i] === Terrain.Water) { dist[i] = 0; frontier.push(i); }
  }
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

function encodeBytes(a: Uint8Array): string {
  let s = '';
  for (let i = 0; i < a.length; i += 0x2000) {
    s += String.fromCharCode(...a.subarray(i, i + 0x2000));
  }
  return btoa(s);
}

function decodeBytes(s: string, length: number): Uint8Array {
  const bin = atob(s);
  if (bin.length !== length) throw new Error('sauvegarde corrompue');
  const a = new Uint8Array(length);
  for (let i = 0; i < length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
