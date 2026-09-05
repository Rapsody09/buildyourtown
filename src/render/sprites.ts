import type { Corners } from '../game/city';
import { hash2 } from '../game/rng';
import { STRUCTS } from '../game/structs';
import { Overlay, ZONE_COLOR, type StructType, type ZoneType } from '../game/types';

export const TILE_W = 64;
export const TILE_H = 32;
/** Tallest sprite extent above ground level, at scale 1. */
export const MAX_H = 112;
/** pixels per terrain level, at scale 1 */
export const HSTEP = 8;

type Ctx = CanvasRenderingContext2D;
type Pt2 = [number, number];

/** Footprint side of the sprite being drawn; set by the cache before drawing. */
let N = 1;
/** Corner heights (levels above the tile base) of the 1x1 ground being drawn. */
let SLOPE: Corners = [0, 0, 0, 0];

/** Height of the ground surface at (u, v) in px, bilinear between the corners. */
export function groundHeight(u: number, v: number, c: Corners): number {
  return (c[0] * (1 - u) * (1 - v) + c[1] * u * (1 - v) + c[2] * u * v + c[3] * (1 - u) * v) * HSTEP;
}

/** Footprint coords (u, v in [0, N]) + height in px -> sprite-local pixel coords. */
function P(u: number, v: number, h = 0): Pt2 {
  return [(u - v) * TILE_W / 2 + N * TILE_W / 2, (u + v) * TILE_H / 2 + MAX_H - h - groundHeight(u, v, SLOPE)];
}

export function parseSlope(pat: string): Corners {
  return [+pat[0], +pat[1], +pat[2], +pat[3]] as Corners;
}

function poly(ctx: Ctx, pts: Pt2[], fill: string, stroke?: string, lineWidth = 1): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/** Accepts '#rrggbb' as well as the 'rgb(r,g,b)' strings produced by shade(). */
function hexToRgb(color: string): [number, number, number] {
  if (color.startsWith('rgb')) {
    const m = color.match(/\d+/g) ?? ['0', '0', '0'];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, k: number): string {
  const [r0, g0, b0] = hexToRgb(hex);
  // shadows lean cool: red drops faster than blue, so warm walls never turn muddy
  const kr = k < 1 ? k * 0.94 : k, kb = k < 1 ? Math.min(1.1, k * 1.1) : k;
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
  return `rgb(${clamp(r0 * kr)},${clamp(g0 * k)},${clamp(b0 * kb)})`;
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ---- ground ----------------------------------------------------------------

const GRASS = ['#6aa84f', '#68a64d', '#6cab52', '#66a34b'];
const WATER = ['#3b78b5', '#3a74b0'];

function diamond(inset = 0, tx = 0, ty = 0, n = 1): Pt2[] {
  return [
    P(tx + inset, ty + inset), P(tx + n - inset, ty + inset),
    P(tx + n - inset, ty + n - inset), P(tx + inset, ty + n - inset),
  ];
}

/** Ground diamond, split in two shaded triangles when the tile is sloped. */
function drawGroundFill(ctx: Ctx, c: string, tx = 0, ty = 0): void {
  const [h00, h10, h11, h01] = SLOPE;
  if (h00 === h10 && h10 === h11 && h11 === h01) {
    poly(ctx, diamond(0, tx, ty), c, c, 1);
    return;
  }
  const lit = (du: number, dv: number) => shade(c, Math.max(0.72, Math.min(1.22, 1 + 0.13 * du + 0.06 * dv)));
  const a = lit(h10 - h00, h11 - h10);
  const b = lit(h11 - h01, h01 - h00);
  poly(ctx, [P(tx, ty), P(tx + 1, ty), P(tx + 1, ty + 1)], a, a, 1);
  poly(ctx, [P(tx, ty), P(tx + 1, ty + 1), P(tx, ty + 1)], b, b, 1);
}

function drawGrass(ctx: Ctx, variant: number, tx = 0, ty = 0): void {
  const c = GRASS[variant % GRASS.length];
  drawGroundFill(ctx, c, tx, ty);
  ctx.fillStyle = shade(c, 0.86);
  for (let k = 0; k < 5; k++) {
    const h = hash2(variant, k, 31);
    const u = 0.15 + ((h & 0xff) / 255) * 0.7;
    const v = 0.15 + (((h >> 8) & 0xff) / 255) * 0.7;
    const [x, y] = P(tx + u, ty + v);
    ctx.fillRect(x, y, 2, 1);
  }
}

function drawWater(ctx: Ctx, variant: number, frame: number): void {
  const c = WATER[variant % WATER.length];
  poly(ctx, diamond(), c, c, 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const h = hash2(variant, k, 47);
    const u = 0.2 + ((((h & 0xff) / 255) + frame * 0.17) % 1) * 0.5;
    const v = 0.2 + (((h >> 8) & 0xff) / 255) * 0.5;
    const [x, y] = P(u, v);
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x + 4, y);
    ctx.stroke();
  }
}

function treeAt(ctx: Ctx, u: number, v: number, r: number, k: number): void {
  const [x, y] = P(u, v);
  ctx.fillStyle = '#5a3d1e';
  ctx.fillRect(x - 1, y - 4, 2, 5);
  const g = k % 2 ? '#2f7a2f' : '#33863a';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y - r - 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(g, 1.25);
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r - 2 - r * 0.3, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrees(ctx: Ctx, variant: number): void {
  drawGrass(ctx, variant);
  const n = 2 + (variant % 2);
  const trees: { u: number; v: number; r: number; k: number }[] = [];
  for (let k = 0; k < n; k++) {
    const h = hash2(variant, k, 91);
    trees.push({
      u: 0.22 + ((h & 0xff) / 255) * 0.56,
      v: 0.22 + (((h >> 8) & 0xff) / 255) * 0.56,
      r: 4.5 + (((h >> 16) & 0xff) / 255) * 2.5,
      k,
    });
  }
  trees.sort((a, b) => a.u + a.v - (b.u + b.v));
  for (const t of trees) treeAt(ctx, t.u, t.v, t.r, t.k);
}

/** mask bits: 1 = (x, y-1), 2 = (x+1, y), 4 = (x, y+1), 8 = (x-1, y) */
function drawRoadSurface(ctx: Ctx, mask: number): void {
  const m = mask === 0 ? 10 : mask;
  const arms: [number, number, number, number][] = [];
  if (m & 1) arms.push([0.3, 0, 0.7, 0.3]);
  if (m & 2) arms.push([0.7, 0.3, 1, 0.7]);
  if (m & 4) arms.push([0.3, 0.7, 0.7, 1]);
  if (m & 8) arms.push([0, 0.3, 0.3, 0.7]);

  const rectPoly = (u0: number, v0: number, u1: number, v1: number): Pt2[] =>
    [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];

  const kerb = '#9aa0a6';
  const asphalt = '#565b61';
  for (const pass of [0, 1]) {
    const grow = pass === 0 ? 0.04 : 0;
    const col = pass === 0 ? kerb : asphalt;
    poly(ctx, rectPoly(0.3 - grow, 0.3 - grow, 0.7 + grow, 0.7 + grow), col);
    for (const [u0, v0, u1, v1] of arms) {
      const gu = u0 === 0 || u1 === 1 ? 0 : grow;
      const gv = v0 === 0 || v1 === 1 ? 0 : grow;
      poly(ctx, rectPoly(u0 - gu, v0 - gv, u1 + gu, v1 + gv), col);
    }
  }

  ctx.strokeStyle = '#d8c25a';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  const c = P(0.5, 0.5);
  const ends: Pt2[] = [];
  if (m & 1) ends.push(P(0.5, 0));
  if (m & 2) ends.push(P(1, 0.5));
  if (m & 4) ends.push(P(0.5, 1));
  if (m & 8) ends.push(P(0, 0.5));
  for (const e of ends) {
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawRoad(ctx: Ctx, mask: number): void {
  drawGrass(ctx, mask % GRASS.length);
  drawRoadSurface(ctx, mask);
}

/** Wide, dark, four lanes and a centre barrier. */
function drawHighwaySurface(ctx: Ctx, mask: number): void {
  const m = mask === 0 ? 10 : mask;
  const arms: [number, number, number, number][] = [];
  if (m & 1) arms.push([0.18, 0, 0.82, 0.18]);
  if (m & 2) arms.push([0.82, 0.18, 1, 0.82]);
  if (m & 4) arms.push([0.18, 0.82, 0.82, 1]);
  if (m & 8) arms.push([0, 0.18, 0.18, 0.82]);
  const rectPoly = (u0: number, v0: number, u1: number, v1: number): Pt2[] =>
    [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  for (const pass of [0, 1]) {
    const grow = pass === 0 ? 0.04 : 0;
    const col = pass === 0 ? '#8d9299' : '#484c52';
    poly(ctx, rectPoly(0.18 - grow, 0.18 - grow, 0.82 + grow, 0.82 + grow), col);
    for (const [u0, v0, u1, v1] of arms) {
      const gu = u0 === 0 || u1 === 1 ? 0 : grow;
      const gv = v0 === 0 || v1 === 1 ? 0 : grow;
      poly(ctx, rectPoly(u0 - gu, v0 - gv, u1 + gu, v1 + gv), col);
    }
  }
  const line = (a: Pt2, b: Pt2, color: string, width: number, dash: number[]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const ends: [Pt2, Pt2, Pt2][] = [];
  if (m & 1) ends.push([P(0.5, 0), P(0.34, 0), P(0.66, 0)]);
  if (m & 2) ends.push([P(1, 0.5), P(1, 0.34), P(1, 0.66)]);
  if (m & 4) ends.push([P(0.5, 1), P(0.34, 1), P(0.66, 1)]);
  if (m & 8) ends.push([P(0, 0.5), P(0, 0.34), P(0, 0.66)]);
  for (const [mid, l1, l2] of ends) {
    line(P(0.5, 0.5), mid, '#d0d0d0', 1.5, []);
    line(P(0.34, 0.34), l1, 'rgba(255,255,255,0.7)', 1, [3, 4]);
    line(P(0.66, 0.66), l2, 'rgba(255,255,255,0.7)', 1, [3, 4]);
  }
}

function drawHighway(ctx: Ctx, mask: number): void {
  drawGrass(ctx, mask % GRASS.length);
  drawHighwaySurface(ctx, mask);
}

function drawHighwayBridge(ctx: Ctx, mask: number): void {
  const saved = SLOPE;
  SLOPE = [0, 0, 0, 0];
  drawWater(ctx, mask & 1, 0);
  const pier = new Scene(ctx, 0);
  pier.box(0.25, 0.4, 0.45, 0.6, 12, '#6b6f75', '#8a8f96');
  pier.box(0.55, 0.4, 0.75, 0.6, 12, '#6b6f75', '#8a8f96');
  pier.render();
  SLOPE = [1.5, 1.5, 1.5, 1.5];
  drawHighwaySurface(ctx, mask);
  SLOPE = saved;
}

/** Transparent overlay: sleepers and two rails toward each connected edge. */
function drawRail(ctx: Ctx, mask: number): void {
  const m = mask === 0 ? 10 : mask;
  const dirs: [number, number][] = [];
  if (m & 1) dirs.push([0, -0.5]);
  if (m & 2) dirs.push([0.5, 0]);
  if (m & 4) dirs.push([0, 0.5]);
  if (m & 8) dirs.push([-0.5, 0]);
  const seg = (a: Pt2, b: Pt2, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };
  for (const [du, dv] of dirs) {
    const pu = du === 0 ? 1 : 0, pv = du === 0 ? 0 : 1; // perpendicular
    for (let t = 0.08; t < 1; t += 0.14) {
      const u = 0.5 + du * t, v = 0.5 + dv * t;
      seg(P(u - pu * 0.16, v - pv * 0.16), P(u + pu * 0.16, v + pv * 0.16), '#6b5537', 1.5);
    }
    for (const k of [-0.07, 0.07]) {
      seg(P(0.5 + pu * k, 0.5 + pv * k), P(0.5 + du + pu * k, 0.5 + dv + pv * k), '#3a3a3a', 1.2);
    }
  }
}

/** Road deck on piers over water. */
function drawBridge(ctx: Ctx, mask: number): void {
  const saved = SLOPE;
  SLOPE = [0, 0, 0, 0];
  drawWater(ctx, mask & 1, 0);
  const pier = new Scene(ctx, 0);
  pier.box(0.4, 0.4, 0.6, 0.6, 12, '#6b6f75', '#8a8f96');
  pier.render();
  SLOPE = [1.5, 1.5, 1.5, 1.5];
  drawRoadSurface(ctx, mask);
  SLOPE = saved;
}

/** Transparent overlay: a pole with wires running to the connected edges. */
function drawWire(ctx: Ctx, mask: number): void {
  const m = mask === 0 ? 10 : mask;
  const H = 16;
  const base = P(0.5, 0.5);
  const top = P(0.5, 0.5, H);
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 1;
  const ends: Pt2[] = [];
  if (m & 1) ends.push(P(0.5, 0, H));
  if (m & 2) ends.push(P(1, 0.5, H));
  if (m & 4) ends.push(P(0.5, 1, H));
  if (m & 8) ends.push(P(0, 0.5, H));
  for (const e of ends) {
    ctx.beginPath();
    ctx.moveTo(top[0], top[1] - 1);
    ctx.lineTo(e[0], e[1] - 1);
    ctx.stroke();
  }
  ctx.strokeStyle = '#5b4632';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(base[0], base[1]);
  ctx.lineTo(top[0], top[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(top[0] - 4, top[1] + 2);
  ctx.lineTo(top[0] + 4, top[1] + 2);
  ctx.stroke();
}

/** Burnt-out or smashed lot: dark ground and a few blocks of debris. */
function drawRubble(ctx: Ctx, variant: number): void {
  drawGroundFill(ctx, '#6f7176');
  for (let k = 0; k < 7; k++) {
    const h = hash2(variant, k, 313);
    const u = 0.15 + ((h & 0xff) / 255) * 0.7;
    const v = 0.15 + (((h >> 8) & 0xff) / 255) * 0.7;
    const [x, y] = P(u, v);
    const w = 2 + ((h >> 16) & 3), hh = 2 + ((h >> 18) & 3);
    ctx.fillStyle = (h >> 20) & 1 ? '#4a4d52' : '#8b8f94';
    ctx.fillRect(x - w / 2, y - hh, w, hh);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  const [a0, a1] = P(0.3, 0.4);
  const [b0, b1] = P(0.7, 0.6);
  ctx.beginPath();
  ctx.moveTo(a0, a1);
  ctx.lineTo(b0, b1);
  ctx.stroke();
}

/** Transparent overlay: flickering flames and a puff of smoke. */
function drawFlames(ctx: Ctx, frame: number): void {
  for (let k = 0; k < 4; k++) {
    const h = hash2(frame, k, 77);
    const u = 0.25 + ((h & 0xff) / 255) * 0.5;
    const v = 0.25 + (((h >> 8) & 0xff) / 255) * 0.5;
    const hgt = 12 + (((h >> 16) & 0xff) / 255) * 12 + frame * 2;
    const [x, y] = P(u, v);
    const flame = (w: number, hh: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x - w * 0.6, y - hh * 0.5, x, y - hh);
      ctx.quadraticCurveTo(x + w * 0.6, y - hh * 0.5, x + w, y);
      ctx.closePath();
      ctx.fill();
    };
    flame(5, hgt, 'rgba(255,106,26,0.92)');
    flame(2.5, hgt * 0.6, 'rgba(255,210,63,0.95)');
  }
  ctx.fillStyle = 'rgba(70,70,70,0.45)';
  for (let k = 0; k < 3; k++) {
    const [x, y] = P(0.5 + k * 0.08, 0.4, 30 + k * 9 + frame * 3);
    ctx.beginPath();
    ctx.arc(x, y, 5 + k * 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEmptyZone(ctx: Ctx, zone: ZoneType): void {
  drawGrass(ctx, zone);
  const c = ZONE_COLOR[zone];
  poly(ctx, diamond(0.07), alpha(c, 0.22), alpha(c, 0.95), 1.5);
}

// ---- buildings ------------------------------------------------------------

interface Elem {
  key: number;
  draw: () => void;
}

class Scene {
  elems: Elem[] = [];
  /** colour multiplier applied to walls and roofs, for cheap variety */
  tint = 1;
  constructor(private ctx: Ctx, private seed: number) {}

  box(u0: number, v0: number, u1: number, v1: number, h: number, wall: string, top: string, opts: { z0?: number; windows?: boolean; floors?: boolean; roof?: boolean } = {}): void {
    const z0 = opts.z0 ?? 0;
    const ctx = this.ctx;
    const seed = this.seed;
    const tint = this.tint;
    this.elems.push({
      key: u0 + v0 + (z0 > 0 ? 10 : 0),
      draw: () => {
        const edge = 'rgba(0,0,0,0.28)';
        const zt = z0 + h;
        poly(ctx, [P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, zt), P(u0, v1, zt)], shade(wall, 0.9 * tint), edge);
        poly(ctx, [P(u1, v0, z0), P(u1, v1, z0), P(u1, v1, zt), P(u1, v0, zt)], shade(wall, 0.7 * tint), edge);
        if (opts.windows) {
          drawWindows(ctx, (t, z) => P(u0 + (u1 - u0) * t, v1, z), h, z0, Math.max(1, Math.round((u1 - u0) * 4)), seed, 0.9);
          drawWindows(ctx, (t, z) => P(u1, v0 + (v1 - v0) * t, z), h, z0, Math.max(1, Math.round((v1 - v0) * 4)), seed + 1, 0.7);
        }
        if (opts.floors) {
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.lineWidth = 1;
          for (let z = z0 + 9; z < zt - 2; z += 9) {
            const a = P(u0, v1, z), b = P(u1, v1, z), c = P(u1, v0, z);
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.lineTo(c[0], c[1]);
            ctx.stroke();
          }
        }
        poly(ctx, [P(u0, v0, zt), P(u1, v0, zt), P(u1, v1, zt), P(u0, v1, zt)], shade(top, tint), edge);
        if (opts.roof) {
          // a couple of rooftop units so flat roofs are not bare
          const n = 1 + (seed & 1);
          for (let k = 0; k < n; k++) {
            const hh = hash2(seed, k, 5);
            const uu = u0 + 0.15 + ((hh & 0xff) / 255) * (u1 - u0 - 0.4);
            const vv = v0 + 0.15 + (((hh >> 8) & 0xff) / 255) * (v1 - v0 - 0.4);
            const sz = 0.14, uh = 4;
            poly(ctx, [P(uu, vv + sz, zt), P(uu + sz, vv + sz, zt), P(uu + sz, vv + sz, zt + uh), P(uu, vv + sz, zt + uh)], '#8f949b', edge);
            poly(ctx, [P(uu + sz, vv, zt), P(uu + sz, vv + sz, zt), P(uu + sz, vv + sz, zt + uh), P(uu + sz, vv, zt + uh)], '#6e737a', edge);
            poly(ctx, [P(uu, vv, zt + uh), P(uu + sz, vv, zt + uh), P(uu + sz, vv + sz, zt + uh), P(uu, vv + sz, zt + uh)], '#b3b8be', edge);
          }
        }
      },
    });
  }

  /** Vertical cylinder; `rTop` smaller than `r` gives a cone or a flared tower. */
  cylinder(u: number, v: number, r: number, h: number, side: string, top: string, opts: { z0?: number; rTop?: number; windows?: boolean } = {}): void {
    const z0 = opts.z0 ?? 0;
    const rt = opts.rTop ?? r;
    const ctx = this.ctx;
    const seed = this.seed;
    this.elems.push({
      key: u - r + v - r + (z0 > 0 ? 10 : 0),
      draw: () => {
        const edge = 'rgba(0,0,0,0.28)';
        const [cx, cy] = P(u, v, z0);
        const [tx, ty] = P(u, v, z0 + h);
        const rx = r * TILE_W / 2, ry = r * TILE_H / 2, rx2 = rt * TILE_W / 2, ry2 = rt * TILE_H / 2;
        const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
        g.addColorStop(0, shade(side, 0.7));
        g.addColorStop(0.3, shade(side, 1.08));
        g.addColorStop(0.65, shade(side, 0.9));
        g.addColorStop(1, shade(side, 0.55));
        ctx.beginPath();
        ctx.moveTo(tx - rx2, ty);
        ctx.lineTo(cx - rx, cy);
        ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
        ctx.lineTo(tx + rx2, ty);
        ctx.ellipse(tx, ty, Math.max(0.01, rx2), Math.max(0.01, ry2), 0, 0, Math.PI, false);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (opts.windows && rt === r) {
          const cols = Math.max(2, Math.round((Math.PI * rx) / 7));
          for (let z = z0 + 5; z < z0 + h - 4; z += 9) {
            for (let k = 0; k < cols; k++) {
              const th = 0.25 + (Math.PI - 0.5) * ((k + 0.5) / cols);
              const wx = cx + rx * Math.cos(th), wy = cy + ry * Math.sin(th) - z;
              ctx.fillStyle = hash2(k, z, seed) % 3 === 0 ? '#ffe38a' : '#284260';
              ctx.fillRect(wx - 1.5, wy - 5, 3, 5);
            }
          }
        }
        if (rt > 0.02) {
          ctx.beginPath();
          ctx.ellipse(tx, ty, rx2, ry2, 0, 0, Math.PI * 2);
          ctx.fillStyle = top;
          ctx.fill();
          ctx.stroke();
        }
      },
    });
  }

  /** Half-sphere sitting on a circle at height z0. */
  dome(u: number, v: number, r: number, z0: number, color: string): void {
    const ctx = this.ctx;
    this.elems.push({
      key: u + v + (z0 > 0 ? 10 : 0),
      draw: () => {
        const [cx, cy] = P(u, v, z0);
        const rx = r * TILE_W / 2, ry = r * TILE_H / 2;
        const dh = rx * 0.7;
        const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
        g.addColorStop(0, shade(color, 0.75));
        g.addColorStop(0.35, shade(color, 1.1));
        g.addColorStop(1, shade(color, 0.6));
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI, false);
        ctx.ellipse(cx, cy, rx, dh, 0, Math.PI, Math.PI * 2, false);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.lineWidth = 1;
        ctx.stroke();
      },
    });
  }

  /** Striped shop awning along the front-left face (v = v1) at height z. */
  awning(u0: number, u1: number, v1: number, z: number, color: string): void {
    const ctx = this.ctx;
    this.elems.push({
      key: u0 + v1 + 0.01,
      draw: () => {
        const d = 0.16, drop = 4;
        poly(ctx, [P(u0, v1, z), P(u1, v1, z), P(u1, v1 + d, z - drop), P(u0, v1 + d, z - drop)], color, 'rgba(0,0,0,0.25)');
        const n = Math.max(2, Math.round((u1 - u0) * 6));
        for (let k = 0; k < n; k += 2) {
          const a = u0 + (u1 - u0) * (k / n), b = u0 + (u1 - u0) * ((k + 1) / n);
          poly(ctx, [P(a, v1, z), P(b, v1, z), P(b, v1 + d, z - drop), P(a, v1 + d, z - drop)], 'rgba(255,255,255,0.75)');
        }
      },
    });
  }

  house(u0: number, v0: number, u1: number, v1: number, h: number, rh: number, wall: string, roof: string): void {
    const ctx = this.ctx;
    const tint = this.tint;
    this.elems.push({
      key: u0 + v0,
      draw: () => {
        const edge = 'rgba(0,0,0,0.28)';
        const vm = (v0 + v1) / 2;
        poly(ctx, [P(u0, v1), P(u1, v1), P(u1, v1, h), P(u0, v1, h)], shade(wall, 0.9 * tint), edge);
        poly(ctx, [P(u1, v0), P(u1, v1), P(u1, v1, h), P(u1, vm, h + rh), P(u1, v0, h)], shade(wall, 0.7 * tint), edge);
        const [dx, dy] = P(u0 + (u1 - u0) * 0.3, v1);
        ctx.fillStyle = '#34495e';
        ctx.fillRect(dx - 1.5, dy - 6, 3, 6);
        const [wx, wy] = P(u0 + (u1 - u0) * 0.7, v1, h * 0.55);
        ctx.fillStyle = '#d9e6f2';
        ctx.fillRect(wx - 2, wy - 2, 4, 3);
        poly(ctx, [P(u0, v0, h), P(u1, v0, h), P(u1, vm, h + rh), P(u0, vm, h + rh)], shade(roof, 1.08 * tint), edge);
        poly(ctx, [P(u0, vm, h + rh), P(u1, vm, h + rh), P(u1, v1, h), P(u0, v1, h)], shade(roof, 0.84 * tint), edge);
        // chimney near the ridge
        const cu = u0 + (u1 - u0) * 0.72, cw = 0.07, cz = h + rh * 0.55, ct = h + rh + 3;
        poly(ctx, [P(cu, vm + cw, cz), P(cu + cw, vm + cw, cz), P(cu + cw, vm + cw, ct), P(cu, vm + cw, ct)], '#9a9a9a', edge);
        poly(ctx, [P(cu + cw, vm - cw, cz), P(cu + cw, vm + cw, cz), P(cu + cw, vm + cw, ct), P(cu + cw, vm - cw, ct)], '#7a7a7a', edge);
        poly(ctx, [P(cu, vm - cw, ct), P(cu + cw, vm - cw, ct), P(cu + cw, vm + cw, ct), P(cu, vm + cw, ct)], '#b5b5b5', edge);
      },
    });
  }

  chimney(u: number, v: number, h: number, z0 = 0, w = 0.12, smoke = true): void {
    this.cylinder(u + w / 2, v + w / 2, w / 2, h - z0, '#5a5f66', '#2e2e2e', { z0 });
    if (!smoke) return;
    const ctx = this.ctx;
    this.elems.push({
      key: 100,
      draw: () => {
        const [x, y] = P(u + w / 2, v + w / 2, h);
        ctx.fillStyle = 'rgba(200,200,200,0.55)';
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(x + k * 2.5, y - 4 - k * 5, 2.5 + k, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    });
  }

  /** flat ellipse on the ground (ponds, pads) */
  disc(u: number, v: number, r: number, color: string, h = 0, key = -1): void {
    const ctx = this.ctx;
    this.elems.push({
      key,
      draw: () => {
        const [x, y] = P(u, v, h);
        ctx.beginPath();
        ctx.ellipse(x, y, r * TILE_W / 2, r * TILE_H / 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      },
    });
  }

  tree(u: number, v: number, r = 5): void {
    const ctx = this.ctx;
    this.elems.push({ key: u + v, draw: () => treeAt(ctx, u, v, r, Math.round(u * 7 + v * 3)) });
  }

  /** vertical line on top of something (antennas, flag poles) */
  antenna(u: number, v: number, z: number, len: number, color = '#333'): void {
    this.custom(100, (ctx) => {
      const [x, y] = P(u, v, z);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - len);
      ctx.stroke();
    });
  }

  custom(key: number, draw: (ctx: Ctx) => void): void {
    const ctx = this.ctx;
    this.elems.push({ key, draw: () => draw(ctx) });
  }

  render(): void {
    this.elems.sort((a, b) => a.key - b.key);
    for (const e of this.elems) e.draw();
  }
}

function drawWindows(ctx: Ctx, at: (t: number, z: number) => Pt2, h: number, z0: number, cols: number, seed: number, dim: number): void {
  const rows = Math.floor((h - 4) / 9);
  if (rows < 1) return;
  for (let r = 0; r < rows; r++) {
    const za = z0 + 4 + r * 9;
    const zb = za + 5;
    for (let c = 0; c < cols; c++) {
      const ta = (c + 0.25) / cols;
      const tb = (c + 0.75) / cols;
      const lit = hash2(r, c, seed) % 3 === 0;
      const col = lit ? '#ffe38a' : '#284260';
      poly(ctx, [at(ta, za), at(tb, za), at(tb, zb), at(ta, zb)], shade(col, dim));
    }
  }
}

const LOT: Record<ZoneType, string> = {
  [Overlay.Res]: '#86bd63',
  [Overlay.Com]: '#a9adb3',
  [Overlay.Ind]: '#a3a69c',
};

/** 1x1 zone building; each of the four variants is a different layout and palette. */
function drawBuilding(ctx: Ctx, zone: ZoneType, level: number, variant: number): void {
  drawGrass(ctx, 0);
  poly(ctx, diamond(0.03), LOT[zone]);
  const s = new Scene(ctx, hash2(zone, level, variant));
  if (zone === Overlay.Res) resRecipe(s, level, variant, variant);
  else if (zone === Overlay.Com) comRecipe(s, level, variant, variant);
  else indRecipe(s, level, variant, variant);
  s.render();
}

// ---- palettes: cheerful, varied, picked per building ----------------------

type Pal = [string, string];
const R_HOUSE: Pal[] = [
  ['#fbf6ec', '#d9434e'], ['#fff5b8', '#f28c28'], ['#dcebf8', '#4f6d8f'], ['#fbd9dc', '#b03a48'],
  ['#d8f2dc', '#3e8f5a'], ['#ece2fb', '#6b4c8a'], ['#ffffff', '#e4572e'], ['#cfeeff', '#2f80b9'],
];
const R_APT: Pal[] = [
  ['#f7f3ea', '#d9434e'], ['#e3f1f7', '#3f8f8f'], ['#f26d5b', '#34495e'], ['#fff2c2', '#e4572e'],
  ['#cfe0f0', '#3d6a8a'], ['#f3dbe9', '#8e44ad'], ['#dcefd4', '#4f7a4a'], ['#fafafa', '#2f80b9'],
];
const R_TOWER: Pal[] = [['#f2f4f6', '#6f7a8a'], ['#e0e9ee', '#3d6a8a'], ['#fbeee6', '#c0392b'], ['#dfe8dc', '#3f7d5a']];
const C_SHOP: Pal[] = [
  ['#fffdf7', '#e04848'], ['#f6f6f2', '#3aa657'], ['#fffbe6', '#f2b632'], ['#f0f4ff', '#7b52ab'],
  ['#fdf0f0', '#2f8fdb'], ['#f7f7f7', '#e6752e'],
];
const C_OFFICE: Pal[] = [
  ['#5ec2d6', '#e6f6f9'], ['#4a90e2', '#dbe9fb'], ['#7ac9a2', '#e3f5ec'], ['#6d8fbf', '#dfe8f2'],
  ['#8fb3d9', '#eef4fa'], ['#3fa7b8', '#dff3f6'],
];
const C_TOWER: Pal[] = [['#2f6fb3', '#cfe6ff'], ['#3ab0a2', '#d9f5f1'], ['#4e5fb8', '#dfe3fb'], ['#2d8fd0', '#d6ecfa']];
const I_PANEL: Pal[] = [
  ['#5b8fd6', '#dfe3e8'], ['#7fae5a', '#dfe3e8'], ['#e0b04c', '#dfe3e8'], ['#d9635a', '#dfe3e8'],
  ['#8fa3ad', '#cfd6db'], ['#9d7fd1', '#dfe3e8'], ['#4fb3a9', '#dfe3e8'],
];
const TANK = ['#dcdfe3', '#b4b9c0'] as const;

function pick(arr: Pal[], k: number): Pal {
  return arr[((k % arr.length) + arr.length) % arr.length];
}

function resRecipe(s: Scene, level: number, v: number, variant: number): void {
  const a = pick(R_HOUSE, variant * 3 + level);
  const b = pick(R_HOUSE, variant * 3 + level + 4);
  const c = pick(R_HOUSE, variant * 3 + level + 2);
  const apt = pick(R_APT, variant + level);
  const apt2 = pick(R_APT, variant + level + 3);
  const tw = pick(R_TOWER, variant);
  const tw2 = pick(R_TOWER, variant + 2);
  switch (level) {
    case 1:
      if (v === 0) {
        s.house(0.15, 0.2, 0.55, 0.6, 11, 7, a[0], a[1]);
        s.house(0.62, 0.58, 0.9, 0.86, 9, 5, b[0], b[1]);
        s.tree(0.8, 0.2, 4);
      } else if (v === 1) {
        s.house(0.2, 0.48, 0.58, 0.86, 11, 7, a[0], a[1]);
        s.house(0.62, 0.12, 0.9, 0.4, 9, 5, b[0], b[1]);
        s.tree(0.2, 0.2, 4);
      } else if (v === 2) {
        s.house(0.15, 0.15, 0.65, 0.6, 12, 8, a[0], a[1]);
        s.box(0.68, 0.3, 0.9, 0.55, 7, b[0], shade(b[1], 1.1));
        s.tree(0.3, 0.8, 4);
        s.tree(0.75, 0.8, 3.5);
      } else {
        s.house(0.12, 0.3, 0.5, 0.7, 11, 7, a[0], a[1]);
        s.house(0.55, 0.1, 0.9, 0.5, 10, 6, b[0], b[1]);
        s.disc(0.72, 0.76, 0.12, '#4aa3e0', 0, -1);
        s.tree(0.2, 0.88, 3.5);
      }
      break;
    case 2:
      if (v === 0) {
        s.house(0.1, 0.1, 0.44, 0.44, 11, 6, a[0], a[1]);
        s.house(0.56, 0.1, 0.9, 0.44, 11, 6, b[0], b[1]);
        s.house(0.1, 0.56, 0.44, 0.9, 11, 6, b[0], b[1]);
        s.house(0.56, 0.56, 0.9, 0.9, 11, 6, a[0], a[1]);
      } else if (v === 1) {
        s.house(0.1, 0.1, 0.44, 0.44, 11, 6, a[0], a[1]);
        s.house(0.56, 0.1, 0.9, 0.44, 11, 6, b[0], b[1]);
        s.house(0.1, 0.56, 0.44, 0.9, 11, 6, c[0], c[1]);
        s.box(0.56, 0.56, 0.9, 0.9, 16, apt[0], apt[1], { windows: true });
      } else if (v === 2) {
        // terraced houses in a row
        s.house(0.1, 0.32, 0.35, 0.72, 12, 6, a[0], a[1]);
        s.house(0.375, 0.32, 0.625, 0.72, 12, 6, b[0], b[1]);
        s.house(0.65, 0.32, 0.9, 0.72, 12, 6, c[0], c[1]);
        s.tree(0.25, 0.12, 3.5);
        s.tree(0.7, 0.12, 3.5);
      } else {
        s.house(0.1, 0.1, 0.5, 0.5, 12, 7, a[0], a[1]);
        s.house(0.55, 0.55, 0.9, 0.9, 12, 7, b[0], b[1]);
        s.disc(0.72, 0.25, 0.13, '#4aa3e0', 0, -1);
        s.tree(0.25, 0.75, 4.5);
      }
      break;
    case 3:
      if (v === 0) s.box(0.12, 0.12, 0.88, 0.88, 26, apt[0], apt[1], { windows: true, floors: true, roof: true });
      else if (v === 1) {
        s.box(0.1, 0.1, 0.5, 0.9, 24, apt[0], apt[1], { windows: true, floors: true });
        s.box(0.56, 0.1, 0.9, 0.9, 20, apt2[0], apt2[1], { windows: true, floors: true, roof: true });
      } else if (v === 2) {
        // U-shaped block around a small court
        s.box(0.1, 0.1, 0.9, 0.4, 24, apt[0], apt[1], { windows: true, floors: true });
        s.box(0.1, 0.4, 0.36, 0.9, 24, apt[0], apt[1], { windows: true, floors: true });
        s.box(0.64, 0.4, 0.9, 0.9, 24, apt2[0], apt2[1], { windows: true, floors: true, roof: true });
        s.tree(0.5, 0.72, 4);
      } else {
        s.house(0.12, 0.15, 0.88, 0.85, 20, 10, apt[0], apt[1]);
      }
      break;
    case 4:
      if (v === 0) s.box(0.12, 0.12, 0.88, 0.88, 42, apt[0], apt[1], { windows: true, floors: true, roof: true });
      else if (v === 1) {
        s.box(0.1, 0.1, 0.9, 0.48, 38, apt[0], apt[1], { windows: true, floors: true });
        s.box(0.1, 0.52, 0.5, 0.9, 46, apt2[0], apt2[1], { windows: true, floors: true, roof: true });
      } else if (v === 2) {
        s.box(0.1, 0.1, 0.9, 0.9, 20, apt[0], apt[1], { windows: true, floors: true });
        s.box(0.25, 0.25, 0.75, 0.75, 24, apt2[0], apt2[1], { z0: 20, windows: true, floors: true, roof: true });
        s.tree(0.82, 0.82, 3);
      } else {
        s.box(0.1, 0.15, 0.45, 0.85, 40, apt[0], apt[1], { windows: true, floors: true, roof: true });
        s.box(0.55, 0.15, 0.9, 0.85, 46, apt2[0], apt2[1], { windows: true, floors: true, roof: true });
        s.box(0.45, 0.35, 0.55, 0.65, 10, shade(apt[0], 0.9), apt[1]);
      }
      break;
    default:
      if (v === 0) {
        s.box(0.18, 0.18, 0.82, 0.82, 66, tw[0], tw[1], { windows: true, floors: true });
        s.cylinder(0.5, 0.5, 0.16, 8, shade(tw[0], 0.8), tw[1], { z0: 66 });
      } else if (v === 1) {
        s.box(0.1, 0.1, 0.9, 0.9, 10, shade(tw[0], 0.85), tw[1]);
        s.box(0.24, 0.24, 0.76, 0.76, 62, tw[0], tw[1], { z0: 10, windows: true, floors: true, roof: true });
      } else if (v === 2) {
        s.cylinder(0.5, 0.5, 0.34, 62, tw[0], tw[1], { windows: true });
        s.dome(0.5, 0.5, 0.34, 62, shade(tw[0], 1.1));
      } else {
        s.box(0.1, 0.1, 0.9, 0.45, 70, tw[0], tw[1], { windows: true, floors: true });
        s.box(0.1, 0.55, 0.9, 0.9, 58, tw2[0], tw2[1], { windows: true, floors: true, roof: true });
      }
  }
}

function comRecipe(s: Scene, level: number, v: number, variant: number): void {
  const shop = pick(C_SHOP, variant * 2 + level);
  const shop2 = pick(C_SHOP, variant * 2 + level + 3);
  const off = pick(C_OFFICE, variant + level);
  const off2 = pick(C_OFFICE, variant + level + 2);
  const tw = pick(C_TOWER, variant);
  const tw2 = pick(C_TOWER, variant + 1);
  switch (level) {
    case 1:
      if (v === 0) { s.box(0.12, 0.2, 0.88, 0.8, 12, shop[0], shade(shop[0], 0.85), { windows: true }); s.awning(0.2, 0.8, 0.8, 8, shop[1]); }
      else if (v === 1) { s.box(0.2, 0.12, 0.8, 0.88, 12, shop[0], shade(shop[0], 0.85), { windows: true }); s.awning(0.28, 0.72, 0.88, 8, shop[1]); }
      else if (v === 2) {
        // round kiosk with a couple of tables
        s.cylinder(0.5, 0.5, 0.3, 10, shop[0], shop[1], { windows: true });
        s.cylinder(0.5, 0.5, 0.34, 6, shop[1], shop[1], { z0: 10, rTop: 0.04 });
        s.disc(0.15, 0.8, 0.07, '#f4f4f4', 0, -1);
        s.disc(0.85, 0.85, 0.07, '#f4f4f4', 0, -1);
      } else {
        s.box(0.15, 0.15, 0.85, 0.85, 10, shop[0], shade(shop[0], 0.85), { windows: true });
        s.box(0.3, 0.1, 0.7, 0.22, 6, '#ffffff', shop[1], { z0: 10 });
        s.awning(0.22, 0.78, 0.85, 7, shop2[1]);
      }
      break;
    case 2:
      if (v === 0) {
        s.box(0.1, 0.15, 0.9, 0.85, 18, shop[0], shade(shop[0], 0.8), { windows: true, roof: true });
        s.awning(0.2, 0.8, 0.85, 9, shop[1]);
        s.box(0.3, 0.42, 0.7, 0.58, 8, '#fdfdfd', shop[1], { z0: 18 });
      } else if (v === 1) {
        s.box(0.1, 0.1, 0.9, 0.48, 16, shop[0], shop[1], { windows: true });
        s.box(0.1, 0.54, 0.9, 0.9, 20, shop2[0], shade(shop2[0], 0.8), { windows: true });
        s.awning(0.2, 0.8, 0.9, 10, shop2[1]);
      } else if (v === 2) {
        s.box(0.1, 0.25, 0.9, 0.75, 14, shop[0], shade(shop[0], 0.85), { windows: true });
        s.awning(0.2, 0.8, 0.75, 9, shop[1]);
        s.cylinder(0.5, 0.5, 0.14, 9, shop[1], '#ffffff', { z0: 14 });
      } else {
        s.box(0.1, 0.1, 0.9, 0.9, 16, shop[0], shade(shop[0], 0.88), { windows: true });
        s.dome(0.5, 0.5, 0.26, 16, '#bfe3ff');
        s.awning(0.25, 0.75, 0.9, 10, shop[1]);
      }
      break;
    case 3:
      if (v === 0) s.box(0.12, 0.12, 0.88, 0.88, 32, off[0], off[1], { windows: true, floors: true, roof: true });
      else if (v === 1) {
        s.box(0.1, 0.1, 0.9, 0.52, 28, off[0], off[1], { windows: true, floors: true });
        s.box(0.1, 0.56, 0.9, 0.9, 34, off2[0], off2[1], { windows: true, floors: true, roof: true });
      } else if (v === 2) {
        s.cylinder(0.5, 0.5, 0.36, 30, off[0], off[1], { windows: true });
        s.cylinder(0.5, 0.5, 0.14, 5, shade(off[0], 0.85), off[1], { z0: 30 });
      } else {
        s.box(0.1, 0.1, 0.9, 0.9, 16, off2[0], off2[1], { windows: true, floors: true });
        s.box(0.22, 0.22, 0.78, 0.78, 20, off[0], off[1], { z0: 16, windows: true, floors: true });
        s.antenna(0.5, 0.5, 36, 6);
      }
      break;
    case 4:
      if (v === 0) s.box(0.12, 0.12, 0.88, 0.88, 50, off[0], off[1], { windows: true, floors: true, roof: true });
      else if (v === 1) {
        s.box(0.1, 0.1, 0.5, 0.9, 44, off[0], off[1], { windows: true, floors: true });
        s.box(0.54, 0.1, 0.9, 0.9, 52, off2[0], off2[1], { windows: true, floors: true });
      } else if (v === 2) {
        s.box(0.12, 0.12, 0.88, 0.88, 36, off[0], off[1], { windows: true, floors: true });
        s.cylinder(0.5, 0.5, 0.3, 18, off2[0], off2[1], { z0: 36, windows: true });
      } else {
        s.box(0.1, 0.1, 0.9, 0.9, 8, shade(off[0], 0.8), off[1]);
        s.box(0.1, 0.3, 0.9, 0.7, 54, off[0], off[1], { z0: 8, windows: true, floors: true, roof: true });
      }
      break;
    default:
      if (v === 0) {
        s.box(0.2, 0.2, 0.8, 0.8, 72, tw[0], tw[1], { windows: true, floors: true });
        s.cylinder(0.5, 0.5, 0.12, 6, '#c9d2dc', '#e8eef4', { z0: 72 });
        s.antenna(0.5, 0.5, 78, 7);
      } else if (v === 1) {
        s.box(0.12, 0.12, 0.88, 0.88, 36, tw[0], tw[1], { windows: true, floors: true, roof: true });
        s.cylinder(0.5, 0.5, 0.26, 40, shade(tw[0], 1.15), tw[1], { z0: 36 });
      } else if (v === 2) {
        s.cylinder(0.5, 0.5, 0.31, 74, tw[0], tw[1], { windows: true });
        s.dome(0.5, 0.5, 0.31, 74, tw[1]);
      } else {
        s.box(0.12, 0.12, 0.48, 0.88, 68, tw[0], tw[1], { windows: true, floors: true });
        s.box(0.52, 0.12, 0.88, 0.88, 76, tw2[0], tw2[1], { windows: true, floors: true, roof: true });
        s.box(0.4, 0.4, 0.6, 0.6, 6, '#dfe8f2', '#eef4fa', { z0: 40 });
      }
  }
}

function indRecipe(s: Scene, level: number, v: number, variant: number): void {
  const pa = pick(I_PANEL, variant + level);
  const pb = pick(I_PANEL, variant + level + 2);
  switch (level) {
    case 1:
      if (v === 0) s.box(0.1, 0.25, 0.9, 0.75, 10, pa[0], pa[1]);
      else if (v === 1) s.box(0.25, 0.1, 0.75, 0.9, 10, pa[0], pa[1]);
      else if (v === 2) { s.box(0.1, 0.1, 0.45, 0.9, 9, pa[0], pa[1]); s.box(0.55, 0.1, 0.9, 0.9, 9, pb[0], pb[1]); }
      else { s.box(0.1, 0.3, 0.65, 0.8, 10, pa[0], pa[1]); s.cylinder(0.8, 0.55, 0.12, 16, TANK[0], TANK[1]); }
      break;
    case 2:
      if (v === 0) { s.box(0.1, 0.15, 0.9, 0.7, 14, pa[0], pa[1], { windows: true }); s.chimney(0.72, 0.76, 28); }
      else if (v === 1) { s.box(0.1, 0.15, 0.9, 0.7, 14, pa[0], pa[1], { windows: true }); s.chimney(0.14, 0.76, 26); }
      else if (v === 2) {
        // saw-tooth roof workshop
        s.box(0.1, 0.15, 0.9, 0.85, 12, pa[0], pa[1], { windows: true });
        for (let k = 0; k < 3; k++) s.box(0.15 + k * 0.25, 0.2, 0.33 + k * 0.25, 0.8, 4, shade(pa[1], 0.8), '#dfe3e8', { z0: 12 });
      } else {
        s.box(0.1, 0.1, 0.6, 0.9, 14, pa[0], pa[1], { windows: true });
        s.cylinder(0.78, 0.3, 0.12, 12, TANK[0], TANK[1]);
        s.cylinder(0.78, 0.7, 0.12, 12, TANK[0], TANK[1]);
      }
      break;
    case 3:
      if (v === 0) { s.box(0.1, 0.1, 0.9, 0.72, 18, pa[0], pa[1], { windows: true }); s.chimney(0.7, 0.8, 34); s.cylinder(0.28, 0.86, 0.12, 12, TANK[0], TANK[1]); }
      else if (v === 1) { s.box(0.1, 0.1, 0.9, 0.72, 18, pa[0], pa[1], { windows: true }); s.chimney(0.15, 0.8, 34); s.cylinder(0.68, 0.86, 0.12, 12, TANK[0], TANK[1]); }
      else if (v === 2) {
        s.box(0.1, 0.1, 0.9, 0.5, 16, pa[0], pa[1], { windows: true });
        s.box(0.1, 0.55, 0.9, 0.9, 12, pb[0], pb[1], { windows: true });
        s.box(0.25, 0.9, 0.75, 0.96, 3, '#7a7f86', '#9aa0a6');
      } else {
        s.box(0.1, 0.2, 0.68, 0.8, 18, pa[0], pa[1], { windows: true });
        s.cylinder(0.83, 0.5, 0.14, 24, TANK[0], TANK[1]);
        s.custom(60, (c) => {
          const [x0, y0] = P(0.68, 0.5, 14);
          const [x1, y1] = P(0.83, 0.5, 14);
          c.strokeStyle = '#7a7f86';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(x0, y0);
          c.lineTo(x1, y1);
          c.stroke();
        });
      }
      break;
    case 4:
      if (v === 0) { s.box(0.1, 0.1, 0.9, 0.9, 22, pa[0], pa[1], { windows: true, roof: true }); s.cylinder(0.27, 0.27, 0.12, 12, TANK[0], TANK[1], { z0: 22 }); s.chimney(0.7, 0.7, 46, 22); }
      else if (v === 1) { s.box(0.1, 0.1, 0.9, 0.9, 22, pa[0], pa[1], { windows: true, roof: true }); s.cylinder(0.27, 0.27, 0.12, 12, TANK[0], TANK[1], { z0: 22 }); s.chimney(0.7, 0.7, 46, 22); s.chimney(0.5, 0.72, 40, 22); }
      else if (v === 2) {
        s.box(0.1, 0.1, 0.9, 0.9, 20, pa[0], pa[1], { windows: true });
        for (const u of [0.25, 0.5, 0.75]) s.cylinder(u, 0.3, 0.1, 14, TANK[0], TANK[1], { z0: 20 });
        s.chimney(0.8, 0.78, 44, 20, 0.1);
      } else {
        s.box(0.1, 0.1, 0.55, 0.9, 26, pa[0], pa[1], { windows: true, floors: true });
        s.cylinder(0.76, 0.3, 0.14, 16, TANK[0], TANK[1]);
        s.cylinder(0.76, 0.7, 0.14, 16, TANK[0], TANK[1]);
        s.chimney(0.6, 0.12, 40, 0, 0.1);
      }
      break;
    default:
      if (v === 0) {
        s.box(0.08, 0.08, 0.92, 0.92, 30, pb[0], pb[1], { windows: true });
        s.cylinder(0.27, 0.27, 0.13, 14, TANK[0], TANK[1], { z0: 30 });
        s.cylinder(0.27, 0.63, 0.13, 14, TANK[0], TANK[1], { z0: 30 });
        s.chimney(0.72, 0.72, 68, 30);
      } else if (v === 1) {
        s.box(0.08, 0.08, 0.92, 0.92, 30, pb[0], pb[1], { windows: true });
        s.cylinder(0.27, 0.27, 0.13, 14, TANK[0], TANK[1], { z0: 30 });
        s.chimney(0.72, 0.72, 68, 30);
        s.chimney(0.52, 0.74, 60, 30);
      } else if (v === 2) {
        s.box(0.08, 0.08, 0.92, 0.5, 24, pb[0], pb[1], { windows: true });
        for (const u of [0.25, 0.5, 0.75]) s.cylinder(u, 0.74, 0.14, 20, TANK[0], TANK[1]);
        s.chimney(0.86, 0.14, 72, 0, 0.1);
      } else {
        s.box(0.08, 0.08, 0.92, 0.92, 34, pb[0], pb[1], { windows: true, floors: true });
        s.dome(0.5, 0.5, 0.3, 34, '#c9cdd2');
        s.chimney(0.8, 0.2, 62, 34, 0.1);
        s.chimney(0.2, 0.8, 56, 34, 0.1);
      }
  }
}

// ---- merged zone buildings (2x2 and 3x3) ----------------------------------

function drawBigBuilding(ctx: Ctx, zone: ZoneType, size: number, level: number, variant: number): void {
  for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) drawGrass(ctx, (tx * 3 + ty) & 3, tx, ty);
  poly(ctx, diamond(0.03, 0, 0, size), LOT[zone]);
  const s = new Scene(ctx, hash2(zone * 7 + size, level, variant));
  const v = variant;
  const n = size;
  const W = { windows: true, floors: true } as const;
  const WR = { windows: true, floors: true, roof: true } as const;
  if (zone === Overlay.Res) {
    const apt = pick(R_APT, variant), apt2 = pick(R_APT, variant + 2), tw = pick(R_TOWER, variant), tw2 = pick(R_TOWER, variant + 1);
    if (n === 2 && level === 4) {
      if (v === 0) {
        s.box(0.15, 0.15, 1.85, 0.85, 40, apt[0], apt[1], WR);
        s.box(0.15, 1.15, 1.85, 1.85, 40, apt2[0], apt2[1], WR);
      } else if (v === 1) {
        s.box(0.15, 0.15, 1.85, 0.8, 44, apt[0], apt[1], WR);
        s.box(0.15, 0.8, 0.8, 1.85, 36, apt2[0], apt2[1], W);
        s.tree(1.4, 1.4, 5);
      } else if (v === 2) {
        // ring around a garden court
        s.box(0.15, 0.15, 1.85, 0.55, 36, apt[0], apt[1], W);
        s.box(0.15, 0.55, 0.55, 1.45, 36, apt[0], apt[1], W);
        s.box(1.45, 0.55, 1.85, 1.45, 36, apt2[0], apt2[1], W);
        s.box(0.15, 1.45, 1.85, 1.85, 36, apt2[0], apt2[1], WR);
        s.tree(1.0, 1.0, 5);
      } else {
        s.cylinder(0.6, 0.6, 0.42, 44, apt[0], apt[1], { windows: true });
        s.cylinder(1.4, 1.4, 0.42, 40, apt2[0], apt2[1], { windows: true });
        s.box(0.8, 0.8, 1.2, 1.2, 12, shade(apt[0], 0.9), apt[1]);
      }
    } else if (n === 2) {
      if (v === 0) {
        s.box(0.1, 0.1, 1.9, 1.9, 12, shade(tw[0], 0.85), tw[1]);
        s.box(0.4, 0.4, 1.6, 1.6, 86, tw[0], tw[1], { z0: 12, ...W });
        s.cylinder(1.0, 1.0, 0.3, 8, shade(tw[0], 0.75), tw[1], { z0: 98 });
      } else if (v === 1) {
        s.box(0.15, 0.15, 0.95, 0.95, 82, tw[0], tw[1], WR);
        s.box(1.05, 1.05, 1.85, 1.85, 96, tw2[0], tw2[1], WR);
        s.box(0.15, 1.05, 0.95, 1.85, 16, shade(tw[0], 0.85), tw[1]);
      } else if (v === 2) {
        s.cylinder(1.0, 1.0, 0.72, 88, tw[0], tw[1], { windows: true });
        s.dome(1.0, 1.0, 0.72, 88, shade(tw[0], 1.1));
      } else {
        s.box(0.15, 0.15, 0.75, 1.85, 70, tw[0], tw[1], WR);
        s.box(0.85, 0.15, 1.45, 1.85, 86, tw2[0], tw2[1], WR);
        s.box(1.55, 0.15, 1.85, 1.85, 60, tw[0], tw[1], W);
      }
    } else {
      if (v === 0) {
        s.box(0.1, 0.1, 2.9, 2.9, 14, shade(tw[0], 0.85), tw[1], { windows: true });
        s.box(0.7, 0.7, 2.3, 2.3, 92, tw[0], tw[1], { z0: 14, ...WR });
        s.antenna(1.5, 1.5, 106, 6);
      } else if (v === 1) {
        s.box(0.15, 0.15, 1.35, 1.35, 70, tw[0], tw[1], WR);
        s.box(1.65, 0.15, 2.85, 1.35, 88, tw2[0], tw2[1], WR);
        s.box(0.9, 1.65, 2.1, 2.85, 104, tw[0], tw[1], W);
        s.tree(0.5, 2.4, 5);
        s.tree(2.5, 2.4, 5);
      } else if (v === 2) {
        s.box(0.15, 0.15, 1.35, 1.35, 80, tw[0], tw[1], WR);
        s.box(1.65, 0.15, 2.85, 1.35, 96, tw2[0], tw2[1], WR);
        s.box(0.15, 1.65, 1.35, 2.85, 88, tw2[0], tw2[1], WR);
        s.box(1.65, 1.65, 2.85, 2.85, 72, tw[0], tw[1], WR);
        s.tree(1.5, 1.5, 5);
      } else {
        s.box(0.15, 0.15, 2.85, 2.85, 10, shade(tw[0], 0.85), tw[1]);
        s.cylinder(1.5, 1.5, 1.0, 92, tw[0], tw[1], { z0: 10, windows: true });
        s.dome(1.5, 1.5, 1.0, 102, shade(tw[0], 1.1));
      }
    }
  } else if (zone === Overlay.Com) {
    const shop = pick(C_SHOP, variant), off = pick(C_OFFICE, variant), off2 = pick(C_OFFICE, variant + 3), tw = pick(C_TOWER, variant), tw2 = pick(C_TOWER, variant + 1);
    if (n === 2 && level === 4) {
      if (v === 0) {
        s.box(0.1, 0.1, 1.9, 1.9, 26, shop[0], shade(shop[0], 0.82), { windows: true, roof: true });
        s.awning(0.3, 1.7, 1.9, 12, shop[1]);
        s.box(0.6, 0.85, 1.4, 1.15, 10, '#fdfdfd', shop[1], { z0: 26 });
      } else if (v === 1) {
        s.box(0.15, 0.15, 1.85, 1.85, 48, off[0], off[1], WR);
      } else if (v === 2) {
        s.box(0.1, 0.1, 1.9, 1.9, 24, shop[0], shade(shop[0], 0.88), { windows: true });
        s.dome(1.0, 1.0, 0.5, 24, '#bfe3ff');
        s.awning(0.3, 1.7, 1.9, 12, shop[1]);
      } else {
        s.box(0.1, 0.1, 0.9, 1.9, 44, off[0], off[1], W);
        s.box(1.1, 0.1, 1.9, 1.9, 36, off2[0], off2[1], WR);
      }
    } else if (n === 2) {
      if (v === 0) {
        s.box(0.3, 0.3, 1.7, 1.7, 100, tw[0], tw[1], W);
        s.antenna(1.0, 1.0, 100, 10);
      } else if (v === 1) {
        s.box(0.1, 0.1, 1.9, 1.9, 30, tw2[0], tw2[1], W);
        s.box(0.4, 0.4, 1.6, 1.6, 50, tw[0], tw[1], { z0: 30, ...W });
        s.cylinder(1.0, 1.0, 0.4, 24, shade(tw[0], 1.15), tw[1], { z0: 80 });
      } else if (v === 2) {
        s.cylinder(1.0, 1.0, 0.66, 98, tw[0], tw[1], { windows: true });
        s.antenna(1.0, 1.0, 98, 10);
      } else {
        s.box(0.1, 0.1, 1.9, 1.9, 26, tw2[0], tw2[1], W);
        s.box(0.3, 0.3, 1.7, 1.7, 26, tw[0], tw[1], { z0: 26, ...W });
        s.box(0.5, 0.5, 1.5, 1.5, 26, tw2[0], tw2[1], { z0: 52, ...W });
        s.box(0.7, 0.7, 1.3, 1.3, 24, tw[0], tw[1], { z0: 78, ...W });
      }
    } else {
      if (v === 0) {
        s.box(0.15, 0.15, 2.85, 2.85, 20, off[0], off[1], { windows: true });
        s.box(0.6, 0.6, 2.4, 2.4, 86, tw[0], tw[1], { z0: 20, ...WR });
        s.antenna(1.5, 1.5, 106, 6);
      } else if (v === 1) {
        s.box(0.15, 0.15, 1.45, 1.45, 100, tw[0], tw[1], WR);
        s.box(1.55, 1.55, 2.85, 2.85, 80, tw2[0], tw2[1], WR);
        s.box(0.15, 1.55, 1.45, 2.85, 24, off[0], off[1], { windows: true });
        s.box(1.55, 0.15, 2.85, 1.45, 24, off[0], off[1], { windows: true });
      } else if (v === 2) {
        s.box(0.15, 0.15, 2.85, 2.85, 16, off[0], off[1], { windows: true });
        s.cylinder(1.5, 1.5, 0.95, 90, tw[0], tw[1], { z0: 16, windows: true });
        s.antenna(1.5, 1.5, 106, 6);
      } else {
        s.box(0.2, 0.2, 1.3, 1.3, 96, tw[0], tw[1], WR);
        s.box(1.7, 0.2, 2.8, 1.3, 76, tw2[0], tw2[1], WR);
        s.box(0.95, 1.7, 2.05, 2.8, 88, tw[0], tw[1], WR);
        s.box(1.3, 0.55, 1.7, 0.95, 6, '#dfe8f2', '#eef4fa', { z0: 50 });
      }
    }
  } else {
    const pa = pick(I_PANEL, variant), pb = pick(I_PANEL, variant + 3);
    if (n === 2 && level === 4) {
      if (v === 0) {
        s.box(0.1, 0.1, 1.9, 1.4, 22, pa[0], pa[1], { windows: true });
        s.cylinder(0.35, 1.7, 0.2, 14, TANK[0], TANK[1]);
        s.chimney(1.5, 1.55, 48, 0, 0.18);
      } else if (v === 1) {
        s.box(0.1, 0.1, 1.9, 1.4, 22, pa[0], pa[1], { windows: true });
        s.cylinder(0.35, 1.7, 0.2, 14, TANK[0], TANK[1]);
        s.chimney(1.5, 1.55, 48, 0, 0.18);
        s.chimney(1.1, 1.55, 40, 0, 0.18);
      } else if (v === 2) {
        // tank farm
        for (const [u, vv] of [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5]]) s.cylinder(u, vv, 0.36, 16, TANK[0], TANK[1]);
        s.box(1.15, 1.15, 1.85, 1.85, 12, pa[0], pa[1], { windows: true });
      } else {
        s.box(0.1, 0.1, 1.9, 1.9, 18, pa[0], pa[1], { windows: true });
        for (let k = 0; k < 4; k++) s.box(0.2 + k * 0.42, 0.2, 0.5 + k * 0.42, 1.8, 4, shade(pa[1], 0.8), '#dfe3e8', { z0: 18 });
        s.chimney(1.72, 1.72, 40, 0, 0.14);
      }
    } else if (n === 2) {
      if (v === 0) {
        s.box(0.1, 0.1, 1.9, 1.9, 30, pb[0], pb[1], { windows: true });
        s.cylinder(0.4, 0.4, 0.2, 16, TANK[0], TANK[1], { z0: 30 });
        s.cylinder(0.4, 1.0, 0.2, 16, TANK[0], TANK[1], { z0: 30 });
        s.chimney(1.4, 1.4, 76, 30, 0.2);
      } else if (v === 1) {
        s.box(0.1, 0.1, 1.9, 1.9, 30, pb[0], pb[1], { windows: true });
        s.cylinder(0.4, 0.4, 0.2, 16, TANK[0], TANK[1], { z0: 30 });
        s.chimney(1.4, 1.4, 76, 30, 0.2);
        s.chimney(1.0, 1.5, 66, 30, 0.16);
      } else if (v === 2) {
        s.cylinder(0.6, 0.6, 0.48, 40, TANK[0], TANK[1]);
        s.cylinder(1.4, 0.6, 0.48, 40, TANK[0], TANK[1]);
        s.box(0.1, 1.2, 1.9, 1.9, 20, pb[0], pb[1], { windows: true });
        s.chimney(1.7, 1.25, 60, 20, 0.14);
      } else {
        s.box(0.1, 0.1, 1.9, 1.0, 28, pb[0], pb[1], { windows: true });
        s.dome(0.6, 1.5, 0.38, 0, TANK[0]);
        s.dome(1.4, 1.5, 0.38, 0, TANK[0]);
        s.chimney(1.7, 0.15, 64, 28, 0.14);
      }
    } else {
      if (v === 0) {
        s.box(0.1, 0.1, 2.9, 1.6, 34, pb[0], pb[1], { windows: true });
        for (const [u, vv] of [[0.3, 1.9], [0.9, 1.9], [1.5, 1.9], [2.1, 1.9]]) s.cylinder(u + 0.25, vv + 0.25, 0.25, 18, TANK[0], TANK[1]);
        s.chimney(2.4, 2.4, 84, 0, 0.24);
        s.chimney(1.9, 2.55, 70, 0, 0.18);
      } else if (v === 1) {
        s.box(0.1, 0.1, 2.9, 1.6, 34, pb[0], pb[1], { windows: true });
        for (const [u, vv] of [[0.3, 1.9], [0.9, 1.9], [1.5, 1.9], [2.1, 1.9]]) s.cylinder(u + 0.25, vv + 0.25, 0.25, 18, TANK[0], TANK[1]);
        s.chimney(2.4, 2.4, 84, 0, 0.24);
        s.chimney(1.9, 2.55, 70, 0, 0.18);
        s.chimney(2.6, 1.9, 96, 0, 0.16);
      } else if (v === 2) {
        // refinery: two rows of tanks and a pipe rack
        for (const [u, vv] of [[0.55, 0.55], [1.5, 0.55], [2.45, 0.55], [0.55, 1.5], [1.5, 1.5], [2.45, 1.5]]) s.cylinder(u, vv, 0.4, 22, TANK[0], TANK[1]);
        s.box(0.15, 2.2, 2.85, 2.85, 16, pb[0], pb[1], { windows: true });
        s.chimney(2.65, 2.25, 80, 16, 0.14);
        s.custom(60, (c) => {
          c.strokeStyle = '#7a7f86';
          c.lineWidth = 2;
          const [x0, y0] = P(0.55, 1.0, 26);
          const [x1, y1] = P(2.45, 1.0, 26);
          c.beginPath();
          c.moveTo(x0, y0);
          c.lineTo(x1, y1);
          c.stroke();
        });
      } else {
        s.box(0.1, 0.1, 2.9, 2.9, 40, pb[0], pb[1], W);
        s.dome(0.9, 0.9, 0.45, 40, TANK[0]);
        s.dome(2.1, 0.9, 0.45, 40, TANK[0]);
        s.chimney(2.4, 2.4, 90, 40, 0.18);
        s.chimney(0.6, 2.4, 78, 40, 0.14);
      }
    }
  }
  s.render();
}

// ---- structures -----------------------------------------------------------

const STRUCT_LOT: Record<string, string> = {
  power: '#8a8d8a', water: '#8fa39a', service: '#9b9ea3', park: '#8ccf6a', transport: '#8f9296', reward: '#b5b0a8',
};

function drawStruct(ctx: Ctx, type: StructType): void {
  const def = STRUCTS[type];
  const n = def.size;
  for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) drawGrass(ctx, (tx * 3 + ty) & 3, tx, ty);
  poly(ctx, diamond(0.04, 0, 0, n), STRUCT_LOT[def.category]);
  const s = new Scene(ctx, hash2(n, type.length, 5));
  switch (type) {
    case 'wind':
      s.box(0.46, 0.46, 0.54, 0.54, 40, '#d9dde2', '#bfc4ca');
      s.custom(50, (c) => {
        const [x, y] = P(0.5, 0.5, 42);
        c.strokeStyle = '#f4f6f8';
        c.lineWidth = 2;
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI / 2 + k * (Math.PI * 2 / 3) + 0.4;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14);
          c.stroke();
        }
        c.fillStyle = '#9aa0a6';
        c.beginPath();
        c.arc(x, y, 2, 0, Math.PI * 2);
        c.fill();
      });
      break;
    case 'coal':
      s.box(0.3, 0.3, 2.7, 1.8, 26, '#5c6470', '#454c56', { windows: true, floors: true });
      s.cylinder(0.85, 2.45, 0.42, 14, '#3a3f46', '#2a2e33');
      s.chimney(2.0, 2.05, 62, 0, 0.3);
      s.chimney(2.45, 2.45, 56, 0, 0.3);
      break;
    case 'gas':
      s.box(0.3, 0.5, 2.1, 2.0, 20, '#8a9299', '#6c7178', { windows: true });
      s.cylinder(2.55, 0.7, 0.32, 18, '#dfe3e7', '#f0f2f4');
      s.cylinder(2.55, 1.6, 0.32, 18, '#dfe3e7', '#f0f2f4');
      s.chimney(0.5, 2.3, 44, 0, 0.22);
      break;
    case 'nuclear':
      s.cylinder(1.1, 1.1, 0.7, 62, '#d7d9dc', '#4a5560', { rTop: 0.48 });
      s.cylinder(2.9, 1.1, 0.7, 62, '#d7d9dc', '#4a5560', { rTop: 0.48 });
      s.custom(100, (c) => {
        c.fillStyle = 'rgba(255,255,255,0.6)';
        for (const [u, v] of [[1.1, 1.1], [2.9, 1.1]]) {
          const [x, y] = P(u, v, 64);
          for (let k = 0; k < 3; k++) {
            c.beginPath();
            c.arc(x + k * 4, y - 6 - k * 7, 5 + k * 2, 0, Math.PI * 2);
            c.fill();
          }
        }
      });
      s.box(1.0, 2.3, 3.0, 3.7, 20, '#c4c9ce', '#a8adb2', { windows: true });
      s.dome(2.0, 3.0, 0.62, 20, '#e3e6e9');
      break;
    case 'pump':
      s.cylinder(0.5, 0.5, 0.26, 10, '#3d7fe0', '#2a5db0');
      s.cylinder(0.5, 0.5, 0.1, 6, '#9fb6d9', '#c9d8ee', { z0: 10 });
      s.custom(50, (c) => {
        const [x, y] = P(0.82, 0.5, 4);
        c.strokeStyle = '#2a5db0';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(x - 10, y);
        c.lineTo(x, y);
        c.stroke();
      });
      break;
    case 'tower':
      for (const [u, v] of [[0.55, 0.55], [1.45, 0.55], [0.55, 1.45], [1.45, 1.45]]) {
        s.cylinder(u, v, 0.07, 32, '#7a7f86', '#555');
      }
      s.cylinder(1.0, 1.0, 0.72, 20, '#8fc0ee', '#a9d0f5', { z0: 30 });
      s.cylinder(1.0, 1.0, 0.72, 10, '#5c8fc4', '#5c8fc4', { z0: 50, rTop: 0.06 });
      break;
    case 'police':
      s.box(0.4, 0.4, 2.6, 1.9, 22, '#8c9bb5', '#3e5a8a', { windows: true });
      s.box(0.9, 1.9, 2.1, 2.55, 10, '#a9b6cc', '#6f84a8');
      s.custom(50, (c) => {
        const [x, y] = P(2.7, 2.7);
        c.strokeStyle = '#ddd';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x, y - 22);
        c.stroke();
        c.fillStyle = '#2f5fc4';
        c.fillRect(x, y - 22, 7, 4);
      });
      break;
    case 'fire':
      s.box(0.4, 0.7, 2.6, 2.3, 20, '#c9524a', '#8f2f2a', { windows: true });
      s.custom(40, (c) => {
        for (let k = 0; k < 3; k++) {
          const u0 = 0.55 + k * 0.7;
          poly(c, [P(u0, 2.3, 0), P(u0 + 0.5, 2.3, 0), P(u0 + 0.5, 2.3, 12), P(u0, 2.3, 12)], '#e8e2d6');
        }
      });
      s.box(2.15, 0.2, 2.75, 0.8, 40, '#b34a43', '#7a2b27');
      break;
    case 'school':
      s.box(0.3, 0.3, 2.7, 1.3, 16, '#f4e3a1', '#e07b39', { windows: true });
      s.box(0.3, 1.3, 1.1, 2.6, 14, '#f7ecc0', '#e07b39', { windows: true });
      s.disc(2.0, 2.0, 0.55, '#c7b07a', 0, -1);
      s.tree(2.6, 1.7, 4);
      s.tree(1.6, 2.7, 4);
      break;
    case 'hospital':
      s.box(0.3, 0.3, 2.7, 2.7, 30, '#eef0f2', '#d8dcdf', { windows: true });
      s.custom(50, (c) => {
        poly(c, [P(1.2, 1.4, 30), P(1.8, 1.4, 30), P(1.8, 1.6, 30), P(1.2, 1.6, 30)], '#d63b3b');
        poly(c, [P(1.4, 1.2, 30), P(1.6, 1.2, 30), P(1.6, 1.8, 30), P(1.4, 1.8, 30)], '#d63b3b');
      });
      break;
    case 'station':
      s.box(0.1, 0.1, 1.9, 0.9, 3, '#b8b8b8', '#cfcfcf');
      s.box(0.2, 1.1, 1.8, 1.9, 16, '#e8e0d0', '#c62828', { windows: true });
      for (const u of [0.25, 1.0, 1.75]) s.box(u - 0.05, 0.45, u + 0.05, 0.55, 12, '#7a7a7a', '#7a7a7a', { z0: 3 });
      s.box(0.15, 0.15, 1.85, 0.85, 2, '#8d8d8d', '#a5a5a5', { z0: 15 });
      break;
    case 'bus':
      s.box(0.1, 0.1, 1.9, 1.4, 16, '#9a9a9a', '#7a7a7a', { windows: true });
      s.box(0.3, 1.5, 1.3, 1.9, 8, '#f2c14e', '#d9a93a');
      s.box(1.5, 1.55, 1.85, 1.85, 6, '#f2c14e', '#d9a93a');
      break;
    case 'port':
      s.box(0.2, 0.2, 1.6, 1.2, 16, '#8fa3ad', '#6f7f8a', { windows: true });
      s.box(0.3, 1.6, 0.9, 2.0, 8, '#d94141', '#b53232');
      s.box(1.0, 1.6, 1.6, 2.0, 8, '#3a6fd8', '#2d58ad');
      s.box(0.3, 2.2, 0.9, 2.6, 8, '#8ccf6a', '#6faa50');
      s.box(2.3, 2.3, 2.55, 2.55, 50, '#c9503a', '#a33d2b');
      s.custom(100, (c) => {
        const [x0, y0] = P(2.42, 2.42, 50);
        const [x1, y1] = P(2.42, 0.3, 46);
        c.strokeStyle = '#c9503a';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
        c.strokeStyle = '#333';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x1, y1 + 18);
        c.stroke();
      });
      break;
    case 'airport':
      s.custom(-2, (c) => {
        poly(c, [P(0.2, 2.9), P(3.8, 2.9), P(3.8, 3.7), P(0.2, 3.7)], '#4a4e54');
        c.strokeStyle = 'rgba(255,255,255,0.75)';
        c.lineWidth = 1;
        c.setLineDash([4, 4]);
        const [x0, y0] = P(0.3, 3.3);
        const [x1, y1] = P(3.7, 3.3);
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
        c.setLineDash([]);
        poly(c, [P(0.2, 1.6), P(3.4, 1.6), P(3.4, 2.7), P(0.2, 2.7)], '#7d7f82');
      });
      s.box(0.3, 0.3, 2.7, 1.3, 18, '#c9cdd2', '#9aa0a6', { windows: true });
      s.box(3.0, 0.5, 3.4, 0.9, 40, '#d0d4d8', '#b0b4b8');
      s.box(2.9, 0.4, 3.5, 1.0, 8, '#7fa0c6', '#c3d0e0', { z0: 40 });
      s.custom(20, (c) => {
        c.strokeStyle = '#f4f6f8';
        c.lineCap = 'round';
        c.lineWidth = 3;
        const [x0, y0] = P(1.0, 3.3, 2);
        const [x1, y1] = P(2.0, 3.3, 2);
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
        const [w0, w1y] = P(1.45, 2.95, 2);
        const [w1, w2y] = P(1.45, 3.65, 2);
        c.beginPath();
        c.moveTo(w0, w1y);
        c.lineTo(w1, w2y);
        c.stroke();
        c.lineCap = 'butt';
      });
      break;
    case 'cityhall':
      s.box(0.3, 0.5, 2.7, 2.3, 26, '#efe9dc', '#cfc8ba', { windows: true, floors: true });
      for (const u of [0.6, 1.1, 1.6, 2.1]) s.cylinder(u + 0.08, 2.38, 0.07, 22, '#f7f3ea', '#e0dacd');
      s.box(0.5, 2.3, 2.6, 2.5, 3, '#d9d3c5', '#ebe6da', { z0: 22 });
      s.dome(1.5, 1.4, 0.55, 26, '#5fb3a1');
      s.antenna(1.5, 1.4, 48, 10, '#ddd');
      break;
    case 'statue':
      s.cylinder(0.5, 0.5, 0.16, 10, '#b4b9c0', '#d0d4d8');
      s.cylinder(0.5, 0.5, 0.06, 14, '#5fb3a1', '#6cc4b1', { z0: 10 });
      s.custom(50, (c) => {
        const [x, y] = P(0.5, 0.5, 26);
        c.fillStyle = '#7c8c6a';
        c.beginPath();
        c.arc(x, y - 2, 2.5, 0, Math.PI * 2);
        c.fill();
      });
      break;
    case 'mansion':
      s.house(0.3, 0.35, 1.7, 1.35, 18, 10, '#f7efe0', '#4f6d8f');
      s.house(0.35, 1.45, 0.95, 1.9, 12, 7, '#f7efe0', '#4f6d8f');
      s.disc(1.45, 1.7, 0.28, '#4aa3e0', 0, -1);
      s.tree(1.85, 0.2, 5);
      s.tree(0.15, 1.9, 5);
      break;
    case 'arcology':
      s.box(0.2, 0.2, 3.8, 3.8, 30, '#7fb0bd', '#b8dde3', { windows: true, floors: true });
      s.box(0.7, 0.7, 3.3, 3.3, 30, '#86b8c4', '#c0e2e8', { z0: 30, windows: true, floors: true });
      s.box(1.2, 1.2, 2.8, 2.8, 30, '#8fc1cc', '#c9e8ed', { z0: 60, windows: true, floors: true });
      s.dome(2.0, 2.0, 0.55, 90, '#dff3f6');
      s.antenna(2.0, 2.0, 108, 5);
      break;
    case 'park':
      s.custom(-2, (c) => poly(c, [P(0.42, 0), P(0.58, 0), P(0.58, 1), P(0.42, 1)], '#d9d2bd'));
      s.tree(0.25, 0.3, 5);
      s.tree(0.75, 0.7, 5);
      s.custom(0.9, (c) => {
        const [x, y] = P(0.75, 0.3);
        c.fillStyle = '#7a5230';
        c.fillRect(x - 4, y - 3, 8, 2);
      });
      break;
    case 'bigpark':
      s.custom(-2, (c) => {
        poly(c, [P(1.42, 0), P(1.58, 0), P(1.58, 3), P(1.42, 3)], '#d9d2bd');
        poly(c, [P(0, 1.42), P(3, 1.42), P(3, 1.58), P(0, 1.58)], '#d9d2bd');
      });
      s.disc(2.1, 2.1, 0.6, '#3b78b5', 0, -1);
      for (const [u, v] of [[0.4, 0.4], [1.0, 0.5], [0.5, 1.0], [2.5, 0.5], [2.6, 1.1], [0.6, 2.4], [1.1, 2.7], [2.7, 2.7]]) {
        s.tree(u, v, 5.5);
      }
      break;
  }
  s.render();
}

// ---- cache ----------------------------------------------------------------

export class SpriteCache {
  private cache = new Map<string, HTMLCanvasElement>();

  /** Whole sprite; `n` is the footprint side, the anchor is the back corner of the footprint. */
  get(key: string, scale: number, n = 1): HTMLCanvasElement {
    const k = `${key}@${scale.toFixed(3)}`;
    let c = this.cache.get(k);
    if (!c) {
      c = document.createElement('canvas');
      c.width = Math.ceil(n * TILE_W * scale);
      c.height = Math.ceil((n * TILE_H + MAX_H) * scale);
      const ctx = c.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.lineJoin = 'round';
      N = n;
      drawByKey(ctx, key);
      N = 1;
      SLOPE = [0, 0, 0, 0];
      this.cache.set(k, c);
    }
    return c;
  }

  /**
   * The slice of a multi-tile sprite that stands above footprint tile (tx, ty),
   * as a regular 1x1 sprite. Drawing each slice at its own tile's turn keeps
   * the painter's order right against neighbouring buildings.
   */
  getColumn(key: string, scale: number, n: number, tx: number, ty: number): HTMLCanvasElement {
    const k = `${key}@${scale.toFixed(3)}#${tx},${ty}`;
    let c = this.cache.get(k);
    if (!c) {
      const full = this.get(key, scale, n);
      c = document.createElement('canvas');
      c.width = Math.ceil(TILE_W * scale);
      c.height = Math.ceil((TILE_H + MAX_H) * scale);
      const ctx = c.getContext('2d')!;
      ctx.scale(scale, scale);
      const W = TILE_W, H = TILE_H;
      ctx.beginPath();
      ctx.moveTo(0, MAX_H + H / 2);
      ctx.lineTo(W / 2, MAX_H + H);
      ctx.lineTo(W, MAX_H + H / 2);
      ctx.lineTo(W, H / 2);
      ctx.lineTo(W / 2, 0);
      ctx.lineTo(0, H / 2);
      ctx.closePath();
      ctx.clip();
      const offX = W / 2 * (1 - n - tx + ty);
      const offY = -(tx + ty) * H / 2;
      ctx.drawImage(full, 0, 0, full.width, full.height, offX, offY, full.width / scale, full.height / scale);
      this.cache.set(k, c);
    }
    return c;
  }
}

function drawByKey(ctx: Ctx, key: string): void {
  const parts = key.split(':');
  const num = (i: number) => parseInt(parts[i], 10);
  switch (parts[0]) {
    case 'grass': SLOPE = parseSlope(parts[1]); return drawGrass(ctx, num(2));
    case 'water': return drawWater(ctx, num(1), num(2));
    case 'tree': SLOPE = parseSlope(parts[1]); return drawTrees(ctx, num(2));
    case 'road': SLOPE = parseSlope(parts[2]); return drawRoad(ctx, num(1));
    case 'bridge': return drawBridge(ctx, num(1));
    case 'hwy': SLOPE = parseSlope(parts[2]); return drawHighway(ctx, num(1));
    case 'hwybridge': return drawHighwayBridge(ctx, num(1));
    case 'rail': SLOPE = parseSlope(parts[2]); return drawRail(ctx, num(1));
    case 'wire': SLOPE = parseSlope(parts[2]); return drawWire(ctx, num(1));
    case 'zone': return drawEmptyZone(ctx, num(1) as ZoneType);
    case 'rubble': SLOPE = parseSlope(parts[1]); return drawRubble(ctx, num(2));
    case 'fire': return drawFlames(ctx, num(1));
    case 'bld': return drawBuilding(ctx, num(1) as ZoneType, num(2), num(3));
    case 'big': return drawBigBuilding(ctx, num(1) as ZoneType, num(2), num(3), num(4));
    case 'st': return drawStruct(ctx, parts[1] as StructType);
  }
}

// ---- icons -----------------------------------------------------------------

const iconCache = new SpriteCache();

/**
 * Small square thumbnail of one or more sprites stacked (ground first), for
 * toolbar buttons. Tall sprites are bottom-aligned and cropped at the top.
 */
export function renderIcon(keys: string[], n = 1, size = 44): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const visibleH = n * TILE_H + (n === 1 ? 62 : 80);
  const scale = Math.min(size / (n * TILE_W), size / visibleH);
  for (const key of keys) {
    const spr = iconCache.get(key, scale, n);
    ctx.drawImage(spr, (size - spr.width) / 2, size - spr.height);
  }
  return c;
}
