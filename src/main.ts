import './style.css';
import { City } from './game/city';
import { buildDemoCity, type DemoArea } from './game/demo';
import { startDisaster } from './game/disasters';
import { randomSeed } from './game/rng';
import { computeStats, issueBond, recomputeRoadDist, refreshGrid, repayBond, tick } from './game/sim';
import { STRUCTS, isStructTool, structDesc, structName } from './game/structs';
import { applyPlan, planTool, unitCost, type Pt, type ToolPlan } from './game/tools';
import {
  DEPTS, HIGHWAY_CAPACITY, JOBS_C_PER_LEVEL, JOBS_I_PER_LEVEL, NO_ROAD, Overlay, POP_PER_LEVEL,
  ROAD_CAPACITY, Terrain, ZONE_COLOR, isZone, type DataMap, type Difficulty, type DisasterKind, type Tool,
} from './game/types';
import { fmtInt, fmtMoney, setLang, t, type Lang } from './i18n';
import { Renderer } from './render/renderer';
import {
  deleteSave, getCurrentKey, listSaves, loadCity, migrateLegacy, newKey, saveCity, setCurrentKey,
} from './save';
import { Hud, type QueryInfo } from './ui/hud';
import { attachInput } from './ui/input';

const TICK_MS = [0, 120, 60, 30];
const TOOL_COLORS: Partial<Record<Tool, string>> = {
  road: '#c8ccd2',
  rail: '#8a6a45',
  highway: '#9aa0a6',
  wire: '#f2c14e',
  res: ZONE_COLOR[Overlay.Res],
  com: ZONE_COLOR[Overlay.Com],
  ind: ZONE_COLOR[Overlay.Ind],
  bulldoze: '#e0392b',
  raise: '#f2c14e',
  lower: '#b08d57',
  level: '#ffffff',
};
/** tools that act on a single click with a hover preview */
const isClickTool = (tl: Tool) => isStructTool(tl) || tl === 'raise' || tl === 'lower';
const TOOL_KEYS: Record<string, Tool> = {
  r: 'res', c: 'com', i: 'ind', b: 'bulldoze', q: 'query', t: 'road', l: 'wire', n: 'level',
};

const canvas = document.getElementById('map') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

// `?demo` or `?demo=<years>` opens a throwaway pre-built city (never saved).
const params = new URLSearchParams(location.search);
const demoParam = params.get('demo');
const demoMode = demoParam !== null;
// `?lang=fr|en` forces the language (and remembers it)
const langParam = params.get('lang');
if (langParam === 'fr' || langParam === 'en') setLang(langParam);

let city: City = City.generate();
let currentKey: string | null = null;
let demoArea: DemoArea | null = null;
/** the magnifier is the neutral mode: a click or tap tells about a tile, dragging pans */
const NEUTRAL_TOOL: Tool = 'query';
let tool: Tool = NEUTRAL_TOOL;
let speed = 1;
let hover: Pt | null = null;
let dragFrom: Pt | null = null;
let plan: ToolPlan | null = null;
let dirty = true;
/** two-finger gesture in progress: no animation frames, the camera commits are drawn at once */
let gesturing = false;
let unsaved = false;
/** on touch screens a click tool previews on the first tap and places on the second tap of the same tile */
let touchPending: Pt | null = null;
/** a held finger carries a building around: it is placed where the finger lets go */
let holdPlacing = false;

const hud = new Hud({
  onTool: setTool,
  onSpeed: setSpeed,
  onTax: (rate) => { city.taxRate = rate; unsaved = true; },
  onFunding: (dept, pct) => { city.funding[dept] = pct; unsaved = true; },
  onBond: (issue) => {
    const ok = issue ? issueBond(city) : repayBond(city);
    if (!ok) hud.setStatus(t(issue ? 'status.bondMax' : 'status.repayFail'), true);
    hud.update(city);
    unsaved = true;
  },
  onDataMap: setDataMap,
  onNewCity: (name, difficulty, seed) => foundCity(name, difficulty, seed ?? randomSeed()),
  onLoadCity: (key) => {
    const loaded = loadCity(key);
    if (!loaded) { hud.setStatus(t('status.unreadable'), true); return; }
    autosave();
    city = loaded;
    currentKey = key;
    setCurrentKey(key);
    startCity();
    hud.setStatus(t('status.loaded', { name: city.name }));
  },
  onDeleteCity: (key) => {
    const entry = listSaves().find((e) => e.key === key);
    if (!entry || !confirm(t('status.deleteConfirm', { name: entry.name }))) return;
    deleteSave(key);
    hud.setCityList(listSaves(), currentKey);
  },
  onOrdinance: (key, enabled) => { city.ordinances[key] = enabled; unsaved = true; hud.update(city); },
  onMinimap: (x, y) => { renderer.centerOnTile(x, y); dirty = true; },
  onLang: (l: Lang) => { autosave(); setLang(l); location.reload(); },
  lockReason: (tl) => {
    if (!isStructTool(tl)) return null;
    const def = STRUCTS[tl];
    return def.unlockPop && city.maxPop < def.unlockPop ? t('locked', { pop: fmtInt(def.unlockPop) }) : null;
  },
});

function triggerDisaster(kind: DisasterKind): void {
  const msg = startDisaster(city, kind);
  if (speed === 0) setSpeed(1);
  hud.setStatus(msg);
  hud.update(city);
  unsaved = true;
  dirty = true;
}

function setTool(tl: Tool): void {
  tool = tool === tl ? NEUTRAL_TOOL : tl;
  touchPending = null;
  hud.setTool(tool);
  plan = null;
  dragFrom = null;
  hud.setPreview(null);
  if (tool !== 'query') hud.showQuery(null);
  if (hover) previewAtHover();
  dirty = true;
}

function setSpeed(s: number): void {
  speed = s;
  hud.setSpeed(s);
}

function setDataMap(map: DataMap): void {
  renderer.dataMap = map;
  hud.setDataMap(map);
  dirty = true;
}

const TUTO_SEEN_KEY = 'citybuilder.tutoSeen';

function foundCity(name: string, difficulty: Difficulty, seed: number): void {
  autosave();
  city = City.generate(seed, name, difficulty);
  currentKey = newKey();
  setCurrentKey(currentKey);
  demoArea = null;
  startCity();
  city.addLog('log.founded', { name }, 'info');
  saveCity(city, currentKey);
  hud.setCityList(listSaves(), currentKey);
  setSpeed(1);
  hud.setStatus(t('status.founded', { name, road: unitCost('road'), zone: unitCost('res') }));
  // the very first city on this browser opens the tutorial; afterwards it waits behind the ? button
  try {
    if (!localStorage.getItem(TUTO_SEEN_KEY)) {
      localStorage.setItem(TUTO_SEEN_KEY, '1');
      hud.openHelp();
    }
  } catch { /* storage unavailable: no tutorial nag */ }
}

function startCity(): void {
  renderer.city = city;
  recomputeRoadDist(city);
  refreshGrid(city);
  computeStats(city);
  if (demoArea) renderer.centerOnTile(demoArea.x + demoArea.size / 2, demoArea.y + demoArea.size / 2);
  else renderer.centerOnTile(city.size / 2, city.size / 2);
  hud.update(city);
  hud.showQuery(null);
  setDataMap('none');
  dirty = true;
  unsaved = false;
}

function clickPreview(p: Pt): void {
  if (!isClickTool(tool)) return;
  plan = planTool(city, tool, p, p);
  const label = isStructTool(tool) ? structName(tool) : t(tool === 'raise' ? 'tool.raise' : 'tool.lower');
  hud.setPreview(`${t('preview.item', { name: label, cost: fmtMoney(plan.cost) })}${plan.valid ? '' : ` · ${plan.reason ?? ''}`}`);
  dirty = true;
}

function previewAtHover(): void {
  if (!hover) return;
  if (isClickTool(tool)) clickPreview(hover);
  else if (dragFrom) updatePlan(hover);
}

function updatePlan(to: Pt): void {
  if (!dragFrom || tool === 'none' || tool === 'query') return;
  plan = planTool(city, tool, dragFrom, to);
  const n = plan.tiles.length;
  if (!plan.valid) hud.setPreview(plan.reason ?? null);
  else hud.setPreview(n ? t('preview.tiles', { n, cost: fmtInt(plan.cost) }) : null);
  dirty = true;
}

function commitPlan(): void {
  if (!plan) return;
  const res = applyPlan(city, plan);
  if (res.ok) {
    computeStats(city);
    hud.update(city);
    unsaved = true;
  } else {
    hud.setStatus(res.reason, true);
  }
}

function queryTile(p: Pt): void {
  if (!city.inBounds(p.x, p.y)) return;
  const i = city.idx(p.x, p.y);
  const o = city.overlay[i] as Overlay;
  const lvl = city.level[i];
  const info: QueryInfo = { title: '', lines: [t('query.tile', { x: p.x, y: p.y })] };
  const grade = (v: number, steps: [number, string][]) => t(steps.find(([max]) => v < max)?.[1] ?? steps[steps.length - 1][1]);
  const rd = city.roadDist[i];
  const roadLine = rd === NO_ROAD ? t('query.noRoad') : rd === 0 ? t('query.onRoad') : t('query.roadAt', { n: rd });
  const water = city.terrain[i] === Terrain.Water;
  const trafficLine = () => {
    const cap = o === Overlay.Highway ? HIGHWAY_CAPACITY : ROAD_CAPACITY;
    const n = city.traffic[i];
    const state = n < cap * 0.5 ? 'state.free' : n < cap ? 'state.dense' : 'state.jammed';
    return t('query.traffic', { n: fmtInt(n), state: t(state) });
  };

  if (o === Overlay.Highway) { info.title = t(water ? 'query.hwyBridge' : 'query.highway'); info.lines.push(trafficLine()); }
  else if (water && o !== Overlay.Road) info.title = t(city.rail[i] ? 'query.railBridge' : 'query.water');
  else if (o === Overlay.Rubble) { info.title = t('query.rubble'); info.lines.push(t('query.rubbleHint')); }
  else if (o === Overlay.None) info.title = t(city.rail[i] ? 'query.rail' : 'query.bare');
  else if (o === Overlay.Tree) info.title = t('query.forest');
  else if (o === Overlay.Road) {
    info.title = t(water ? 'query.bridge' : city.rail[i] ? 'query.crossing' : city.wire[i] ? 'query.roadWire' : 'query.road');
    info.lines.push(trafficLine());
  } else if (o === Overlay.Struct) {
    const s = city.structAt(i)!;
    const def = STRUCTS[s.type];
    info.title = structName(s.type);
    info.lines.push(structDesc(s.type), t('query.upkeep', { amt: fmtMoney(def.upkeep) }));
    if (def.power) info.lines.push(t('query.produces', { mw: def.power }));
    if (def.consumes) info.lines.push(t(city.powered[city.idx(s.x, s.y)] ? 'query.powered' : 'query.unpowered'));
    if (def.dept) info.lines.push(t('query.funding', { pct: city.funding[def.dept] }));
  } else if (isZone(o)) {
    info.title = t('query.zone', { label: t(`zone.${o}`), lvl });
    if (lvl === 0) info.lines.push(t('query.empty'));
    else if (o === Overlay.Res) info.lines.push(t('query.pop', { n: POP_PER_LEVEL[lvl] }));
    else info.lines.push(t('query.jobs', { n: o === Overlay.Com ? JOBS_C_PER_LEVEL[lvl] : JOBS_I_PER_LEVEL[lvl] }));
    info.lines.push(roadLine);
    if (rd !== NO_ROAD) {
      info.lines.push(t(o === Overlay.Res ? (city.access[i] ? 'query.jobsOk' : 'query.jobsNo') : (city.access[i] ? 'query.workersOk' : 'query.workersNo')));
    }
    info.lines.push(t(city.powered[i] ? 'query.powerYes' : 'query.powerNo'));
    info.lines.push(t(city.watered[i] ? 'query.waterYes' : 'query.waterNo'));
  }
  if (city.fire[i]) info.lines.unshift(t('query.onFire'));
  if (city.flood[i]) info.lines.unshift(t('query.flooded', { n: city.flood[i] }));
  if (!water) {
    info.lines.push(t('query.altitude', { h: city.base(p.x, p.y) }) + (city.isFlat(p.x, p.y) ? '' : t('query.slope')));
    if (city.wire[i] && o !== Overlay.Road) info.lines.push(t('query.wire'));
    info.lines.push(t('query.lv', { label: grade(city.landValue[i], [[40, 'lv.low'], [80, 'lv.mid'], [130, 'lv.good'], [256, 'lv.great']]), v: city.landValue[i] }));
    info.lines.push(t('query.pollution', { label: grade(city.pollution[i], [[1, 'level.none'], [40, 'level.low'], [90, 'level.mid'], [256, 'level.high']]) }));
    if (isZone(o)) info.lines.push(t('query.crime', { label: grade(city.crime[i], [[1, 'level.none'], [30, 'level.low'], [80, 'level.mid'], [256, 'level.high']]) }));
    const covered = DEPTS.filter((d) => city.cover[d][i] >= 64).map((d) => t(`dept.${d}`).toLowerCase());
    info.lines.push(covered.length ? t('query.services', { list: covered.join(', ') }) : t('query.noServices'));
  }
  hud.showQuery(info);
}

attachInput(canvas, renderer, {
  toolActive: () => tool !== 'none' && tool !== 'query',
  onHover: (p) => {
    hover = p;
    if (p && isClickTool(tool)) clickPreview(p);
    dirty = true;
  },
  onDragStart: (p, touch, hold = false) => {
    if (tool === 'query') { queryTile(p); return; }
    if (tool === 'none') return;
    if (isClickTool(tool)) {
      if (hold) {
        // held: show the footprint under the finger, place it on release
        holdPlacing = true;
        touchPending = null;
        hover = p;
        clickPreview(p);
        hud.setStatus(t('touch.release'), true);
        return;
      }
      if (touch && !(touchPending && touchPending.x === p.x && touchPending.y === p.y)) {
        // first tap: show the footprint, ask for a second tap
        hover = p;
        touchPending = p;
        clickPreview(p);
        hud.setStatus(t('touch.confirm'), true);
        return;
      }
      touchPending = null;
      clickPreview(p);
      commitPlan();
      clickPreview(p);
      return;
    }
    dragFrom = p;
    updatePlan(p);
  },
  onDrag: (p) => {
    if (holdPlacing) { hover = p; clickPreview(p); return; }
    updatePlan(p);
  },
  onDragEnd: (p) => {
    if (holdPlacing) {
      holdPlacing = false;
      hover = p;
      clickPreview(p);
      commitPlan();
      clickPreview(p);
      dirty = true;
      return;
    }
    if (!dragFrom) return;
    updatePlan(p);
    commitPlan();
    dragFrom = null;
    plan = null;
    hud.setPreview(null);
    dirty = true;
  },
  onDragCancel: () => {
    holdPlacing = false;
    dragFrom = null;
    plan = null;
    hud.setPreview(null);
    dirty = true;
  },
  onCameraChange: () => { dirty = true; if (gesturing) render(performance.now()); },
  onGesture: (active) => { gesturing = active; if (!active) dirty = true; },
  onKey: (key) => {
    const k = key.toLowerCase();
    if (k === 'escape') { hud.closePanels(); if (tool !== NEUTRAL_TOOL) setTool(NEUTRAL_TOOL); return true; }
    if (k === ' ') return false;
    if (k in TOOL_KEYS) { setTool(TOOL_KEYS[k]); return true; }
    if (k === 'p') { setSpeed(speed === 0 ? 1 : 0); return true; }
    if (k === '1' || k === '2' || k === '3') { setSpeed(Number(k)); return true; }
    return false;
  },
});

// ---- main loop -------------------------------------------------------------

let last = performance.now();
let acc = 0;
let lastAnim = 0;

function frame(now: number): void {
  const dt = Math.min(250, now - last);
  last = now;

  const ms = TICK_MS[speed];
  if (ms > 0) {
    acc += dt;
    let steps = 0;
    while (acc >= ms && steps < 8) {
      const r = tick(city);
      acc -= ms;
      steps++;
      dirty = true;
      unsaved = true;
      if (r.monthEnded) {
        hud.update(city);
        if (r.messages.length) hud.setStatus(r.messages[0]);
      }
    }
    if (steps === 8) acc = 0;
  } else {
    acc = 0;
  }

  // cars, water, fire and disasters keep moving while the simulation runs
  if (city.shakeMs > 0) { city.shakeMs = Math.max(0, city.shakeMs - dt); dirty = true; }
  if (!gesturing && (speed > 0 || city.actors.length || city.burning) && now - lastAnim > 60) { dirty = true; lastAnim = now; }

  if (dirty && !gesturing) render(now);
  requestAnimationFrame(frame);
}

function render(now: number): void {
  let preview = null;
  if (plan && isStructTool(tool)) preview = { tiles: plan.footprint ?? [], color: plan.valid ? '#3fb34f' : '#e0392b' };
  else if (plan && tool in TOOL_COLORS) preview = { tiles: plan.tiles, color: plan.valid ? TOOL_COLORS[tool]! : '#e0392b' };
  renderer.draw(city, hover, preview, now);
  hud.drawMinimap(city, renderer, now);
  dirty = false;
}

window.addEventListener('resize', () => { renderer.resize(); dirty = true; });

function autosave(): void {
  if (!unsaved || demoMode || !currentKey) return;
  computeStats(city);
  saveCity(city, currentKey);
  unsaved = false;
}
window.setInterval(autosave, 15000);
window.addEventListener('pagehide', autosave);
document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });

// ---- boot ------------------------------------------------------------------

function boot(): void {
  document.getElementById('version')!.textContent = `v${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}`;
  hud.setTool(tool);
  if (demoMode) {
    city = City.generate(randomSeed(), 'Demo');
    demoArea = buildDemoCity(city, { years: Number(demoParam) || 10, showcase: params.has('showcase') });
    startCity();
    setSpeed(1);
    hud.setStatus(t('status.demo'));
    const map = params.get('map') as DataMap | null;
    if (map) setDataMap(map);
    const zoom = Number(params.get('zoom'));
    if (zoom) { renderer.camera.zoom = zoom; dirty = true; }
    const disaster = params.get('disaster') as DisasterKind | null;
    if (disaster) {
      triggerDisaster(disaster);
      // look at what we just unleashed
      const a = city.actors[0];
      const burning = city.fire.findIndex((f) => f > 0);
      if (a) renderer.centerOnTile(a.x, a.y);
      else if (burning >= 0) renderer.centerOnTile(burning % city.size, Math.floor(burning / city.size));
    }
    if (params.get('panel') === 'budget') hud.openPanel('panel-budget');
    if (params.get('panel') === 'journal') { hud.openPanel('panel-journal'); hud.update(city); }
    if (params.has('welcome')) { setSpeed(0); hud.openWelcome(true); }
    requestAnimationFrame(frame);
    return;
  }
  migrateLegacy();
  const saves = listSaves();
  const key = getCurrentKey() ?? saves[0]?.key ?? null;
  const loaded = key ? loadCity(key) : null;
  hud.setCityList(saves, key);
  if (loaded && key) {
    city = loaded;
    currentKey = key;
    setCurrentKey(key);
    startCity();
    setSpeed(1);
    hud.setStatus(t('status.restored', { name: city.name }));
  } else {
    startCity();
    setSpeed(0);
    hud.openWelcome(true);
  }
  requestAnimationFrame(frame);
}

boot();

