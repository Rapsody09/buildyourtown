import { t } from '../i18n';
import type { Dept, StructType, Tool } from './types';

export interface StructDef {
  /** footprint side, in tiles */
  size: number;
  cost: number;
  /** monthly */
  upkeep: number;
  /** service / park / water reach, in tiles (Euclidean) */
  radius?: number;
  /** MW produced */
  power?: number;
  /** MW drawn */
  consumes?: number;
  /** pollution emitted at the centre, spreads over `pollutionRadius` */
  pollution?: number;
  pollutionRadius?: number;
  dept?: Dept;
  category: 'power' | 'water' | 'service' | 'park' | 'transport' | 'reward';
  /** rewards: population needed before the mayor may build it */
  unlockPop?: number;
  /** arcologies: residents and internal jobs */
  pop?: number;
  jobs?: number;
  /** must touch a water tile */
  needsShore?: boolean;
}

export const STRUCTS: Record<StructType, StructDef> = {
  wind: { size: 1, cost: 300, upkeep: 1, power: 8, category: 'power' },
  coal: { size: 3, cost: 3000, upkeep: 15, power: 400, pollution: 60, pollutionRadius: 6, category: 'power' },
  gas: { size: 3, cost: 4500, upkeep: 15, power: 300, pollution: 25, pollutionRadius: 5, category: 'power' , unlockPop: 2500},
  nuclear: { size: 4, cost: 15000, upkeep: 50, power: 1500, category: 'power' , unlockPop: 20000},
  pump: { size: 1, cost: 300, upkeep: 2, radius: 10, consumes: 1, category: 'water', needsShore: true },
  tower: { size: 2, cost: 600, upkeep: 3, radius: 7, consumes: 2, category: 'water' },
  police: { size: 2, cost: 500, upkeep: 10, radius: 10, consumes: 1, dept: 'police', category: 'service' },
  fire: { size: 2, cost: 500, upkeep: 10, radius: 10, consumes: 1, dept: 'fire', category: 'service' },
  school: { size: 3, cost: 400, upkeep: 8, radius: 12, consumes: 1, dept: 'education', category: 'service' },
  hospital: { size: 3, cost: 800, upkeep: 12, radius: 12, consumes: 1, dept: 'health', category: 'service' , unlockPop: 2500},
  park: { size: 1, cost: 20, upkeep: 0.5, radius: 3, category: 'park' },
  bigpark: { size: 2, cost: 150, upkeep: 2, radius: 5, category: 'park' , unlockPop: 1000},
  station: { size: 2, cost: 500, upkeep: 8, consumes: 1, category: 'transport' , unlockPop: 5000},
  bus: { size: 2, cost: 300, upkeep: 10, radius: 12, consumes: 1, category: 'transport' , unlockPop: 1000},
  port: { size: 3, cost: 5000, upkeep: 40, consumes: 2, category: 'transport', needsShore: true , unlockPop: 10000},
  airport: { size: 4, cost: 10000, upkeep: 80, consumes: 3, pollution: 20, pollutionRadius: 5, category: 'transport' , unlockPop: 20000},
  cityhall: { size: 3, cost: 0, upkeep: 20, radius: 8, consumes: 1, category: 'reward', unlockPop: 2000 },
  statue: { size: 1, cost: 0, upkeep: 1, radius: 4, category: 'reward', unlockPop: 5000 },
  mansion: { size: 2, cost: 0, upkeep: 10, radius: 6, consumes: 1, category: 'reward', unlockPop: 10000 },
  arcology: { size: 4, cost: 30000, upkeep: 200, consumes: 60, pop: 15000, jobs: 5000, category: 'reward', unlockPop: 25000 },
};

export function structName(type: StructType): string {
  return t(`struct.${type}`);
}

export function structDesc(type: StructType): string {
  return t(`struct.${type}.desc`);
}

export function isStructTool(tool: Tool): tool is StructType {
  return tool in STRUCTS;
}

export interface Struct {
  id: number;
  type: StructType;
  x: number;
  y: number;
}
