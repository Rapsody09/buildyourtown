import { City, type SavedCity, type SavedCityV1 } from './game/city';

const INDEX = 'citybuilder.index';
const CURRENT = 'citybuilder.current';
const PREFIX = 'citybuilder.city.';
const LEGACY = 'citybuilder.save.v1';
const RESCUE = 'citybuilder.rescue.';

export interface SaveEntry {
  key: string;
  name: string;
  pop: number;
  year: number;
  month: number;
  savedAt: number;
}

function readIndex(): SaveEntry[] {
  try {
    const raw = localStorage.getItem(INDEX);
    return raw ? (JSON.parse(raw) as SaveEntry[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: SaveEntry[]): void {
  localStorage.setItem(INDEX, JSON.stringify(entries));
}

export function listSaves(): SaveEntry[] {
  return readIndex().sort((a, b) => b.savedAt - a.savedAt);
}

export function newKey(): string {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

export function saveCity(city: City, key: string): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(city.toJSON()));
    const entry: SaveEntry = { key, name: city.name, pop: city.stats.pop, year: city.year, month: city.month, savedAt: Date.now() };
    const index = readIndex().filter((e) => e.key !== key);
    index.push(entry);
    writeIndex(index);
    return true;
  } catch (e) {
    console.warn('sauvegarde impossible', e);
    return false;
  }
}

export function loadCity(key: string): City | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return City.fromJSON(JSON.parse(raw) as SavedCity | SavedCityV1);
  } catch (e) {
    console.warn('sauvegarde illisible', e);
    return null;
  }
}

export function deleteSave(key: string): void {
  localStorage.removeItem(PREFIX + key);
  localStorage.removeItem(RESCUE + key);
  writeIndex(readIndex().filter((e) => e.key !== key));
  if (getCurrentKey() === key) localStorage.removeItem(CURRENT);
}

/** Snapshot taken when a city first dips under its funds floor: the way back offered on bankruptcy. */
export function saveRescue(city: City, key: string): void {
  try {
    localStorage.setItem(RESCUE + key, JSON.stringify(city.toJSON()));
  } catch (e) {
    console.warn('sauvegarde de secours impossible', e);
  }
}

export function loadRescue(key: string): City | null {
  try {
    const raw = localStorage.getItem(RESCUE + key);
    return raw ? City.fromJSON(JSON.parse(raw) as SavedCity) : null;
  } catch {
    return null;
  }
}

export function hasRescue(key: string): boolean {
  try { return localStorage.getItem(RESCUE + key) !== null; } catch { return false; }
}

export function getCurrentKey(): string | null {
  return localStorage.getItem(CURRENT);
}

export function setCurrentKey(key: string): void {
  localStorage.setItem(CURRENT, key);
}

/** Imports the single-slot save from the first version, if present. */
export function migrateLegacy(): void {
  try {
    const raw = localStorage.getItem(LEGACY);
    if (!raw) return;
    const city = City.fromJSON(JSON.parse(raw) as SavedCityV1);
    city.name = 'Ville importée';
    const key = newKey();
    saveCity(city, key);
    setCurrentKey(key);
    localStorage.removeItem(LEGACY);
  } catch (e) {
    console.warn('ancienne sauvegarde ignorée', e);
    localStorage.removeItem(LEGACY);
  }
}
