// Headless balance check: builds a fixed grid city and simulates N years.
// Run with: make simtest ARGS="<years> <seed> <taxRate> <mixed|res-only|bare>"
import { budgetExpenses, budgetIncome, City } from '../src/game/city';
import { buildDemoCity } from '../src/game/demo';
import { startDisaster } from '../src/game/disasters';
import { tick } from '../src/game/sim';
import { Overlay, Terrain, TICKS_PER_MONTH, isZone } from '../src/game/types';

const years = Number(process.argv[2] ?? 30);
const seed = Number(process.argv[3] ?? 12345);
const taxRate = Number(process.argv[4] ?? 7);
const difficulty = (process.argv[6] ?? 'moyen') as 'facile' | 'moyen' | 'difficile';
const modeArg = process.argv[5] ?? 'mixed';
const mode = modeArg === 'res-only' ? 'res-only' : 'mixed';
const bare = modeArg === 'bare';
const disasterAt = modeArg === 'disasters' ? Math.floor(years / 2) : -1;

const city = City.generate(seed, 'Test', difficulty);
city.taxRate = taxRate;
console.log(`difficulté : ${difficulty}, fonds de départ ${city.money}`);

let water = 0, trees = 0;
for (let i = 0; i < city.count; i++) {
  if (city.terrain[i] === Terrain.Water) water++;
  else if (city.overlay[i] === Overlay.Tree) trees++;
}
let flat = 0, landTiles = 0;
const hist = new Map<number, number>();
for (let y = 0; y < city.size; y++) {
  for (let x = 0; x < city.size; x++) {
    if (city.terrain[city.idx(x, y)] !== Terrain.Land) continue;
    landTiles++;
    if (city.isFlat(x, y)) flat++;
    const h = city.base(x, y);
    hist.set(h, (hist.get(h) ?? 0) + 1);
  }
}
console.log(`terrain: eau ${(100 * water / city.count).toFixed(1)} %, forêt ${(100 * trees / city.count).toFixed(1)} %, terre plate ${(100 * flat / landTiles).toFixed(0)} %`);
console.log('altitudes (cases de terre) : ' + [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([h, n]) => `${h}:${n}`).join(' '));

const area = buildDemoCity(city, { mode, bare });
console.log(`zone de test: (${area.x},${area.y}) taille ${area.size}, ${area.land} cases de terre`);
console.log(`routes ${city.stats.roads}, zones R ${city.stats.zoned[Overlay.Res]} C ${city.stats.zoned[Overlay.Com]} I ${city.stats.zoned[Overlay.Ind]}, structures ${city.structs.size}\n`);

const f = (n: number, w: number) => String(n).padStart(w);
console.log('année   pop  jobsC  jobsI    fonds  rec.  dép.   dR    dC    dI   MW dem/cap  sansE  eau%  VF crim  niveaux R (1..5)          niveaux C          niveaux I');
let minMoney = Infinity;
for (let y = 0; y < years; y++) {
  if (y === disasterAt) {
    const popBefore = city.stats.pop;
    for (const k of ['quake', 'fire', 'tornado', 'flood'] as const) startDisaster(city, k);
    for (let t = 0; t < 12 * TICKS_PER_MONTH; t++) tick(city);
    let rubble = 0;
    for (let i = 0; i < city.count; i++) if (city.overlay[i] === Overlay.Rubble) rubble++;
    console.log(`--- catastrophes déclenchées : population ${popBefore} -> ${city.stats.pop}, ${rubble} cases de décombres, journal : ${city.log.slice(0, 5).map((e) => e.key ?? e.text).join(' | ')}`);
    continue;
  }
  for (let t = 0; t < 12 * TICKS_PER_MONTH; t++) tick(city);
  minMoney = Math.min(minMoney, city.money);
  const lv: Record<number, number[]> = { [Overlay.Res]: [0, 0, 0, 0, 0, 0], [Overlay.Com]: [0, 0, 0, 0, 0, 0], [Overlay.Ind]: [0, 0, 0, 0, 0, 0] };
  for (let i = 0; i < city.count; i++) if (isZone(city.overlay[i])) lv[city.overlay[i]][city.level[i]]++;
  const s = city.stats, d = city.demand, b = city.lastBudget;
  const lvs = (a: number[]) => a.slice(1).map((n) => f(n, 3)).join(' ');
  console.log(`${city.year} ${f(s.pop, 6)} ${f(s.jobsC, 6)} ${f(s.jobsI, 6)} ${f(city.money, 8)} ${f(Math.round(budgetIncome(b)), 5)} ${f(Math.round(budgetExpenses(b)), 5)}  ${d.r.toFixed(2).padStart(5)} ${d.c.toFixed(2).padStart(5)} ${d.i.toFixed(2).padStart(5)}  ${f(Math.round(city.power.demand), 5)}/${f(Math.round(city.power.supply), 5)} ${f(s.unpowered, 5)} ${f(Math.round(s.waterShare * 100), 5)} ${f(Math.round(s.avgLandValue), 3)} ${f(Math.round(s.avgCrime), 4)}  ${lvs(lv[Overlay.Res])}   ${lvs(lv[Overlay.Com])}   ${lvs(lv[Overlay.Ind])}`);
}
console.log(`\nfonds minimum atteint : ${minMoney}`);
let maxT = 0, roadsN = 0, busy = 0;
for (let i = 0; i < city.count; i++) {
  if (city.overlay[i] !== Overlay.Road && city.overlay[i] !== 7) continue;
  roadsN++;
  maxT = Math.max(maxT, city.traffic[i]);
  if (city.traffic[i] > 300) busy++;
}
console.log(`trafic : max ${maxT} navetteurs/case, ${busy}/${roadsN} cases chargées, ${city.jammed} saturées, ${Math.round(city.tripFailShare * 100)} % de trajets impossibles`);
const sizes = new Map<string, number>();
for (const b of city.buildings.values()) { const k = `${b.size}x${b.size} ${['', '', '', 'R', 'C', 'I'][b.zone]}`; sizes.set(k, (sizes.get(k) ?? 0) + 1); }
console.log('bâtiments fusionnés : ' + ([...sizes.entries()].map(([k, n]) => `${k}=${n}`).join(', ') || 'aucun'));
const c = city.stats.coverage;
console.log(`couvertures (hab.) police ${Math.round(c.police * 100)} %, pompiers ${Math.round(c.fire * 100)} %, école ${Math.round(c.education * 100)} %, hôpital ${Math.round(c.health * 100)} %`);
