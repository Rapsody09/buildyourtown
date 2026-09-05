import type { City, Corners } from '../game/city';
import { hash2 } from '../game/rng';
import { STRUCTS } from '../game/structs';
import { HIGHWAY_CAPACITY, MAX_ELEV, NO_ROAD, Overlay, ROAD_CAPACITY, Terrain, isZone, type DataMap } from '../game/types';
import type { Pt } from '../game/tools';
import { CAR_COLORS, HSTEP, MAX_H, SpriteCache, TILE_H, TILE_W, groundHeight, type VehicleKind } from './sprites';
import type { Struct } from '../game/structs';

export interface Camera {
  /** world px at the centre of the screen */
  x: number;
  y: number;
  zoom: number;
}

export interface Preview {
  tiles: number[];
  color: string;
}

export const ZOOM_LEVELS = [0.25, 0.5, 1, 1.5, 2];

/** something that roams a network of tiles: a train on the rails, a boat on the water */
interface Walker {
  kind: 'train' | 'cargo' | 'sail';
  /** tile being reached, tile just left, progress between the two */
  x: number;
  y: number;
  px: number;
  py: number;
  t: number;
  speed: number;
  seed: number;
  /** recent head positions in tile units, most recent first: the cars trail along it */
  hist: Pt[];
}

interface VehicleAt {
  u: number;
  v: number;
  kind: VehicleKind;
  axis: 'x' | 'y';
  back: number;
}

const TRAIN_CARS: VehicleKind[] = ['loco', 'wagon', 'freight'];
const CAR_SPACING = 0.68;

export class Renderer {
  private walkers: Walker[] = [];
  private walkersFor: City | null = null;
  private walkersAt = 0;
  private lastAmbient = 0;
  private vehiclesByTile = new Map<number, VehicleAt[]>();

  readonly ctx: CanvasRenderingContext2D;
  camera: Camera = { x: 0, y: 0, zoom: 0.5 };
  dataMap: DataMap = 'none';
  /** used by screenToTile when no city is passed explicitly */
  city: City | null = null;
  width = 0;
  height = 0;
  private dpr = 1;
  private sprites = new SpriteCache();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize(): void {
    // phones report 3x pixel ratios: capping at 2 keeps the canvas affordable
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  // ---- coordinate transforms (CSS px <-> world px <-> tiles) -------------

  screenToWorld(sx: number, sy: number): Pt {
    const { x, y, zoom } = this.camera;
    return { x: (sx - this.width / 2) / zoom + x, y: (sy - this.height / 2) / zoom + y };
  }

  worldToScreen(wx: number, wy: number): Pt {
    const { x, y, zoom } = this.camera;
    return { x: (wx - x) * zoom + this.width / 2, y: (wy - y) * zoom + this.height / 2 };
  }

  static tileToWorld(x: number, y: number): Pt {
    return { x: (x - y) * TILE_W / 2, y: (x + y) * TILE_H / 2 };
  }

  static worldToTileF(wx: number, wy: number): Pt {
    const a = wx / (TILE_W / 2);
    const b = wy / (TILE_H / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  /** Tile under a screen point, taking terrain height into account. */
  screenToTile(sx: number, sy: number, city: City | null = this.city): Pt {
    const w = this.screenToWorld(sx, sy);
    if (city) {
      for (let h = MAX_ELEV; h >= 0; h--) {
        const t = Renderer.worldToTileF(w.x, w.y + h * HSTEP);
        const tx = Math.floor(t.x), ty = Math.floor(t.y);
        if (city.inBounds(tx, ty) && city.base(tx, ty) === h) return { x: tx, y: ty };
      }
    }
    const t = Renderer.worldToTileF(w.x, w.y);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }

  centerOnTile(x: number, y: number): void {
    const w = Renderer.tileToWorld(x + 0.5, y + 0.5);
    this.camera.x = w.x;
    this.camera.y = w.y;
  }

  zoomAt(sx: number, sy: number, newZoom: number): void {
    const before = this.screenToWorld(sx, sy);
    this.camera.zoom = newZoom;
    const after = this.screenToWorld(sx, sy);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
  }

  // ---- drawing -----------------------------------------------------------

  draw(city: City, hover: Pt | null, preview: Preview | null, time = 0): void {
    const { ctx, dpr } = this;
    const scale = this.camera.zoom * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#151920';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // device-px position of world origin, rounded so tiles land on whole pixels
    const o = this.worldToScreen(0, 0);
    const jitter = city.shakeMs > 0 ? 6 * dpr : 0;
    const ox = Math.round(o.x * dpr + (Math.random() - 0.5) * jitter);
    const oy = Math.round(o.y * dpr + (Math.random() - 0.5) * jitter);
    const hw = TILE_W / 2 * scale;
    const hh = TILE_H / 2 * scale;
    const ax = Math.round(hw);
    const ay = Math.round(MAX_H * scale);
    const hs = HSTEP * scale;

    const corners = [[0, 0], [this.width, 0], [0, this.height], [this.width, this.height]];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [sx, sy] of corners) {
      const w = this.screenToWorld(sx, sy);
      const t = Renderer.worldToTileF(w.x, w.y);
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    const extra = Math.ceil((MAX_H + MAX_ELEV * HSTEP) / (TILE_H / 2)) + 4;
    const x0 = Math.max(0, Math.floor(minX) - 1), x1 = Math.min(city.size - 1, Math.ceil(maxX) + extra);
    const y0 = Math.max(0, Math.floor(minY) - 1), y1 = Math.min(city.size - 1, Math.ceil(maxY) + extra);

    const { terrain, overlay, level, roadDist, wire, rail, powered, watered, fire, flood } = city;
    const showMarkers = this.camera.zoom >= 0.5;
    const animate = this.camera.zoom >= 0.5;
    if (animate) this.updateAmbient(city, time); else this.vehiclesByTile.clear();
    const devW = this.canvas.width, devH = this.canvas.height;
    const waterFrame = Math.floor(time / 600) % 3;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * city.size + x;
        const c = city.corners(x, y);
        const base = Math.min(c[0], c[1], c[2], c[3]);
        const px = ox + (x - y) * hw;
        const py = oy + (x + y) * hh - Math.round(base * hs);
        if (px + hw < 0 || px - hw > devW || py + 2 * hh < 0 || py - ay > devH) continue;
        const ov = overlay[i] as Overlay;

        if (ov === Overlay.Struct) {
          const s = city.structAt(i);
          if (!s) continue;
          const n = STRUCTS[s.type].size;
          // wind turbines turn: six rotor frames, each machine out of step with its neighbours
          let key = `st:${s.type}`;
          if (s.type === 'wind' && animate) key = `st:wind:${(Math.floor(time / 90) + (hash2(s.x, s.y, 7) >>> 0)) % 6}`;
          else if (s.type === 'station' && this.stationAlongY(city, s.x, s.y, n)) key = 'st:station:1';
          else if (s.type === 'port') key = `st:port:${this.portSide(city, s.x, s.y, n)}`;
          else if (s.type === 'park') {
            const variant = hash2(s.x, s.y, 11) & 3;
            key = `park:${this.parkMask(city, s.x, s.y)}:${variant}:${variant === 2 && animate ? Math.floor(time / 260) % 3 : 0}`;
          } else if (s.type === 'bigpark' && animate) key = `st:bigpark:${Math.floor(time / 260) % 3}`;
          ctx.drawImage(this.sprites.getColumn(key, scale, n, x - s.x, y - s.y), px - ax, py - ay);
          if (animate && x === s.x && y === s.y) this.drawEffects(city, key, s.x, s.y, ox, oy, hw, hh, hs, scale, time, true);
          if (showMarkers && x === s.x && y === s.y && STRUCTS[s.type].consumes && !powered[i]) {
            this.marker(px, py + hh, scale, 'bolt');
          }
          if (fire[i]) ctx.drawImage(this.sprites.get(`fire:${(Math.floor(time / 120) + x + y) % 3}`, scale), px - ax, py - ay);
          continue;
        }

        const b = city.bldId[i] ? city.buildings.get(city.bldId[i]) : undefined;
        if (b) {
          const key = `big:${b.zone}:${b.size}:${level[i]}:${hash2(b.x, b.y, 9) & 3}`;
          ctx.drawImage(this.sprites.getColumn(key, scale, b.size, x - b.x, y - b.y), px - ax, py - ay);
          if (animate && x === b.x && y === b.y) {
            this.drawEffects(city, key, b.x, b.y, ox, oy, hw, hh, hs, scale, time, powered[i] === 1);
            this.drawCraneAt(city, i, px, py, ax, ay, scale, time);
          }
        } else {
          const pat = `${c[0] - base}${c[1] - base}${c[2] - base}${c[3] - base}`;
          const key = this.spriteKey(city, x, y, terrain[i], ov, level[i], pat, waterFrame);
          ctx.drawImage(this.sprites.get(key, scale), px - ax, py - ay);
          if (animate && isZone(ov) && level[i] > 0) {
            this.drawEffects(city, key, x, y, ox, oy, hw, hh, hs, scale, time, powered[i] === 1);
            this.drawCraneAt(city, i, px, py, ax, ay, scale, time);
          }
          if (rail[i]) {
            const m = (city.hasRail(x, y - 1) ? 1 : 0) | (city.hasRail(x + 1, y) ? 2 : 0)
              | (city.hasRail(x, y + 1) ? 4 : 0) | (city.hasRail(x - 1, y) ? 8 : 0);
            ctx.drawImage(this.sprites.get(`rail:${m}:${pat}`, scale), px - ax, py - ay);
          }
          if (wire[i]) {
            const m = (this.wireLink(city, x, y - 1) ? 1 : 0) | (this.wireLink(city, x + 1, y) ? 2 : 0)
              | (this.wireLink(city, x, y + 1) ? 4 : 0) | (this.wireLink(city, x - 1, y) ? 8 : 0);
            ctx.drawImage(this.sprites.get(`wire:${m}:${pat}`, scale), px - ax, py - ay);
          }
          if (animate && (ov === Overlay.Road || ov === Overlay.Highway)) this.drawCars(city, x, y, i, px, py, scale, c, time);
          const vehicles = this.vehiclesByTile.get(i);
          if (vehicles) this.drawVehicles(vehicles, px, py, hw, hh, ax, ay, scale, [c[0] - base, c[1] - base, c[2] - base, c[3] - base]);
        }
        if (fire[i]) ctx.drawImage(this.sprites.get(`fire:${(Math.floor(time / 120) + x + y) % 3}`, scale), px - ax, py - ay);
        if (flood[i]) {
          ctx.fillStyle = 'rgba(60,110,200,0.6)';
          this.diamondPath(px, py, hw, hh);
          ctx.fill();
        }

        if (showMarkers && isZone(ov)) {
          if (roadDist[i] === NO_ROAD) this.marker(px, py + hh, scale, 'road');
          else if (!powered[i]) this.marker(px, py + hh, scale, 'bolt');
          else if (!watered[i] && level[i] >= 2) this.marker(px, py + hh, scale, 'drop');
        }
      }
    }

    if (this.dataMap !== 'none') {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * city.size + x;
          const col = this.dataColor(city, i);
          if (!col) continue;
          ctx.fillStyle = col;
          this.diamondPath(ox + (x - y) * hw, oy + (x + y) * hh - Math.round(city.base(x, y) * hs), hw, hh);
          ctx.fill();
        }
      }
    }

    for (const a of city.actors) this.drawActor(city, a, ox, oy, hw, hh, hs, scale, time);
    this.drawPlane(city, ox, oy, hw, hh, hs, scale, time);

    if (preview) {
      // tinted tiles, each outlined in white so the selection reads on any ground
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, 1.2 * dpr);
      for (const i of preview.tiles) {
        const x = i % city.size, y = (i - x) / city.size;
        this.diamondPath(ox + (x - y) * hw, oy + (x + y) * hh - Math.round(city.base(x, y) * hs), hw, hh);
        ctx.fillStyle = preview.color;
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
    }

    if (hover && city.inBounds(hover.x, hover.y)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, 1.5 * dpr);
      this.diamondPath(ox + (hover.x - hover.y) * hw, oy + (hover.x + hover.y) * hh - Math.round(city.base(hover.x, hover.y) * hs), hw, hh);
      ctx.stroke();
    }
  }

  // ---- ambient life: smoke, lights, cranes, trains, boats, plane -------------

  /** Smoke plumes and blinking lights declared by the sprite `key` of the building whose origin tile is (x0, y0). */
  private drawEffects(city: City, key: string, x0: number, y0: number, ox: number, oy: number, hw: number, hh: number, hs: number, scale: number, time: number, active: boolean): void {
    const fx = this.sprites.effectsOf(key);
    if (fx.length === 0) return;
    const { ctx } = this;
    const base = city.base(x0, y0);
    const seed = hash2(x0, y0, 5) >>> 0;
    for (let k = 0; k < fx.length; k++) {
      const e = fx[k];
      const X = x0 + e.u, Y = y0 + e.v;
      const sx = ox + (X - Y) * hw;
      const sy = oy + (X + Y) * hh - base * hs - e.z * scale;
      if (e.kind === 'smoke') {
        if (!active) continue;
        for (let p = 0; p < 3; p++) {
          const ph = (time / 1500 + p / 3 + ((seed + k * 97) % 1000) / 1000) % 1;
          const r = (2 + ph * 4.5) * scale;
          ctx.fillStyle = `rgba(215,215,220,${(0.55 * (1 - ph)).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(sx + (ph * 9 + p * 1.2) * scale, sy - ph * 18 * scale, r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if ((Math.floor(time / 600) + seed + k) % 2 === 0) {
        ctx.fillStyle = e.color;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(3, 4 * scale), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.2, 1.6 * scale), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** A tower crane stays a few months over a building that just grew. */
  private drawCraneAt(city: City, i: number, px: number, py: number, ax: number, ay: number, scale: number, time: number): void {
    const at = city.builtAt[i];
    if (!at || city.level[i] < 2) return;
    if (city.year * 12 + city.month - at > 3) return;
    const frame = (Math.floor(time / 700) + (hash2(i, 3, 9) >>> 0)) % 8;
    this.ctx.drawImage(this.sprites.get(`crane:${frame}`, scale), px - ax, py - ay);
  }

  private walkable(city: City, kind: Walker['kind'], x: number, y: number): boolean {
    if (!city.inBounds(x, y)) return false;
    const i = city.idx(x, y);
    return kind === 'train' ? city.rail[i] === 1 : city.terrain[i] === Terrain.Water;
  }

  /** Steps every roaming vehicle and sorts their cars by tile for the drawing pass. */
  private updateAmbient(city: City, time: number): void {
    const dt = this.lastAmbient ? Math.min(0.12, Math.max(0, (time - this.lastAmbient) / 1000)) : 0;
    this.lastAmbient = time;
    if (this.walkersFor !== city || time - this.walkersAt > 6000) {
      this.setupWalkers(city);
      this.walkersFor = city;
      this.walkersAt = time;
    }
    this.vehiclesByTile.clear();
    for (const w of this.walkers) {
      this.stepWalker(city, w, dt);
      this.placeCars(city, w);
    }
  }

  /** As many trains as the network deserves, a cargo ship by the port, a sailing boat or two on wide water. */
  private setupWalkers(city: City): void {
    const rails: number[] = [], water: number[] = [];
    for (let i = 0; i < city.count; i++) {
      if (city.rail[i]) rails.push(i);
      else if (city.terrain[i] === Terrain.Water && city.overlay[i] === Overlay.None) water.push(i);
    }
    let stations = 0;
    let port: Struct | null = null;
    for (const st of city.structs.values()) {
      if (st.type === 'station') stations++;
      else if (st.type === 'port') port = st;
    }
    const wanted: { kind: Walker['kind']; pool: number[]; count: number; speed: number }[] = [
      { kind: 'train', pool: rails, count: rails.length >= 12 && stations > 0 ? Math.min(3, 1 + Math.floor(stations / 2)) : 0, speed: 1.6 },
      { kind: 'cargo', pool: port ? this.waterAround(city, port) : [], count: port ? 1 : 0, speed: 0.45 },
      { kind: 'sail', pool: water, count: water.length >= 80 ? 2 : water.length >= 30 ? 1 : 0, speed: 0.3 },
    ];
    const kept: Walker[] = [];
    for (const { kind, pool, count, speed } of wanted) {
      const alive = this.walkers.filter((w) => w.kind === kind && this.walkable(city, kind, w.x, w.y)).slice(0, count);
      for (let tries = 0; alive.length < count && pool.length && tries < 40; tries++) {
        const i = pool[(hash2(city.seed, alive.length * 11 + tries, 13) >>> 0) % pool.length];
        const x = i % city.size, y = (i - x) / city.size;
        const w: Walker = { kind, x, y, px: x, py: y, t: 0, speed, seed: i, hist: [{ x: x + 0.5, y: y + 0.5 }] };
        if (!this.pickNext(city, w, true)) continue;
        alive.push(w);
      }
      kept.push(...alive);
    }
    this.walkers = kept;
  }

  /** Water tiles touching the port's footprint, where its ship spawns. */
  private waterAround(city: City, port: Struct): number[] {
    const out: number[] = [];
    const n = 3;
    for (let yy = port.y - 1; yy <= port.y + n; yy++) {
      for (let xx = port.x - 1; xx <= port.x + n; xx++) {
        const inside = xx >= port.x && xx < port.x + n && yy >= port.y && yy < port.y + n;
        if (!inside && this.walkable(city, 'cargo', xx, yy)) out.push(city.idx(xx, yy));
      }
    }
    return out;
  }

  /**
   * Chooses the next tile from the one being reached: straight on when possible
   * (a turn now and then at junctions), otherwise a turn, otherwise back.
   */
  private pickNext(city: City, w: Walker, fresh: boolean): boolean {
    const dx = w.x - w.px, dy = w.y - w.py;
    const dirs: [number, number][] = fresh || (dx === 0 && dy === 0)
      ? [[1, 0], [0, 1], [-1, 0], [0, -1]]
      : [[dx, dy], [-dy, dx], [dy, -dx], [-dx, -dy]];
    const h = hash2(w.x, w.y, w.seed) >>> 0;
    if (h & 1) [dirs[1], dirs[2]] = [dirs[2], dirs[1]];
    if (!fresh && (h >> 1) % 4 === 0 && this.walkable(city, w.kind, w.x + dirs[1][0], w.y + dirs[1][1])) [dirs[0], dirs[1]] = [dirs[1], dirs[0]];
    for (const [ndx, ndy] of dirs) {
      if (this.walkable(city, w.kind, w.x + ndx, w.y + ndy)) {
        w.px = w.x; w.py = w.y;
        w.x += ndx; w.y += ndy;
        w.t = 0;
        return true;
      }
    }
    return false;
  }

  private stepWalker(city: City, w: Walker, dt: number): void {
    if (!this.walkable(city, w.kind, w.x, w.y)) return; // replaced at the next setup
    w.t += w.speed * dt;
    while (w.t >= 1) {
      const carry = w.t - 1;
      if (!this.pickNext(city, w, false)) { w.t = 0.999; break; }
      w.t = carry;
    }
    const head = { x: w.px + (w.x - w.px) * w.t + 0.5, y: w.py + (w.y - w.py) * w.t + 0.5 };
    const last = w.hist[0];
    if (!last || Math.hypot(head.x - last.x, head.y - last.y) > 0.02) {
      w.hist.unshift(head);
      if (w.hist.length > 60) w.hist.pop();
    }
  }

  /** Puts each car of the walker on the tile it is over, following the head's recent path. */
  private placeCars(city: City, w: Walker): void {
    const cars = w.kind === 'train' ? TRAIN_CARS : [w.kind];
    for (let k = 0; k < cars.length; k++) {
      let d = k * CAR_SPACING;
      let pos: Pt | null = null, dir: Pt = { x: 1, y: 0 };
      if (k === 0) {
        pos = w.hist[0];
        dir = w.hist[1] ? { x: w.hist[0].x - w.hist[1].x, y: w.hist[0].y - w.hist[1].y } : { x: w.x - w.px, y: w.y - w.py };
      } else {
        for (let j = 0; j + 1 < w.hist.length; j++) {
          const a = w.hist[j], b = w.hist[j + 1];
          const len = Math.hypot(a.x - b.x, a.y - b.y);
          if (d <= len) {
            const f = len ? d / len : 0;
            pos = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
            dir = { x: a.x - b.x, y: a.y - b.y };
            break;
          }
          d -= len;
        }
      }
      if (!pos) continue; // not enough path behind the head yet
      const tx = Math.floor(pos.x), ty = Math.floor(pos.y);
      if (!city.inBounds(tx, ty)) continue;
      const axis: 'x' | 'y' = Math.abs(dir.x) >= Math.abs(dir.y) ? 'x' : 'y';
      const back = (axis === 'x' ? dir.x : dir.y) < 0 ? 1 : 0;
      const i = city.idx(tx, ty);
      const list = this.vehiclesByTile.get(i) ?? [];
      list.push({ u: pos.x - tx, v: pos.y - ty, kind: cars[k], axis, back });
      this.vehiclesByTile.set(i, list);
    }
  }

  private drawVehicles(list: VehicleAt[], px: number, py: number, hw: number, hh: number, ax: number, ay: number, scale: number, rel: Corners): void {
    for (const vh of list) {
      const gx = px + (vh.u - vh.v) * hw;
      const gy = py + (vh.u + vh.v) * hh - groundHeight(vh.u, vh.v, rel) * scale;
      this.ctx.drawImage(this.sprites.get(`vehicle:${vh.kind}:${vh.axis}:${vh.back}`, scale), Math.round(gx - ax), Math.round(gy - hh - ay));
    }
  }

  /** With an airport, a plane takes off every so often, loops over the city and lands. */
  private drawPlane(city: City, ox: number, oy: number, hw: number, hh: number, hs: number, scale: number, time: number): void {
    let airport: Struct | null = null;
    for (const st of city.structs.values()) if (st.type === 'airport') { airport = st; break; }
    if (!airport) return;
    const CYCLE = 75000, FLIGHT = 30000;
    const tc = time % CYCLE;
    if (tc > FLIGHT) return;
    const f = tc / FLIGHT;
    const cx = airport.x + 2, cy = airport.y + 2, R = 20;
    const at = (t: number) => ({ X: cx + R * (1 - Math.cos(t * Math.PI * 2)), Y: cy + R * Math.sin(t * Math.PI * 2) });
    const { X, Y } = at(f);
    const ahead = at(Math.min(1, f + 0.01));
    const alt = 55 * Math.max(0, Math.min(1, f / 0.15, (1 - f) / 0.15));
    const tx = Math.max(0, Math.min(city.size - 1, Math.floor(X))), ty = Math.max(0, Math.min(city.size - 1, Math.floor(Y)));
    const base = city.base(tx, ty);
    const sx = ox + (X - Y) * hw, gy = oy + (X + Y) * hh - base * hs;
    const sy = gy - alt * scale;
    const angle = Math.atan2((ahead.X + ahead.Y - X - Y) * hh, (ahead.X - ahead.Y - X + Y) * hw);
    const { ctx } = this;
    if (sx < -60 || sy < -60 || sx > this.canvas.width + 60 || gy > this.canvas.height + 60) return;
    // shadow on the ground, then the plane
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(sx + 5 * scale, gy, 13 * scale, 5.5 * scale, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angle);
    ctx.scale(scale * 1.5, scale * 1.5);
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(20,24,34,0.7)';
    ctx.fillStyle = '#f4f6f8';
    // wings, tail plane, fuselage
    ctx.beginPath();
    ctx.moveTo(1, -1.5); ctx.lineTo(-3, -9); ctx.lineTo(-6, -9); ctx.lineTo(-3, -1.5);
    ctx.lineTo(-3, 1.5); ctx.lineTo(-6, 9); ctx.lineTo(-3, 9); ctx.lineTo(1, 1.5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-7, -1); ctx.lineTo(-9, -4.5); ctx.lineTo(-10.5, -4.5); ctx.lineTo(-9, -1);
    ctx.lineTo(-9, 1); ctx.lineTo(-10.5, 4.5); ctx.lineTo(-9, 4.5); ctx.lineTo(-7, 1);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 2.2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e04848';
    ctx.fillRect(-10, -1.8, 3, 3.6);
    ctx.restore();
  }

  /** Which of the four neighbours are small parks too (N=1 E=2 S=4 W=8): their paths join up. */
  private parkMask(city: City, x: number, y: number): number {
    const park = (xx: number, yy: number) => city.inBounds(xx, yy) && city.overlay[city.idx(xx, yy)] === Overlay.Struct && city.structAt(city.idx(xx, yy))?.type === 'park';
    return (park(x, y - 1) ? 1 : 0) | (park(x + 1, y) ? 2 : 0) | (park(x, y + 1) ? 4 : 0) | (park(x - 1, y) ? 8 : 0);
  }

  /** Which side of the port touches the most water: 0 = +y, 1 = +x, 2 = -y, 3 = -x (the quay faces it). */
  private portSide(city: City, x: number, y: number, n: number): number {
    const water = (xx: number, yy: number) => city.inBounds(xx, yy) && city.terrain[city.idx(xx, yy)] === Terrain.Water ? 1 : 0;
    const counts = [0, 0, 0, 0];
    for (let k = 0; k < n; k++) {
      counts[0] += water(x + k, y + n);
      counts[1] += water(x + n, y + k);
      counts[2] += water(x + k, y - 1);
      counts[3] += water(x - 1, y + k);
    }
    let best = 0;
    for (let i = 1; i < 4; i++) if (counts[i] > counts[best]) best = i;
    return best;
  }

  /** Does the track next to a station run along y (more rail tiles beside its x sides than its y sides)? */
  private stationAlongY(city: City, x: number, y: number, n: number): boolean {
    let alongX = 0, alongY = 0;
    for (let k = 0; k < n; k++) {
      if (city.hasRail(x + k, y - 1)) alongX++;
      if (city.hasRail(x + k, y + n)) alongX++;
      if (city.hasRail(x - 1, y + k)) alongY++;
      if (city.hasRail(x + n, y + k)) alongY++;
    }
    return alongY > alongX;
  }

  /** Cars sliding along straight roadway tiles, as many as the traffic model says. */
  private drawCars(city: City, x: number, y: number, i: number, px: number, py: number, scale: number, c: Corners, time: number): void {
    const alongX = city.isRoadway(x + 1, y) || city.isRoadway(x - 1, y);
    const alongY = city.isRoadway(x, y + 1) || city.isRoadway(x, y - 1);
    if (alongX === alongY) return;
    const highway = city.overlay[i] === Overlay.Highway;
    const cars = Math.min(highway ? 8 : 4, Math.floor(city.traffic[i] / (highway ? 250 : 150)));
    if (cars === 0) return;
    const { ctx } = this;
    const hw = TILE_W / 2 * scale, hh = TILE_H / 2 * scale;
    const ax = Math.round(hw), ay = Math.round(MAX_H * scale);
    // py already sits at the tile's base height: measure the ground from there
    const base = Math.min(c[0], c[1], c[2], c[3]);
    const rel: Corners = [c[0] - base, c[1] - base, c[2] - base, c[3] - base];
    // lane centres on the asphalt; lanes below the middle line drive one way, the others back
    const lanes = highway ? [0.26, 0.42, 0.58, 0.74] : [0.4, 0.6];
    for (let k = 0; k < cars; k++) {
      const seed = hash2(x, y, 200 + k);
      const lane = lanes[k % lanes.length];
      const dir = lane < 0.5 ? 1 : -1;
      const speed = 0.25 + ((seed & 0xff) / 255) * 0.2;
      const t = ((time / 1000) * speed * dir + (seed >> 8) / 65536 * 4) % 1;
      const pos = t < 0 ? t + 1 : t;
      const u = alongX ? pos : lane;
      const v = alongX ? lane : pos;
      const gx = px + (u - v) * hw;
      const gy = py + (u + v) * hh - groundHeight(u, v, rel) * scale;
      const key = `car:${alongX ? 'x' : 'y'}:${(seed >>> 16) % CAR_COLORS.length}:${dir < 0 ? 1 : 0}:${(seed >>> 4) % 3 === 0 ? 1 : 0}`;
      ctx.drawImage(this.sprites.get(key, scale), Math.round(gx - ax), Math.round(gy - hh - ay));
    }
  }

  private drawActor(city: City, a: { kind: 'tornado'; x: number; y: number }, ox: number, oy: number, hw: number, hh: number, hs: number, scale: number, time: number): void {
    const { ctx } = this;
    const tx = Math.max(0, Math.min(city.size - 1, Math.floor(a.x)));
    const ty = Math.max(0, Math.min(city.size - 1, Math.floor(a.y)));
    const base = city.base(tx, ty);
    const px = ox + (a.x - a.y) * hw;
    const py = oy + (a.x + a.y) * hh - base * hs;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(px, py, 14 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 7; k++) {
      const t = k / 6;
      const w = (6 + t * 26) * scale;
      const y = py - k * 14 * scale;
      const wob = Math.sin(time / 90 + k) * 5 * scale;
      ctx.fillStyle = `rgba(150,150,160,${0.75 - t * 0.35})`;
      ctx.beginPath();
      ctx.ellipse(px + wob, y, w, w * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private wireLink(city: City, x: number, y: number): boolean {
    return city.inBounds(x, y) && city.conducts(city.idx(x, y));
  }

  /** Problem badges on zones: a dark disc so the icon reads on any ground. */
  private marker(cx: number, cy: number, scale: number, kind: 'road' | 'bolt' | 'drop'): void {
    const { ctx } = this;
    const r = Math.max(5, 8 * scale);
    ctx.fillStyle = 'rgba(15,20,34,0.72)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.2 * scale);
    if (kind === 'road') {
      // a bit of road struck through: no road access
      const w = r * 1.3, h = r * 0.5;
      ctx.fillStyle = '#9aa0a6';
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h * 0.3);
      ctx.fill();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.setLineDash([r * 0.22, r * 0.18]);
      ctx.beginPath();
      ctx.moveTo(cx - w / 2 + r * 0.1, cy);
      ctx.lineTo(cx + w / 2 - r * 0.1, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ff4a3a';
      ctx.lineWidth = Math.max(1.5, r * 0.26);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, cy + r * 0.62);
      ctx.lineTo(cx + r * 0.62, cy - r * 0.62);
      ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }
    if (kind === 'bolt') {
      const s = r * 0.5;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.35, cy - s * 1.5);
      ctx.lineTo(cx - s * 0.55, cy + s * 0.1);
      ctx.lineTo(cx + s * 0.05, cy + s * 0.1);
      ctx.lineTo(cx - s * 0.35, cy + s * 1.5);
      ctx.lineTo(cx + s * 0.6, cy - s * 0.2);
      ctx.lineTo(cx + s * 0.05, cy - s * 0.2);
      ctx.closePath();
      ctx.fill();
      return;
    }
    const s = r * 0.55;
    ctx.fillStyle = '#4fc3ff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 1.3);
    ctx.quadraticCurveTo(cx + s * 1.1, cy + s * 0.1, cx, cy + s * 0.9);
    ctx.quadraticCurveTo(cx - s * 1.1, cy + s * 0.1, cx, cy - s * 1.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx - s * 0.3, cy + s * 0.15, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  private dataColor(city: City, i: number): string | null {
    if (city.terrain[i] === Terrain.Water) return null;
    const o = city.overlay[i] as Overlay;
    switch (this.dataMap) {
      case 'pollution': {
        const v = city.pollution[i];
        if (v < 6) return null;
        const t = Math.min(1, v / 200);
        return `rgba(255,${Math.round(140 - t * 140)},0,${0.15 + 0.55 * t})`;
      }
      case 'crime': {
        const v = city.crime[i];
        if (v < 6) return null;
        const t = Math.min(1, v / 150);
        return `rgba(200,30,70,${0.15 + 0.6 * t})`;
      }
      case 'landValue': {
        const t = city.landValue[i] / 255;
        return `rgba(${Math.round(255 * (1 - t))},${Math.round(60 + 180 * t)},50,0.45)`;
      }
      case 'traffic': {
        if (o !== Overlay.Road && o !== Overlay.Highway) return null;
        const t = Math.min(1.3, city.traffic[i] / (o === Overlay.Highway ? HIGHWAY_CAPACITY : ROAD_CAPACITY));
        if (t < 0.08) return null;
        const k = Math.min(1, t);
        return `rgba(${Math.round(255 * k)},${Math.round(210 * (1 - k))},40,${0.35 + 0.45 * Math.min(1, t)})`;
      }
      case 'power':
        if (city.wire[i]) return 'rgba(255,220,80,0.55)';
        if (isZone(o) || o === Overlay.Struct) return city.powered[i] ? 'rgba(80,220,120,0.45)' : 'rgba(230,60,60,0.6)';
        return null;
      case 'water':
        if (city.watered[i]) return 'rgba(70,140,255,0.4)';
        return isZone(o) ? 'rgba(230,60,60,0.5)' : null;
      case 'none':
        return null;
      default: {
        const v = city.cover[this.dataMap][i];
        if (v < 4) return null;
        return `rgba(60,130,255,${0.1 + 0.5 * v / 255})`;
      }
    }
  }

  private diamondPath(px: number, py: number, hw: number, hh: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + hw, py + hh);
    ctx.lineTo(px, py + 2 * hh);
    ctx.lineTo(px - hw, py + hh);
    ctx.closePath();
  }

  private spriteKey(city: City, x: number, y: number, terrain: number, overlay: Overlay, level: number, pat: string, waterFrame: number): string {
    const h = hash2(x, y, 7);
    if (terrain === Terrain.Water) {
      if (overlay === Overlay.Road) return `bridge:${this.roadMask(city, x, y)}`;
      if (overlay === Overlay.Highway) return `hwybridge:${this.roadMask(city, x, y)}`;
      return `water:${h & 1}:${waterFrame}`;
    }
    switch (overlay) {
      case Overlay.None: return `grass:${pat}:${h & 3}`;
      case Overlay.Tree: return `tree:${pat}:${h & 3}`;
      case Overlay.Road: return `road:${this.roadMask(city, x, y)}:${pat}`;
      case Overlay.Highway: return `hwy:${this.roadMask(city, x, y)}:${pat}`;
      case Overlay.Rubble: return `rubble:${pat}:${h & 3}`;
      default:
        if (level === 0) return `zone:${overlay}`;
        return `bld:${overlay}:${level}:${(h >> 4) & 3}`;
    }
  }

  private roadMask(city: City, x: number, y: number): number {
    return (city.isRoadway(x, y - 1) ? 1 : 0) | (city.isRoadway(x + 1, y) ? 2 : 0)
      | (city.isRoadway(x, y + 1) ? 4 : 0) | (city.isRoadway(x - 1, y) ? 8 : 0);
  }
}
