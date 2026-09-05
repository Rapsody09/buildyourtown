import { budgetExpenses, budgetIncome, type City } from '../game/city';
import { randomSeed } from '../game/rng';
import { advice } from '../game/sim';
import { STRUCTS, isStructTool, structDesc, structName } from '../game/structs';
import {
  BOND_AMOUNT, DATA_MAPS, DEPTS, DIFFICULTIES, MAX_BONDS, ORDINANCES, ORDINANCE_KEYS,
  Overlay, Terrain, type DataMap, type Dept, type Difficulty, type Ordinance, type StructType, type Tool,
} from '../game/types';
import { fmtInt, fmtMoney, lang, months, t, type Lang } from '../i18n';
import { renderIcon } from '../render/sprites';
import { Renderer } from '../render/renderer';
import type { SaveEntry } from '../save';
import { renderPreview } from './preview';

export interface HudHandlers {
  onTool(tool: Tool): void;
  onSpeed(speed: number): void;
  onTax(rate: number): void;
  onFunding(dept: Dept, pct: number): void;
  onBond(issue: boolean): void;
  onDataMap(map: DataMap): void;
  /** seed null = random map */
  onNewCity(name: string, difficulty: Difficulty, seed: number | null): void;
  onLoadCity(key: string): void;
  onDeleteCity(key: string): void;
  onOrdinance(key: Ordinance, enabled: boolean): void;
  onLang(lang: Lang): void;
  /** the player tapped the minimap: look there */
  onMinimap(x: number, y: number): void;
  /** why a tool cannot be used right now (locked reward), or null */
  lockReason(tool: Tool): string | null;
}

export interface QueryInfo {
  title: string;
  lines: string[];
}

interface FlyoutItem {
  tool: Tool;
  name: string;
  meta: string;
  desc: string;
  icon: () => HTMLCanvasElement;
}

type ToolbarEntry =
  | { tool: Tool; label: string; key: string; cost?: string; icon: () => HTMLCanvasElement }
  | { group: string; items: FlyoutItem[]; icon: () => HTMLCanvasElement };

/** toolbar thumbnails are rendered large; the flyout shows the same canvases scaled down by CSS */
const ICON = 68;
/** the building fills the square: toolbar buttons zoom in more than flyout items */
const ZOOM_BAR = 1.6, ZOOM_ITEM = 1.35;
const structIcon = (type: StructType, zoom = ZOOM_ITEM) => () => renderIcon([`st:${type}`], STRUCTS[type].size, ICON, zoom);
const tileIcon = (keys: string[], zoom = ZOOM_ITEM) => () => renderIcon(keys, 1, ICON, zoom);

const structItems = (types: StructType[]): FlyoutItem[] => types.map((type) => {
  const def = STRUCTS[type];
  return {
    tool: type,
    name: structName(type),
    meta: t('struct.meta', { size: def.size, cost: fmtMoney(def.cost), upkeep: fmtMoney(def.upkeep) }),
    desc: structDesc(type),
    icon: structIcon(type),
  };
});

function toolbarEntries(): ToolbarEntry[] {
  return [
    { tool: 'query', label: t('tool.query'), key: 'Q', icon: queryIcon },
    { tool: 'res', label: t('tool.res'), key: 'R', cost: t('perTile', { n: 30 }), icon: tileIcon(['bld:3:1:2'], ZOOM_BAR) },
    { tool: 'com', label: t('tool.com'), key: 'C', cost: t('perTile', { n: 30 }), icon: tileIcon(['bld:4:2:0'], ZOOM_BAR) },
    { tool: 'ind', label: t('tool.ind'), key: 'I', cost: t('perTile', { n: 30 }), icon: tileIcon(['bld:5:2:0'], ZOOM_BAR) },
    {
      group: t('group.transport'), icon: tileIcon(['road:10:0000'], ZOOM_BAR), items: [
        { tool: 'road', name: `${t('tool.road')} (T)`, meta: t('perTile', { n: 10 }), desc: t('tool.road.desc'), icon: tileIcon(['road:10:0000']) },
        { tool: 'rail', name: t('tool.rail'), meta: t('tool.rail.meta'), desc: t('tool.rail.desc'), icon: tileIcon(['grass:0000:0', 'rail:10:0000']) },
        { tool: 'highway', name: t('tool.highway'), meta: t('tool.highway.meta'), desc: t('tool.highway.desc'), icon: tileIcon(['hwy:10:0000']) },
        ...structItems(['station', 'bus', 'port', 'airport']),
      ],
    },
    {
      group: t('group.energy'), icon: structIcon('wind', ZOOM_BAR), items: [
        { tool: 'wire', name: `${t('tool.wire')} (L)`, meta: t('perTile', { n: 5 }), desc: t('tool.wire.desc'), icon: tileIcon(['grass:0000:0', 'wire:10:0000']) },
        ...structItems(['wind', 'coal', 'gas', 'nuclear']),
      ],
    },
    { group: t('group.water'), icon: structIcon('tower', ZOOM_BAR), items: structItems(['pump', 'tower']) },
    { group: t('group.services'), icon: structIcon('hospital', ZOOM_BAR), items: structItems(['police', 'fire', 'school', 'hospital']) },
    { group: t('group.parks'), icon: structIcon('bigpark', ZOOM_BAR), items: structItems(['park', 'bigpark', 'statue', 'cityhall', 'mansion', 'arcology']) },
    {
      group: t('tool.bulldoze'), icon: tileIcon(['icon:bulldozer'], 1.5), items: [
        { tool: 'bulldoze', name: `${t('tool.bulldoze')} (B)`, meta: t('perTile', { n: 1 }), desc: t('tool.bulldoze.desc'), icon: tileIcon(['icon:bulldozer'], 1.3) },
        { tool: 'raise', name: t('tool.raise'), meta: t('tool.terra.meta'), desc: t('tool.raise.desc'), icon: tileIcon(['grass:1100:0']) },
        { tool: 'lower', name: t('tool.lower'), meta: t('tool.terra.meta'), desc: t('tool.lower.desc'), icon: tileIcon(['grass:0011:0']) },
        { tool: 'level', name: t('tool.level'), meta: t('tool.terra.meta'), desc: t('tool.level.desc'), icon: tileIcon(['grass:0000:0']) },
      ],
    },
  ];
}

function queryIcon(): HTMLCanvasElement {
  const c = renderIcon(['grass:0000:1'], 1, ICON);
  const ctx = c.getContext('2d')!;
  const k = ICON / 44;
  ctx.strokeStyle = '#f3ecd8';
  ctx.lineWidth = 3 * k;
  ctx.beginPath();
  ctx.arc(19 * k, 17 * k, 9 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(26 * k, 24 * k);
  ctx.lineTo(35 * k, 33 * k);
  ctx.stroke();
  return c;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

const fmtPct = (x: number) => `${Math.round(x * 100)} %`;
/** small screens: panels become bottom sheets, the toolbar a horizontal strip */
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
/** numbers stored in log entries are formatted in the current language when displayed */
const fmtParams = (p?: Record<string, string | number>) =>
  p && Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? fmtInt(v) : v]));

/** Static labels in index.html carry data-i18n / data-i18n-title attributes. */
function translateStatic(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle!);
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh!);
  document.documentElement.lang = lang;
}

export class Hud {
  private money = $('money');
  private budgetNet = $('budget-net');
  private date = $('date');
  private pop = $('pop');
  private power = $('power');
  private water = $('water');
  private status = $('status');
  private toolPill = $<HTMLButtonElement>('tool-pill');
  private legend = $('legend');
  private preview = $('preview');
  private query = $('query');
  private flyout = $('flyout');
  private rci = { r: $('rci-r'), c: $('rci-c'), i: $('rci-i') };
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private groupButtons = new Map<string, { button: HTMLButtonElement; items: FlyoutItem[] }>();
  private speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#speed button[data-speed]'));
  private statusTimer = 0;
  private openFlyout: string | null = null;

  // budget panel widgets
  private taxInput!: HTMLInputElement;
  private taxVal!: HTMLElement;
  private fundInputs = {} as Record<Dept, HTMLInputElement>;
  private fundVals = {} as Record<Dept, HTMLElement>;
  private budgetCells = new Map<string, HTMLElement>();
  private bondsInfo!: HTMLElement;
  private bondIssue!: HTMLButtonElement;
  private bondRepay!: HTMLButtonElement;
  private ordInputs = {} as Record<Ordinance, HTMLInputElement>;
  private ordCosts = {} as Record<Ordinance, HTMLElement>;
  private lastLogKey = '';

  // welcome screen state
  private welcomeDifficulty: Difficulty = 'facile';
  private welcomeSeed: number | null = null;
  private welcomeSeeds: number[] = [];

  constructor(private handlers: HudHandlers) {
    if (isMobile()) $('welcome-help').dataset.i18n = 'help.touch';
    translateStatic();
    this.buildToolbar();
    this.buildBudgetPanel();
    this.buildMapsMenu();
    this.buildWelcome();
    this.bindMinimap();
    this.buildTutorial();
    this.toolPill.addEventListener('click', () => this.handlers.onTool('query'));
    // the top bar figures open what explains them: funds -> budget, population -> journal, date -> speed
    document.querySelector('.stat.money')!.addEventListener('click', () => $('btn-budget').click());
    document.querySelector('.stat.pop')!.addEventListener('click', () => $('btn-journal').click());
    const speedBox = $('speed');
    const toggleSpeed = () => { const show = !speedBox.classList.contains('show'); this.closePanels(); speedBox.classList.toggle('show', show); };
    document.querySelector('.stat.date')!.addEventListener('click', toggleSpeed);
    $('date-mobile').addEventListener('click', toggleSpeed);
    for (const b of this.speedButtons) b.addEventListener('click', () => speedBox.classList.remove('show'));
    // data maps are one tap away from the minimap
    $('minimap-maps').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('maps-menu');
      const wasHidden = menu.hidden;
      this.closePanels();
      menu.hidden = !wasHidden;
      menu.classList.toggle('near-minimap', !isMobile());
      if (!isMobile()) {
        const r = $('minimap').getBoundingClientRect();
        menu.style.top = `${Math.max(8, r.top - menu.offsetHeight - 8)}px`;
      } else {
        menu.style.top = '';
      }
    });

    for (const b of this.speedButtons) {
      b.addEventListener('click', () => handlers.onSpeed(Number(b.dataset.speed)));
    }
    $('btn-budget').addEventListener('click', () => this.togglePanel('panel-budget'));
    $('btn-maps').addEventListener('click', () => this.togglePanel('maps-menu'));
    $('btn-journal').addEventListener('click', () => this.togglePanel('panel-journal'));
    $('btn-cities').addEventListener('click', () => this.togglePanel('panel-cities'));
    // the button shows the language you would switch to, flag included
    const other = lang === 'fr' ? 'en' : 'fr';
    $('btn-lang').querySelector('.flag')!.className = `flag ${other}`;
    $('btn-lang').querySelector('.code')!.textContent = other.toUpperCase();
    $('btn-lang').addEventListener('click', () => handlers.onLang(lang === 'fr' ? 'en' : 'fr'));
    $('query-close').addEventListener('click', () => this.showQuery(null));
    $('cities-new').addEventListener('click', () => { this.closePanels(); this.openWelcome(false); });
    for (const el of document.querySelectorAll<HTMLElement>('.panel .close')) {
      el.addEventListener('click', () => this.closePanels());
    }
    document.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (this.openFlyout && !this.flyout.contains(target) && !target.closest('#toolbar')) this.closeFlyout();
    });
  }

  // ---- toolbar -----------------------------------------------------------

  private buildToolbar(): void {
    const bar = $('toolbar');
    for (const entry of toolbarEntries()) {
      if ('group' in entry) {
        const btn = h('button', { class: 'tool group-btn' }, h('span', { class: 'ico' }, entry.icon()), h('kbd', { text: '▸' }));
        btn.addEventListener('click', () => this.toggleFlyout(entry.group, btn, entry.items));
        this.tooltip(btn, () => {
          const g = this.groupButtons.get(entry.group);
          const current = g?.button.dataset.current;
          return [entry.group, current ?? t('flyout.choose')];
        });
        this.groupButtons.set(entry.group, { button: btn, items: entry.items });
        bar.append(btn);
      } else {
        const btn = h('button', { class: 'tool' }, h('span', { class: 'ico' }, entry.icon()), h('kbd', { text: entry.key }));
        btn.addEventListener('click', () => this.handlers.onTool(entry.tool));
        this.tooltip(btn, () => [entry.label, [entry.key, entry.cost].filter(Boolean).join(' · ')]);
        this.toolButtons.set(entry.tool, btn);
        bar.append(btn);
      }
    }
    bar.append(h('hr'));
    // the saves menu (Villes) stays in the top bar: it is about files, not about playing
    const menus: [string, string, string][] = [
      ['btn-budget', '📒', 'btn.budget'], ['btn-maps', '🗺️', 'btn.maps'], ['btn-journal', '📰', 'btn.journal'],
    ];
    for (const [id, icon, key] of menus) {
      const btn = h('button', { class: 'menu-btn', id }, h('span', { class: 'emoji', text: icon }));
      this.tooltip(btn, () => [t(key), '']);
      bar.append(btn);
    }
  }

  /** One shared tooltip, shown to the right of the hovered toolbar button. */
  private tooltip(btn: HTMLElement, lines: () => [string, string]): void {
    const tip = $('tooltip');
    btn.addEventListener('mouseenter', () => {
      if (isMobile()) return;
      const [title, meta] = lines();
      tip.replaceChildren(h('b', { text: title }), ...(meta ? [h('span', { text: meta })] : []));
      const r = btn.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${r.right + 10}px`;
      tip.style.top = `${Math.max(8, Math.min(r.top + r.height / 2 - tip.offsetHeight / 2, window.innerHeight - tip.offsetHeight - 8))}px`;
    });
    btn.addEventListener('mouseleave', () => { tip.hidden = true; });
    btn.addEventListener('mousedown', () => { tip.hidden = true; });
  }

  private toggleFlyout(group: string, anchor: HTMLButtonElement, items: FlyoutItem[]): void {
    if (this.openFlyout === group) { this.closeFlyout(); return; }
    this.openFlyout = group;
    this.flyout.replaceChildren(
      h('div', { class: 'head', text: group }),
      ...items.map((item) => {
        const lock = this.handlers.lockReason(item.tool);
        const btn = h('button', { class: 'item' },
          h('span', { class: 'ico' }, item.icon()),
          h('span', { class: 'txt' },
            h('b', { text: item.name }),
            h('span', { class: 'meta', text: item.meta }),
            h('span', { class: 'desc', text: item.desc })));
        if (lock) {
          btn.disabled = true;
          btn.querySelector('.txt')!.append(h('span', { class: 'lock', text: lock }));
        }
        btn.addEventListener('click', () => { this.handlers.onTool(item.tool); this.closeFlyout(); });
        return btn;
      }),
    );
    this.flyout.hidden = false;
    if (isMobile()) { this.flyout.style.top = ''; return; }
    const top = anchor.getBoundingClientRect().top;
    this.flyout.style.top = `${Math.max(8, Math.min(top, window.innerHeight - 40 - this.flyout.offsetHeight))}px`;
  }

  private closeFlyout(): void {
    this.openFlyout = null;
    this.flyout.hidden = true;
  }

  setTool(tool: Tool): void {
    for (const [tl, b] of this.toolButtons) b.classList.toggle('active', tl === tool);
    // on touch screens, a build tool shows what it expects and a way back to the magnifier
    const build = tool !== 'none' && tool !== 'query';
    this.toolPill.hidden = !build;
    if (build) {
      const name = isStructTool(tool) ? structName(tool) : t(`tool.${tool}`);
      const tap = isStructTool(tool) || tool === 'raise' || tool === 'lower';
      this.toolPill.querySelector('.txt')!.textContent = t(tap ? 'touch.tool.tap' : 'touch.tool.drag', { name });
    }
    for (const [, g] of this.groupButtons) {
      const item = g.items.find((it) => it.tool === tool);
      g.button.classList.toggle('active', !!item);
      if (item) g.button.dataset.current = item.name;
      else delete g.button.dataset.current;
      // the group button shows the icon of the tool picked inside it
      const ico = g.button.querySelector('.ico')!;
      ico.replaceChildren(item ? item.icon() : g.items[0].icon());
      if (!item) ico.replaceChildren(this.groupIcon(g.items));
    }
  }

  private groupIcon(items: FlyoutItem[]): HTMLCanvasElement {
    const entry = toolbarEntries().find((e) => 'group' in e && e.items[0].tool === items[0].tool);
    return entry && 'group' in entry ? entry.icon() : items[0].icon();
  }

  /** the saves button carries the name of the city being played */
  setCityName(name: string): void {
    $('city-name').textContent = name;
  }

  setSpeed(speed: number): void {
    for (const b of this.speedButtons) b.classList.toggle('active', Number(b.dataset.speed) === speed);
    $('date').classList.toggle('paused', speed === 0);
    $('date-mobile').classList.toggle('paused', speed === 0);
  }

  // ---- panels --------------------------------------------------------------

  openPanel(id: 'panel-budget' | 'maps-menu' | 'panel-cities' | 'panel-journal'): void {
    this.closePanels();
    $(id).hidden = false;
  }

  private togglePanel(id: string): void {
    const el = $(id);
    const wasHidden = el.hidden;
    this.closePanels();
    el.hidden = !wasHidden;
    if (el.classList.contains('menu')) {
      // drop-down menus open next to the button that owns them (bottom sheet on phones)
      if (isMobile()) { el.style.top = ''; return; }
      el.classList.remove('near-minimap');
      const owner = $('btn-maps');
      const top = owner.getBoundingClientRect().top;
      el.style.top = `${Math.max(8, Math.min(top, window.innerHeight - 40 - el.offsetHeight))}px`;
    }
  }

  closePanels(): void {
    for (const id of ['panel-budget', 'maps-menu', 'panel-cities', 'panel-journal']) $(id).hidden = true;
    $('speed').classList.remove('show');
    this.closeFlyout();
  }

  private buildBudgetPanel(): void {
    const body = $('budget-body');
    const row = (key: string, label: string, control?: Node) => {
      const cell = h('span', { class: 'num' });
      this.budgetCells.set(key, cell);
      return h('div', { class: 'row' }, h('span', { text: label }), control ?? h('span'), cell);
    };
    const slider = (id: string, value: number, max: number, onInput: (v: number) => void): [HTMLInputElement, HTMLElement] => {
      const input = h('input', { type: 'range', min: '0', max: String(max), value: String(value), id });
      const val = h('span', { class: 'val', text: `${value} %` });
      input.addEventListener('input', () => { val.textContent = `${input.value} %`; onInput(Number(input.value)); });
      return [input, val];
    };

    [this.taxInput, this.taxVal] = slider('tax', 7, 20, (v) => this.handlers.onTax(v));
    body.append(
      h('h3', { text: t('budget.income') }),
      h('div', { class: 'row' }, h('span', { text: t('budget.taxRate') }), this.taxInput, this.taxVal),
      row('taxR', t('zone.3')), row('taxC', t('zone.4')), row('taxI', t('zone.5')),
      row('income', t('budget.totalIncome')),
      h('h3', { text: t('budget.expenses') }),
      row('roads', t('budget.roads')), row('power', t('budget.plants')), row('water', t('budget.water')),
    );
    for (const d of DEPTS) {
      const [input, val] = slider(`fund-${d}`, 100, 100, (v) => this.handlers.onFunding(d, v));
      this.fundInputs[d] = input;
      this.fundVals[d] = val;
      body.append(row(d, t(`dept.${d}`), h('span', { class: 'ctl' }, input, val)));
    }
    body.append(
      row('parks', t('budget.parks')), row('transport', t('budget.transport')), row('ordinances', t('budget.ordinances')),
      row('interest', t('budget.interest')), row('expenses', t('budget.totalExpenses')),
      h('h3', { text: t('budget.balance') }),
      row('net', t('budget.net')), row('funds', t('budget.funds')),
      h('h3', { text: t('budget.bonds') }),
    );
    this.bondsInfo = h('div', { class: 'muted' });
    this.bondIssue = h('button', { text: t('budget.issue', { amt: fmtMoney(BOND_AMOUNT) }) });
    this.bondRepay = h('button', { text: t('budget.repay', { amt: fmtMoney(BOND_AMOUNT) }) });
    this.bondIssue.addEventListener('click', () => this.handlers.onBond(true));
    this.bondRepay.addEventListener('click', () => this.handlers.onBond(false));
    body.append(this.bondsInfo, h('div', { class: 'actions' }, this.bondIssue, this.bondRepay), h('h3', { text: t('budget.ordTitle') }));
    for (const k of ORDINANCE_KEYS) {
      const input = h('input', { type: 'checkbox', id: `ord-${k}` });
      input.addEventListener('change', () => this.handlers.onOrdinance(k, input.checked));
      const cost = h('span', { class: 'num' });
      this.ordInputs[k] = input;
      this.ordCosts[k] = cost;
      body.append(h('label', { class: 'row ord', for: `ord-${k}` }, input,
        h('span', {}, t(`ord.${k}`), h('span', { class: 'desc', text: t(`ord.${k}.desc`) })), cost));
    }
    body.append(
      h('h3', { text: t('budget.indicators') }),
      row('lv', t('budget.lv')), row('crime', t('budget.crime')),
      ...DEPTS.map((d) => row(`cov-${d}`, t(`budget.cov.${d}`))),
      row('cov-water', t('budget.cov.water')),
    );
  }

  private buildMapsMenu(): void {
    const menu = $('maps-menu');
    for (const key of DATA_MAPS) {
      const btn = h('button', { class: 'item', 'data-map': key, text: t(`map.${key}`) });
      btn.addEventListener('click', () => { this.handlers.onDataMap(key); this.closePanels(); });
      menu.append(btn);
    }
  }

  setDataMap(map: DataMap): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#maps-menu button')) {
      b.classList.toggle('active', b.dataset.map === map);
    }
    $('btn-maps').classList.toggle('active', map !== 'none');
    $('minimap-maps').classList.toggle('active', map !== 'none');
    $('minimap-name').textContent = map === 'none' ? t('minimap.title') : t(`map.${map}`);
    this.legend.textContent = map === 'none' ? '' : t('legend', { name: t(`map.${map}`) });
  }

  // ---- welcome screen ----------------------------------------------------

  private buildWelcome(): void {
    // difficulty: a slider with three stops; the long description stays in the tooltip
    const keys = Object.keys(DIFFICULTIES) as Difficulty[];
    const labels = $('welcome-difficulty');
    const slider = $<HTMLInputElement>('welcome-diff');
    for (const key of keys) {
      const el = h('span', { class: 'diff-label', title: t(`diff.${key}.desc`) }, h('b', { text: t(`diff.${key}`) }));
      el.addEventListener('click', () => { slider.value = String(keys.indexOf(key)); slider.dispatchEvent(new Event('input')); });
      labels.append(el);
    }
    const sync = () => {
      const idx = Number(slider.value);
      this.welcomeDifficulty = keys[idx];
      slider.title = t(`diff.${keys[idx]}.desc`);
      for (const [i, el] of Array.from(labels.children).entries()) el.classList.toggle('selected', i === idx);
    };
    slider.addEventListener('input', sync);
    sync();
    for (const b of document.querySelectorAll<HTMLButtonElement>('#welcome-lang button')) {
      b.classList.toggle('selected', b.dataset.lang === lang);
      b.addEventListener('click', () => { if (b.dataset.lang !== lang) this.handlers.onLang(b.dataset.lang as Lang); });
    }
    $('welcome-more').addEventListener('click', () => this.fillGallery());
    $<HTMLFormElement>('welcome-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = ($<HTMLInputElement>('welcome-name').value.trim() || t('welcome.namePh')).slice(0, 40);
      $('welcome').hidden = true;
      this.handlers.onNewCity(name, this.welcomeDifficulty, this.welcomeSeed);
    });
    $('welcome-cancel').addEventListener('click', () => { $('welcome').hidden = true; });
  }

  private fillGallery(): void {
    const gallery = $('welcome-maps');
    this.welcomeSeeds = Array.from({ length: 5 }, () => randomSeed());
    this.welcomeSeed = null;
    const random = h('button', { type: 'button', class: 'card map selected' }, h('span', { class: 'qmark', text: '?' }), h('span', { text: t('welcome.random') }));
    const select = (btn: HTMLElement, seed: number | null) => {
      this.welcomeSeed = seed;
      for (const b of gallery.children) b.classList.toggle('selected', b === btn);
    };
    random.addEventListener('click', () => select(random, null));
    gallery.replaceChildren(random);
    for (const seed of this.welcomeSeeds) {
      const canvas = h('canvas', { width: '132', height: '78' });
      const btn = h('button', { type: 'button', class: 'card map' }, canvas);
      btn.addEventListener('click', () => select(btn, seed));
      gallery.append(btn);
      renderPreview(canvas, seed);
    }
  }

  openWelcome(forced: boolean): void {
    this.closePanels();
    $('welcome-cancel').hidden = forced;
    $('welcome').hidden = false;
    const name = $<HTMLInputElement>('welcome-name');
    name.value = '';
    this.fillGallery();
    name.focus();
  }

  setCityList(entries: SaveEntry[], currentKey: string | null): void {
    const list = $('cities-list');
    const M = months();
    list.replaceChildren(...entries.map((e) => {
      const load = h('button', { text: e.key === currentKey ? t('cities.current') : t('cities.load') });
      const del = h('button', { class: 'ghost', text: '✕', title: t('cities.delete') });
      if (e.key === currentKey) { load.disabled = true; del.disabled = true; }
      load.addEventListener('click', () => { this.closePanels(); this.handlers.onLoadCity(e.key); });
      del.addEventListener('click', () => this.handlers.onDeleteCity(e.key));
      return h('div', { class: 'row city' },
        h('span', {}, h('b', { text: e.name }), h('br'), h('span', { class: 'muted', text: t('cities.info', { pop: fmtInt(e.pop), date: `${M[e.month]} ${e.year}` }) })),
        load, del);
    }));
    if (entries.length === 0) list.append(h('p', { class: 'muted', text: t('cities.none') }));
  }

  // ---- journal -------------------------------------------------------------

  private updateJournal(city: City): void {
    if ($('panel-journal').hidden) return;
    this.chart($<HTMLCanvasElement>('chart-pop'), city.history.pop, '#7ed957');
    this.chart($<HTMLCanvasElement>('chart-money'), city.history.money, '#f6b73c');
    const lines = advice(city);
    $('journal-advice').replaceChildren(...(lines.length ? lines : [t('journal.fine')]).map((txt) => h('li', { text: txt })));
    const first = city.log[0];
    const sig = `${city.log.length}:${first?.key ?? first?.text ?? ''}:${lang}`;
    if (sig !== this.lastLogKey) {
      this.lastLogKey = sig;
      const M = months();
      $('journal-log').replaceChildren(...city.log.slice(0, 60).map((e) =>
        h('div', { class: `entry ${e.kind}` }, h('span', { class: 'when', text: `${M[e.month]} ${e.year}` }),
          h('span', { text: e.key ? t(e.key, fmtParams(e.params)) : e.text ?? '' }))));
    }
  }

  private chart(canvas: HTMLCanvasElement, data: number[], color: string): void {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px Nunito, system-ui, sans-serif';
    if (data.length < 2) {
      ctx.fillStyle = '#a8b0c2';
      ctx.fillText(t('journal.noData'), 8, 40);
      return;
    }
    const min = Math.min(0, ...data), max = Math.max(...data, min + 1);
    const x = (i: number) => 6 + (i / 119) * (W - 12);
    const y = (v: number) => H - 14 - ((v - min) / (max - min)) * (H - 24);
    if (min < 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, y(0));
      ctx.lineTo(W, y(0));
      ctx.stroke();
    }
    const offset = 120 - data.length;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach((v, i) => { const px = x(offset + i), py = y(v); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.stroke();
    ctx.fillStyle = '#a8b0c2';
    ctx.fillText(fmtInt(max), 6, 10);
    ctx.fillText(fmtInt(min), 6, H - 3);
    ctx.textAlign = 'right';
    ctx.fillText(fmtInt(data[data.length - 1]), W - 6, y(data[data.length - 1]) - 4);
    ctx.textAlign = 'left';
  }

  // ---- live values ---------------------------------------------------------

  // ---- tutorial -----------------------------------------------------------

  private helpIndex = 0;

  /** Six short screens, stepped through with the arrows; the gesture screens depend on the device. */
  private tutorialScreens(): { title: string; lines: string[]; pic: [string[], number] }[] {
    const touch = isMobile();
    const lines = (key: string) => t(key).split('\n');
    return [
      { title: t('tuto.1.title'), lines: lines('tuto.1.lines'), pic: [['bld:3:1:2'], 1] },
      { title: t('tuto.2.title'), lines: lines(touch ? 'tuto.2.lines.touch' : 'tuto.2.lines.mouse'), pic: [['road:10:0000'], 1] },
      { title: t('tuto.3.title'), lines: lines(touch ? 'tuto.3.lines.touch' : 'tuto.3.lines.mouse'), pic: [['zone:3'], 1] },
      { title: t('tuto.4.title'), lines: lines('tuto.4.lines'), pic: [['st:wind'], 1] },
      { title: t('tuto.5.title'), lines: lines('tuto.5.lines'), pic: [['st:cityhall'], STRUCTS.cityhall.size] },
      { title: t('tuto.6.title'), lines: lines('tuto.6.lines'), pic: [['st:arcology'], STRUCTS.arcology.size] },
    ];
  }

  private buildTutorial(): void {
    $('btn-help').addEventListener('click', () => this.openHelp());
    $('help-close').addEventListener('click', () => { $('help').hidden = true; });
    $('help-prev').addEventListener('click', () => this.showHelp(this.helpIndex - 1));
    $('help-next').addEventListener('click', () => {
      if (this.helpIndex >= this.tutorialScreens().length - 1) $('help').hidden = true;
      else this.showHelp(this.helpIndex + 1);
    });
    $('help').addEventListener('click', (e) => { if (e.target === $('help')) $('help').hidden = true; });
    window.addEventListener('keydown', (e) => {
      if ($('help').hidden) return;
      if (e.key === 'Escape') { $('help').hidden = true; e.stopPropagation(); }
      else if (e.key === 'ArrowRight') this.showHelp(this.helpIndex + 1);
      else if (e.key === 'ArrowLeft') this.showHelp(this.helpIndex - 1);
    }, true);
  }

  openHelp(): void {
    this.closePanels();
    $('help').hidden = false;
    this.showHelp(0);
  }

  private showHelp(index: number): void {
    const screens = this.tutorialScreens();
    this.helpIndex = Math.max(0, Math.min(screens.length - 1, index));
    const sc = screens[this.helpIndex];
    $('help-title').textContent = sc.title;
    $('help-pic').replaceChildren(renderIcon(sc.pic[0], sc.pic[1], 96, 1.4));
    $('help-list').replaceChildren(...sc.lines.map((l) => h('li', { text: l })));
    $('help-dots').replaceChildren(...screens.map((_, i) => h('i', { class: i === this.helpIndex ? 'on' : '' })));
    $('help-step').textContent = `${this.helpIndex + 1} / ${screens.length}`;
    $<HTMLButtonElement>('help-prev').disabled = this.helpIndex === 0;
    $('help-next').textContent = this.helpIndex === screens.length - 1 ? t('tuto.done') : t('tuto.next');
  }

  // ---- minimap ------------------------------------------------------------

  private minimap = $<HTMLCanvasElement>('minimap-canvas');
  private minimapBase: HTMLCanvasElement | null = null;
  private minimapAt = 0;
  private minimapSize = 0;

  /** top-down iso thumbnail of the whole map (2 px per tile) plus the frame of what is on screen */
  drawMinimap(city: City, renderer: Renderer, now: number): void {
    const n = city.size;
    const W = n * 2, H = n;
    if (!this.minimapBase || this.minimapSize !== n || now - this.minimapAt > 700) {
      this.minimapSize = n;
      this.minimapAt = now;
      const base = this.minimapBase ?? document.createElement('canvas');
      base.width = W; base.height = H;
      const bctx = base.getContext('2d')!;
      const img = bctx.createImageData(W, H);
      const d = img.data;
      const put = (px: number, py: number, r: number, g: number, b: number) => {
        if (px < 0 || py < 0 || px >= W || py >= H) return;
        const o = (py * W + px) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      };
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          let c: [number, number, number];
          const o = city.overlay[i] as Overlay;
          if (city.terrain[i] === Terrain.Water) c = [52, 120, 200];
          else if (o === Overlay.Road || o === Overlay.Highway) c = [170, 176, 186];
          else if (o === Overlay.Res) c = city.level[i] ? [70, 200, 90] : [50, 140, 70];
          else if (o === Overlay.Com) c = city.level[i] ? [80, 150, 240] : [50, 100, 170];
          else if (o === Overlay.Ind) c = city.level[i] ? [240, 200, 70] : [170, 140, 50];
          else if (o === Overlay.Struct) c = [235, 235, 240];
          else if (o === Overlay.Tree) c = [40, 110, 50];
          else if (city.rail[i]) c = [120, 100, 90];
          else c = [90, 165, 70];
          // iso: tile (x, y) -> column x - y, row (x + y) / 2, two pixels wide
          const px = x - y + n - 1, py = (x + y) >> 1;
          put(px, py, c[0], c[1], c[2]);
          put(px + 1, py, c[0], c[1], c[2]);
        }
      }
      bctx.putImageData(img, 0, 0);
      this.minimapBase = base;
    }
    const cv = this.minimap;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.minimapBase, 0, 0);
    // frame of the visible area: the four screen corners, back to tile space
    const corners: [number, number][] = [[0, 0], [renderer.width, 0], [renderer.width, renderer.height], [0, renderer.height]];
    ctx.beginPath();
    corners.forEach(([sx, sy], k) => {
      const w = renderer.screenToWorld(sx, sy);
      const tt = Renderer.worldToTileF(w.x, w.y);
      const px = tt.x - tt.y + n, py = (tt.x + tt.y) / 2;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private bindMinimap(): void {
    const box = this.minimap;
    box.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r = this.minimap.getBoundingClientRect();
      const n = this.minimapSize || 1;
      const px = ((e.clientX - r.left) / r.width) * n * 2, py = ((e.clientY - r.top) / r.height) * n;
      // inverse of the iso projection above
      const x = (px - n + 2 * py) / 2, y = (2 * py - (px - n)) / 2;
      this.handlers.onMinimap(Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y)));
    });
  }

  update(city: City): void {
    const b = city.lastBudget;
    const income = budgetIncome(b), expenses = budgetExpenses(b);
    this.money.textContent = fmtMoney(city.money);
    this.money.classList.toggle('negative', city.money < 0);
    const net = income - expenses;
    this.budgetNet.textContent = `${net >= 0 ? '+' : ''}${fmtMoney(net)} ${t('top.perMonth')}`;
    this.date.textContent = `${months()[city.month]} ${city.year}`;
    $('date-mobile').textContent = this.date.textContent;
    this.pop.textContent = fmtInt(city.stats.pop);
    const short = city.power.demand > city.power.supply;
    this.power.textContent = `${fmtInt(city.power.demand)} / ${fmtInt(city.power.supply)} MW`;
    this.power.classList.toggle('negative', short);
    this.water.textContent = fmtPct(city.stats.waterShare);
    this.setBar(this.rci.r, city.demand.r);
    this.setBar(this.rci.c, city.demand.c);
    this.setBar(this.rci.i, city.demand.i);

    if (this.taxInput.value !== String(city.taxRate)) {
      this.taxInput.value = String(city.taxRate);
      this.taxVal.textContent = `${city.taxRate} %`;
    }
    for (const d of DEPTS) {
      if (this.fundInputs[d].value !== String(city.funding[d])) {
        this.fundInputs[d].value = String(city.funding[d]);
        this.fundVals[d].textContent = `${city.funding[d]} %`;
      }
    }
    const set = (k: string, v: string) => { this.budgetCells.get(k)!.textContent = v; };
    set('taxR', fmtMoney(b.taxR)); set('taxC', fmtMoney(b.taxC)); set('taxI', fmtMoney(b.taxI));
    set('income', fmtMoney(income));
    set('roads', fmtMoney(b.roads)); set('power', fmtMoney(b.power)); set('water', fmtMoney(b.water));
    for (const d of DEPTS) set(d, fmtMoney(b[d]));
    set('parks', fmtMoney(b.parks)); set('transport', fmtMoney(b.transport)); set('ordinances', fmtMoney(b.ordinances));
    set('interest', fmtMoney(b.interest)); set('expenses', fmtMoney(expenses));
    set('net', `${net >= 0 ? '+' : ''}${fmtMoney(net)}`); set('funds', fmtMoney(city.money));
    this.bondsInfo.textContent = t('budget.bondsInfo', { n: city.bonds });
    this.bondIssue.disabled = city.bonds >= MAX_BONDS;
    this.bondRepay.disabled = city.bonds === 0 || city.money < BOND_AMOUNT;
    for (const k of ORDINANCE_KEYS) {
      this.ordInputs[k].checked = city.ordinances[k];
      const c = ORDINANCES[k].costPerCapita * city.stats.pop;
      this.ordCosts[k].textContent = t('perMonthSign', { sign: c < 0 ? '+' : '−', amt: fmtMoney(Math.abs(c)) });
    }
    this.updateJournal(city);
    const s = city.stats;
    set('lv', `${Math.round(s.avgLandValue)} / 255`);
    set('crime', `${Math.round(s.avgCrime)} / 255`);
    for (const d of DEPTS) set(`cov-${d}`, fmtPct(s.coverage[d]));
    set('cov-water', fmtPct(s.waterShare));
  }

  private setBar(el: HTMLElement, d: number): void {
    const pct = Math.round(Math.sqrt(Math.abs(d)) * 50);
    if (d >= 0) {
      el.style.top = `${50 - pct}%`;
      el.style.height = `${pct}%`;
    } else {
      el.style.top = '50%';
      el.style.height = `${pct}%`;
    }
  }

  setStatus(text: string, transient = false): void {
    this.status.textContent = text;
    window.clearTimeout(this.statusTimer);
    if (transient) {
      this.statusTimer = window.setTimeout(() => {
        if (this.status.textContent === text) this.status.textContent = '';
      }, 4000);
    }
  }

  setPreview(text: string | null): void {
    this.preview.textContent = text ?? '';
    this.preview.hidden = !text;
  }

  showQuery(info: QueryInfo | null): void {
    this.query.hidden = !info;
    if (!info) return;
    $('query-title').textContent = info.title;
    $('query-body').replaceChildren(...info.lines.map((l) => h('div', { text: l })));
  }
}
