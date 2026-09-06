export const MAP_SIZE = 128;
export const TICKS_PER_MONTH = 25;

export enum Terrain {
  Land = 0,
  Water = 1,
}

export enum Overlay {
  None = 0,
  Tree = 1,
  Road = 2,
  Res = 3,
  Com = 4,
  Ind = 5,
  /** part of a placed structure (power plant, service building, park…) */
  Struct = 6,
  /** high-capacity road; zones do not get access from it */
  Highway = 7,
  /** what a disaster leaves behind; must be bulldozed */
  Rubble = 8,
}

export function isRoadway(o: Overlay): boolean {
  return o === Overlay.Road || o === Overlay.Highway;
}

export type ZoneType = Overlay.Res | Overlay.Com | Overlay.Ind;

export function isZone(o: Overlay): o is ZoneType {
  return o >= Overlay.Res && o <= Overlay.Ind;
}

export const MAX_LEVEL = 5;
/** roadDist value meaning "no road within reach". */
export const NO_ROAD = 255;
export const ROAD_REACH = 3;
/** highest terrain corner */
export const MAX_ELEV = 16;

export const COST = {
  road: 10,
  /** road tile over water */
  bridge: 50,
  rail: 25,
  railBridge: 75,
  highway: 50,
  highwayBridge: 250,
  wire: 5,
  /** pylon standing in water */
  wireWater: 15,
  zone: 30,
  bulldoze: 1,
  /** per corner moved by one level */
  terraform: 5,
  /** per tile and per month */
  roadUpkeep: 0.15,
  railUpkeep: 0.2,
  highwayUpkeep: 0.4,
  wireUpkeep: 0.05,
};

/** commuters a tile carries per month before it clogs */
export const ROAD_CAPACITY = 1200;
export const HIGHWAY_CAPACITY = 4800;
/** longest acceptable commute, in weighted network steps */
export const MAX_TRIP = 60;

export const BOND_AMOUNT = 10000;

export const START_YEAR = 1900;
export const DEFAULT_TAX = 7;

export interface DifficultyDef {
  money: number;
  /** multiplies residential, commercial and industrial demand */
  demandMul: number;
  /** multiplies every monthly expense */
  costMul: number;
  /** multiplies the odds of random disasters */
  disasterMul: number;
  /** funds floor: staying below it for BANKRUPT_MONTHS months loses the game */
  bankruptAt: number;
  /** how many bonds may be outstanding at once */
  maxBonds: number;
  /** yearly interest on bonds */
  bondRate: number;
}
export const DIFFICULTIES: Record<'facile' | 'moyen' | 'difficile', DifficultyDef> = {
  facile: { money: 20000, demandMul: 1.15, costMul: 0.85, disasterMul: 0.5, bondRate: 0.05, bankruptAt: -10000, maxBonds: 5 },
  moyen: { money: 10000, demandMul: 1.0, costMul: 1.0, disasterMul: 1.0, bondRate: 0.06, bankruptAt: -5000, maxBonds: 3 },
  difficile: { money: 5000, demandMul: 0.85, costMul: 1.25, disasterMul: 1.6, bondRate: 0.08, bankruptAt: 0, maxBonds: 2 },
};
export type Difficulty = keyof typeof DIFFICULTIES;
/** months in a row under the difficulty's funds floor before the council removes the mayor */
export const BANKRUPT_MONTHS = 6;
/** tools (not buildings) that unlock with the population reached */
export const TOOL_UNLOCK: Partial<Record<Tool, number>> = { rail: 5000, highway: 10000 };

export const POP_PER_LEVEL = [0, 8, 16, 32, 64, 128];
export const JOBS_C_PER_LEVEL = [0, 6, 12, 24, 48, 96];
export const JOBS_I_PER_LEVEL = [0, 8, 16, 32, 64, 128];

/** MW drawn per density level */
export const POWER_USE: Record<ZoneType, number> = {
  [Overlay.Res]: 0.4,
  [Overlay.Com]: 0.6,
  [Overlay.Ind]: 1.0,
};

export type Dept = 'police' | 'fire' | 'education' | 'health';
export const DEPTS: Dept[] = ['police', 'fire', 'education', 'health'];

export type StructType =
  | 'wind' | 'coal' | 'gas' | 'nuclear'
  | 'pump' | 'tower'
  | 'police' | 'fire' | 'school' | 'hospital'
  | 'park' | 'bigpark'
  | 'station' | 'bus' | 'port' | 'airport'
  | 'cityhall' | 'statue' | 'mansion' | 'arcology';

export type Tool = 'none' | 'query' | 'road' | 'rail' | 'highway' | 'wire' | 'res' | 'com' | 'ind' | 'bulldoze' | 'raise' | 'lower' | 'level' | StructType;

export const ZONE_OF_TOOL: Partial<Record<Tool, ZoneType>> = {
  res: Overlay.Res,
  com: Overlay.Com,
  ind: Overlay.Ind,
};

export const ZONE_COLOR: Record<ZoneType, string> = {
  [Overlay.Res]: '#3fb34f',
  [Overlay.Com]: '#3d7fe0',
  [Overlay.Ind]: '#e3b52a',
};

export type DisasterKind = 'fire' | 'flood' | 'tornado' | 'quake';
export const DISASTER_KINDS: DisasterKind[] = ['fire', 'flood', 'tornado', 'quake'];

export type Ordinance = 'watch' | 'cleanAir' | 'tourism' | 'energy' | 'parking';
/** monthly cost per inhabitant (negative = income) */
export const ORDINANCES: Record<Ordinance, { costPerCapita: number }> = {
  watch: { costPerCapita: 0.01 },
  cleanAir: { costPerCapita: 0.015 },
  tourism: { costPerCapita: 0.01 },
  energy: { costPerCapita: 0.005 },
  parking: { costPerCapita: -0.02 },
};
export const ORDINANCE_KEYS = Object.keys(ORDINANCES) as Ordinance[];

export interface LogEntry {
  year: number;
  month: number;
  kind: 'info' | 'warn' | 'disaster' | 'reward';
  /** dictionary key, rendered in the current language */
  key?: string;
  params?: Record<string, string | number>;
  /** entries saved before translations existed */
  text?: string;
}

export type DataMap =
  | 'none' | 'pollution' | 'crime' | 'landValue' | 'traffic' | 'power' | 'water'
  | 'police' | 'fire' | 'education' | 'health';

export const DATA_MAPS: DataMap[] = ['none', 'pollution', 'crime', 'landValue', 'traffic', 'power', 'water', 'police', 'fire', 'education', 'health'];
