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
/** when set, footprint axes are swapped: the sprite is drawn turned by a quarter (mirrored across the diagonal) */
let SWAP = false;

/** Animated bits a sprite asks the renderer to draw over it: smoke rising from a chimney, a blinking light. */
export interface Effect {
  /** smoke rises when active; a beacon blinks; a signal cycles green, amber, red; a crossing lamp blinks only when active */
  kind: 'smoke' | 'beacon' | 'signal' | 'xing';
  u: number;
  v: number;
  z: number;
  color: string;
}
let currentEffects: Effect[] = [];
function P(u: number, v: number, h = 0): Pt2 {
  if (SWAP) [u, v] = [v, u];
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

function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const GRASS = ['#6aa84f', '#68a64d', '#6cab52', '#66a34b'];
const DRY = ['#ad9f6a', '#ab9d68', '#b0a36e', '#a89a65'];
/** grass by altitude level 0..4: lush lowlands blending into dry ground up top */
const GRASS_BY_ALT = Array.from({ length: 5 }, (_, l) => GRASS.map((g, k) => mix(g, DRY[k], l / 4)));
/** altitude level of the tile being drawn (0..4), set from the sprite key */
let ALT = 0;

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
  const c = GRASS_BY_ALT[ALT][variant % GRASS.length];
  drawGroundFill(ctx, c, tx, ty);
  ctx.fillStyle = ALT >= 3 ? '#8a8577' : shade(c, 0.86);
  for (let k = 0; k < 5; k++) {
    const h = hash2(variant, k, 31);
    const u = 0.15 + ((h & 0xff) / 255) * 0.7;
    const v = 0.15 + (((h >> 8) & 0xff) / 255) * 0.7;
    const [x, y] = P(tx + u, ty + v);
    ctx.fillRect(x, y, 2, 1);
  }
}

/** footprint polygon */
function fpPoly(ctx: Ctx, pts: [number, number][], color: string): void {
  poly(ctx, pts.map(([u, v]) => P(u, v)), color);
}

function fpCircle(cu: number, cv: number, rad: number): [number, number][] {
  return Array.from({ length: 24 }, (_, k) => [cu + rad * Math.cos((k / 24) * 2 * Math.PI), cv + rad * Math.sin((k / 24) * 2 * Math.PI)]);
}

/** fills a footprint square, then carves a circle back out of it in the colour below: a rounded corner */
function squareMinusCircle(ctx: Ctx, u0: number, v0: number, u1: number, v1: number, cu: number, cv: number, r: number, color: string, below: string): void {
  fpPoly(ctx, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color);
  ctx.save();
  ctx.beginPath();
  for (const [k, [u, v]] of ([[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as [number, number][]).entries()) {
    const p = P(u, v);
    if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.clip();
  fpPoly(ctx, fpCircle(cu, cv, r), below);
  ctx.restore();
}

/**
 * One band of shore inside a water tile: a strip of width `w` along each land side, a fillet of
 * radius `r` where two sides meet (the corner is filled, then the arc carved back in the colour
 * below), and a rounded cap around a land tile that only touches a corner. Land tiles keep their
 * full diamond, so what can be built on stays readable.
 */
function coastLayer(ctx: Ctx, mask: number, w: number, r: number, color: string, below: string): void {
  const N = mask & 1, E = mask & 2, So = mask & 4, W = mask & 8;
  if (N) fpPoly(ctx, [[0, 0], [1, 0], [1, w], [0, w]], color);
  if (E) fpPoly(ctx, [[1 - w, 0], [1, 0], [1, 1], [1 - w, 1]], color);
  if (So) fpPoly(ctx, [[0, 1 - w], [1, 1 - w], [1, 1], [0, 1]], color);
  if (W) fpPoly(ctx, [[0, 0], [w, 0], [w, 1], [0, 1]], color);
  const sides = (N ? 1 : 0) + (E ? 1 : 0) + (So ? 1 : 0) + (W ? 1 : 0);
  if (sides === 2) {
    if (N && E) squareMinusCircle(ctx, 1 - w - r, w, 1 - w, w + r, 1 - w - r, w + r, r, color, below);
    if (E && So) squareMinusCircle(ctx, 1 - w - r, 1 - w - r, 1 - w, 1 - w, 1 - w - r, 1 - w - r, r, color, below);
    if (So && W) squareMinusCircle(ctx, w, 1 - w - r, w + r, 1 - w, w + r, 1 - w - r, r, color, below);
    if (W && N) squareMinusCircle(ctx, w, w, w + r, w + r, w + r, w + r, r, color, below);
  }
  if (mask & 16) fpPoly(ctx, fpCircle(1, 0, w), color);
  if (mask & 32) fpPoly(ctx, fpCircle(1, 1, w), color);
  if (mask & 64) fpPoly(ctx, fpCircle(0, 1, w), color);
  if (mask & 128) fpPoly(ctx, fpCircle(0, 0, w), color);
}

const WATER_DEPTH = ['#3b78b5', '#3b78b5', '#356fab', '#2f66a1'];
const SHALLOW = '#5a9fd0';
const SAND = '#d9c98f';

/**
 * Water tile. `mask` = land around it (N=1 E=2 S=4 W=8, NE=16 SE=32 SW=64 NW=128, a diagonal only
 * when both sides next to it are water); `depth` = steps from the shore (1..3), darker further out.
 */
function drawWater(ctx: Ctx, mask: number, depth: number, variant: number, frame: number): void {
  const deep = WATER_DEPTH[Math.max(1, Math.min(3, depth))];
  const c = variant % 2 ? shade(deep, 0.97) : deep;
  const d = diamond();
  // the outline seals hairline seams between water tiles; by the shore it would draw a blue line over the sand next door
  poly(ctx, d, c, mask ? undefined : c, 1);
  if (mask) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d[0][0], d[0][1]);
    for (let k = 1; k < 4; k++) ctx.lineTo(d[k][0], d[k][1]);
    ctx.closePath();
    ctx.clip();
    // seal the seams from inside: the half of the stroke outside the diamond is clipped away
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.stroke();
    coastLayer(ctx, mask, 0.3, 0.4, SHALLOW, c);
    coastLayer(ctx, mask, 0.12, 0.3, SAND, SHALLOW);
    ctx.restore();
    return;
  }
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

function treeAt(ctx: Ctx, u: number, v: number, r: number, k: number, species = 0): void {
  const [x, y] = P(u, v);
  ctx.fillStyle = '#5a3d1e';
  ctx.fillRect(x - 1, y - 4, 2, 5);
  // 0: deep green woods, 2: lighter mixed woods with the odd russet crown
  const g = species === 2 ? (k % 4 === 1 ? '#c58f3c' : k % 2 ? '#5aa03a' : '#7db347') : k % 2 ? '#2f7a2f' : '#33863a';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y - r - 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(g, 1.25);
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r - 2 - r * 0.3, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

/** a conifer: trunk and two stacked cones, lit on the left */
function coniferAt(ctx: Ctx, u: number, v: number, r: number, k: number): void {
  const [x, y] = P(u, v);
  ctx.fillStyle = '#4a3218';
  ctx.fillRect(x - 1, y - 3, 2, 4);
  const g = k % 2 ? '#2b6b33' : '#2f7438';
  const H = r * 2.6;
  for (const [y0, hh, ww] of [[y - 3, H * 0.6, r * 1.1], [y - 3 - H * 0.42, H * 0.58, r * 0.8]] as [number, number, number][]) {
    poly(ctx, [[x, y0 - hh], [x + ww, y0], [x - ww, y0]], g);
    poly(ctx, [[x, y0 - hh], [x, y0], [x - ww, y0]], shade(g, 1.2));
  }
}

/** Two to four trees on grass; `species` 0 deep green, 1 conifers, 2 mixed light woods. Conifers take over up the hills. */
function drawTrees(ctx: Ctx, variant: number, species = 0): void {
  drawGrass(ctx, variant);
  const kind = ALT >= 3 ? 1 : species;
  const n = 2 + (variant % 3);
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
  for (const t of trees) {
    if (kind === 1) coniferAt(ctx, t.u, t.v, t.r * 0.9, t.k);
    else treeAt(ctx, t.u, t.v, t.r, t.k, kind);
  }
}

/** mask bits: 1 = (x, y-1), 2 = (x+1, y), 4 = (x, y+1), 8 = (x-1, y) */
interface Bend {
  q: (t: number) => Pt2;
  normal: (t: number) => Pt2;
}

/** For a tile with exactly two arms at right angles: the smooth curve joining them (point and unit normal in footprint space). */
function bend(mask: number): Bend | null {
  const ends: Pt2[] = [];
  if (mask & 1) ends.push([0.5, 0]);
  if (mask & 2) ends.push([1, 0.5]);
  if (mask & 4) ends.push([0.5, 1]);
  if (mask & 8) ends.push([0, 0.5]);
  if (ends.length !== 2 || ends[0][0] === ends[1][0] || ends[0][1] === ends[1][1]) return null;
  const [a, b] = ends;
  const q = (t: number): Pt2 => {
    const s = 1 - t;
    return [s * s * a[0] + 2 * s * t * 0.5 + t * t * b[0], s * s * a[1] + 2 * s * t * 0.5 + t * t * b[1]];
  };
  const normal = (t: number): Pt2 => {
    const [u0, v0] = q(Math.max(0, t - 0.01)), [u1, v1] = q(Math.min(1, t + 0.01));
    const du = u1 - u0, dv = v1 - v0, l = Math.hypot(du, dv) || 1;
    return [-dv / l, du / l];
  };
  return { q, normal };
}

/** Polygon of a band of half-width `w` along a bend. */
function bendBand(b: Bend, w: number, steps = 24): Pt2[] {
  const left: Pt2[] = [], right: Pt2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [u, v] = b.q(t), [nu, nv] = b.normal(t);
    left.push(P(u + nu * w, v + nv * w));
    right.push(P(u - nu * w, v - nv * w));
  }
  return [...left, ...right.reverse()];
}

/** Stroke a line running along a bend, offset by `k` from its middle. */
function bendLine(ctx: Ctx, b: Bend, k: number, color: string, width: number, dash: number[] = [], steps = 24): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [u, v] = b.q(t), [nu, nv] = b.normal(t);
    const [x, y] = P(u + nu * k, v + nv * k);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

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
  const bd = bend(m);
  if (bd) {
    poly(ctx, bendBand(bd, 0.24), kerb);
    poly(ctx, bendBand(bd, 0.2), asphalt);
    bendLine(ctx, bd, 0, '#d8c25a', 1.2, [3, 3]);
    return;
  }
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
  // a junction: a light and a stop line on every approach
  if (arms.length >= 3) {
    for (const d of [1, 2, 4, 8]) {
      if (!(m & d)) continue;
      stopLine(ctx, d, 0.3, 0.2);
      trafficLight(ctx, d, 0.26, 0.5 + inboundSide(d) * 0.28);
    }
  }
}


/** tile coords at distance t from the edge on side d (N=1 E=2 S=4 W=8), lateral position w across that arm */
function armUV(d: number, t: number, w: number): [number, number] {
  return d === 1 ? [w, t] : d === 2 ? [1 - t, w] : d === 4 ? [w, 1 - t] : [t, w];
}

/** Right-hand traffic: +1 when the kerb on the right of traffic entering from side d lies toward larger w, else -1. */
function inboundSide(d: number): number {
  return d === 1 || d === 2 ? -1 : 1;
}

/** screen unit vector of a sign's face, which stretches across the arm it watches: along u for N/S arms, along v for E/W arms */
function faceAxis(d: number): Pt2 {
  const k = 1 / Math.sqrt(5);
  return d === 1 || d === 4 ? [2 * k, k] : [-2 * k, k];
}

/** point of a sign face centred on c (screen), radius r, angle a: the face spans `e` horizontally and screen-up vertically */
function onFace(c: Pt2, e: Pt2, r: number, a: number): Pt2 {
  return [c[0] + Math.cos(a) * r * e[0], c[1] + Math.cos(a) * r * e[1] - Math.sin(a) * r];
}

function strokeSeg(ctx: Ctx, a: Pt2, b: Pt2, color: string, width: number, dash: number[] = []): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** white line across the inbound half of the arm from side d, where vehicles stop */
function stopLine(ctx: Ctx, d: number, t: number, half: number): void {
  strokeSeg(ctx, P(...armUV(d, t, 0.5)), P(...armUV(d, t, 0.5 + inboundSide(d) * half)), '#f2f2f2', 1.6);
}

/** a signal post beside the inbound lane of side d: pole, head facing the traffic, a lamp the renderer cycles */
function trafficLight(ctx: Ctx, d: number, t: number, w: number): void {
  const [u, v] = armUV(d, t, w);
  const H = 9;
  strokeSeg(ctx, P(u, v), P(u, v, H), '#3c4046', 1.2);
  const c = P(u, v, H + 2.6), e = faceAxis(d);
  poly(ctx, [onFace(c, e, 1.3, 0), [c[0] + 1.3 * e[0], c[1] + 1.3 * e[1] + 2.6], [c[0] - 1.3 * e[0], c[1] - 1.3 * e[1] + 2.6], onFace(c, e, 1.3, Math.PI)], '#23262b');
  poly(ctx, [[c[0] + 1.3 * e[0], c[1] + 1.3 * e[1] - 2.6], [c[0] + 1.3 * e[0], c[1] + 1.3 * e[1] + 2.6], [c[0] - 1.3 * e[0], c[1] - 1.3 * e[1] + 2.6], [c[0] - 1.3 * e[0], c[1] - 1.3 * e[1] - 2.6]], '#23262b');
  currentEffects.push({ kind: 'signal', u, v, z: H + 2.6, color: d === 1 || d === 4 ? 'y' : 'x' });
}

/** a red octagon on a post, facing the traffic entering from side d */
function stopSign(ctx: Ctx, d: number, t: number, w: number): void {
  const [u, v] = armUV(d, t, w);
  const H = 8, R = 2.8;
  strokeSeg(ctx, P(u, v), P(u, v, H), '#6a6e74', 1);
  const c = P(u, v, H + R), e = faceAxis(d);
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const p = onFace(c, e, R, Math.PI / 8 + (k * Math.PI) / 4);
    if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fillStyle = '#d7261e';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  // the word, as a bar
  strokeSeg(ctx, onFace(c, e, 1.5, 0), onFace(c, e, 1.5, Math.PI), '#ffffff', 0.9);
}

/** St Andrew's cross on a post beside the inbound lane of side d, its barrier raised at the kerb; the lamp blinks when a train is close */
function crossingSign(ctx: Ctx, d: number, t: number, w: number, kerb: number): void {
  const [u, v] = armUV(d, t, w);
  const H = 9, R = 3;
  strokeSeg(ctx, P(u, v), P(u, v, H), '#d7d9dc', 1.1);
  const c = P(u, v, H + 1.5), e = faceAxis(d);
  for (const [color, lw] of [['#ffffff', 1.9], ['#e0312a', 0.8]] as [string, number][]) {
    strokeSeg(ctx, onFace(c, e, R, Math.PI / 4), onFace(c, e, R, (5 * Math.PI) / 4), color, lw);
    strokeSeg(ctx, onFace(c, e, R, (3 * Math.PI) / 4), onFace(c, e, R, (7 * Math.PI) / 4), color, lw);
  }
  const [bu, bv] = armUV(d, t, kerb);
  strokeSeg(ctx, P(bu, bv), P(bu, bv, 11), '#e0312a', 1.6);
  strokeSeg(ctx, P(bu, bv), P(bu, bv, 11), '#ffffff', 1.6, [2.5, 2.5]);
  currentEffects.push({ kind: 'xing', u, v, z: H - 2, color: '#ff3b30' });
}


function drawRoad(ctx: Ctx, mask: number): void {
  drawGrass(ctx, mask % GRASS.length);
  drawRoadSurface(ctx, mask);
}

/**
 * Wide, dark, four lanes and a centre barrier. Arms flagged in `roadArms` continue as a plain road:
 * they narrow to the road width at the edge, over half the tile on a straight run, at the mouth of a junction.
 */
function drawHighwaySurface(ctx: Ctx, mask: number, roadArms = 0): void {
  const m = mask === 0 ? 10 : mask;
  const HW = 0.32, RW = 0.2; // half-widths of the highway and of a road
  const straight = m === 5 || m === 10;
  const start = straight ? 0.5 : 0.18; // where an arm leaves the junction pad
  const at = (d: number, t: number, w: number): Pt2 => P(...armUV(d, t, w));
  const dirs = [1, 2, 4, 8].filter((d) => m & d);
  const armPoly = (d: number, g: number): Pt2[] => {
    const wo = roadArms & d ? RW : HW;
    return [at(d, 0, 0.5 - wo - g), at(d, 0, 0.5 + wo + g), at(d, start + g, 0.5 + HW + g), at(d, start + g, 0.5 - HW - g)];
  };
  const rectPoly = (u0: number, v0: number, u1: number, v1: number): Pt2[] =>
    [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  const bd = roadArms ? null : bend(m);
  if (bd) {
    poly(ctx, bendBand(bd, 0.36), '#8d9299');
    poly(ctx, bendBand(bd, 0.32), '#484c52');
    bendLine(ctx, bd, 0, '#d0d0d0', 1.5);
    bendLine(ctx, bd, -0.16, 'rgba(255,255,255,0.7)', 1, [3, 4]);
    bendLine(ctx, bd, 0.16, 'rgba(255,255,255,0.7)', 1, [3, 4]);
    return;
  }
  for (const pass of [0, 1]) {
    const g = pass === 0 ? 0.04 : 0;
    const col = pass === 0 ? '#8d9299' : '#484c52';
    if (!straight) poly(ctx, rectPoly(0.18 - g, 0.18 - g, 0.82 + g, 0.82 + g), col);
    for (const d of dirs) poly(ctx, armPoly(d, g), col);
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
  const ends: [number, Pt2, Pt2, Pt2][] = [];
  if (m & 1) ends.push([1, P(0.5, 0), P(0.34, 0), P(0.66, 0)]);
  if (m & 2) ends.push([2, P(1, 0.5), P(1, 0.34), P(1, 0.66)]);
  if (m & 4) ends.push([4, P(0.5, 1), P(0.34, 1), P(0.66, 1)]);
  if (m & 8) ends.push([8, P(0, 0.5), P(0, 0.34), P(0, 0.66)]);
  for (const [d, mid, l1, l2] of ends) {
    // the lanes merge on a narrowing arm: road marking only
    if (roadArms & d) { line(at(d, start, 0.5), mid, '#d8c25a', 1.2, [3, 3]); continue; }
    line(P(0.5, 0.5), mid, '#d0d0d0', 1.5, []);
    line(P(0.34, 0.34), l1, 'rgba(255,255,255,0.7)', 1, [3, 4]);
    line(P(0.66, 0.66), l2, 'rgba(255,255,255,0.7)', 1, [3, 4]);
  }
  // who yields: roads joining a highway that runs through or bends; the highway itself when it ends at a road running through
  const hwArms = m & ~roadArms;
  const opp = (d: number) => (d === 1 ? 4 : d === 4 ? 1 : d === 2 ? 8 : 2);
  const through = (bits: number) => ((bits & 5) === 5 || (bits & 10) === 10);
  let stops = 0;
  if (!hwArms || straight) stops = 0;
  else if (through(hwArms) || (hwArms & (hwArms - 1))) stops = roadArms;
  else if (roadArms & opp(hwArms)) stops = roadArms & ~opp(hwArms);
  else if (through(roadArms)) stops = hwArms;
  for (const d of dirs) {
    if (!(stops & d)) continue;
    const half = roadArms & d ? 0.3 : HW;
    stopLine(ctx, d, 0.2, half);
    stopSign(ctx, d, 0.1, 0.5 + inboundSide(d) * (half + 0.1));
  }
}

function drawHighway(ctx: Ctx, mask: number, roadArms = 0): void {
  drawGrass(ctx, mask % GRASS.length);
  drawHighwaySurface(ctx, mask, roadArms);
}

function drawHighwayBridge(ctx: Ctx, mask: number, ramp = 0, roadArms = 0): void {
  const saved = SLOPE;
  const deck = bridgeSlope(ramp);
  SLOPE = [0, 0, 0, 0];
  drawWater(ctx, 0, 1, mask & 1, 0);
  const ph = pierHeight(deck);
  if (ph > 0) {
    const pier = new Scene(ctx, 0);
    pier.box(0.25, 0.4, 0.45, 0.6, ph, '#6b6f75', '#8a8f96');
    pier.box(0.55, 0.4, 0.75, 0.6, ph, '#6b6f75', '#8a8f96');
    pier.render();
  }
  SLOPE = deck;
  drawHighwaySurface(ctx, mask, roadArms);
  SLOPE = saved;
}

/** Transparent overlay: sleepers and two rails toward each connected edge. */
/**
 * Track overlay. `extra` = 'x' on a level crossing with a road, 'X' with a highway (signs, barriers, lamps), 'b<bits>' on the
 * deck of a road bridge (lifted only), 'r<bits>' on a ramp
 * climbing to a deck over a highway (bits = sides that stay on the ground, as for bridges).
 */
function drawRail(ctx: Ctx, mask: number, extra?: string): void {
  const m = mask === 0 ? 10 : mask;
  const straight = m === 5 || m === 10;
  if (extra && extra[0] === 'b') {
    const saved = SLOPE;
    SLOPE = bridgeSlope(parseInt(extra.slice(1), 10));
    drawTrack(ctx, m);
    SLOPE = saved;
    return;
  }
  if (extra && extra[0] === 'r' && straight) {
    const lift = bridgeSlope(parseInt(extra.slice(1), 10));
    drawEmbankment(ctx, m, lift);
    const saved = SLOPE;
    SLOPE = [saved[0] + lift[0], saved[1] + lift[1], saved[2] + lift[2], saved[3] + lift[3]];
    drawTrack(ctx, m);
    SLOPE = saved;
    return;
  }
  drawTrack(ctx, m);
  if ((extra === 'x' || extra === 'X') && straight) drawCrossingGear(ctx, m, extra === 'X');
}

/** Track over open water: a trestle deck on a pier, coming down to the shore on the sides in `ramp` (as for road bridges). */
function drawRailBridge(ctx: Ctx, m: number, ramp: number): void {
  const saved = SLOPE;
  SLOPE = [0, 0, 0, 0];
  const deck = bridgeSlope(ramp);
  const ph = pierHeight(deck);
  if (ph > 0) {
    const s = new Scene(ctx, 0);
    s.box(0.4, 0.4, 0.6, 0.6, ph, '#6b6f75', '#8a8f96');
    s.render();
  }
  const W = 0.24, T = 2.5, top = '#8d867a', plusU = '#524c44', plusV = '#655e54';
  const Q = (u: number, v: number, dz = 0): Pt2 => P(u, v, groundHeight(u, v, deck) + dz);
  if (m === 5 || m === 10) {
    const at = (a: number, b: number): [number, number] => (m === 5 ? [0.5 + b, a] : [a, 0.5 + b]);
    const R = (a: number, b: number, dz = 0) => Q(...at(a, b), dz);
    poly(ctx, [R(0, W, -T), R(1, W, -T), R(1, W), R(0, W)], m === 5 ? plusU : plusV);
    poly(ctx, [R(1, -W, -T), R(1, W, -T), R(1, W), R(1, -W)], m === 5 ? plusV : plusU);
    poly(ctx, [R(0, -W), R(0, W), R(1, W), R(1, -W)], top);
  } else {
    // a bend or a junction over the water: the deck's top, arm by arm around a central pad
    const mm = m === 0 ? 10 : m;
    poly(ctx, [Q(0.5 - W, 0.5 - W), Q(0.5 + W, 0.5 - W), Q(0.5 + W, 0.5 + W), Q(0.5 - W, 0.5 + W)], top);
    if (mm & 1) poly(ctx, [Q(0.5 - W, 0), Q(0.5 + W, 0), Q(0.5 + W, 0.5), Q(0.5 - W, 0.5)], top);
    if (mm & 2) poly(ctx, [Q(0.5, 0.5 - W), Q(1, 0.5 - W), Q(1, 0.5 + W), Q(0.5, 0.5 + W)], top);
    if (mm & 4) poly(ctx, [Q(0.5 - W, 0.5), Q(0.5 + W, 0.5), Q(0.5 + W, 1), Q(0.5 - W, 1)], top);
    if (mm & 8) poly(ctx, [Q(0, 0.5 - W), Q(0.5, 0.5 - W), Q(0.5, 0.5 + W), Q(0, 0.5 + W)], top);
  }
  SLOPE = deck;
  drawTrack(ctx, m);
  SLOPE = saved;
}

/** Earth bed under a track that leaves the ground: the long face toward the viewer, the far end, the top. */
function drawEmbankment(ctx: Ctx, m: number, lift: Corners): void {
  const W = 0.24;
  // (u, v) at distance a along the track, offset b across it
  const at = (a: number, b: number): [number, number] => (m === 5 ? [0.5 + b, a] : [a, 0.5 + b]);
  const G = (a: number, b: number) => P(...at(a, b));
  const Q = (a: number, b: number) => { const [u, v] = at(a, b); return P(u, v, groundHeight(u, v, lift)); };
  const plusU = '#5f5a50', plusV = '#736d61';
  poly(ctx, [G(0, W), G(1, W), Q(1, W), Q(0, W)], m === 5 ? plusU : plusV);
  poly(ctx, [G(1, -W), G(1, W), Q(1, W), Q(1, -W)], m === 5 ? plusV : plusU);
  poly(ctx, [Q(0, -W), Q(0, W), Q(1, W), Q(1, -W)], '#8d867a');
}

/** Signs, barriers and stop lines on both approaches of a level crossing; `wide` for a highway. */
function drawCrossingGear(ctx: Ctx, m: number, wide: boolean): void {
  const half = wide ? 0.32 : 0.2;
  for (const d of m === 5 ? [8, 2] : [1, 4]) {
    const s = inboundSide(d);
    stopLine(ctx, d, 0.2, half);
    crossingSign(ctx, d, 0.14, 0.5 + s * (half + 0.12), 0.5 + s * (half + 0.05));
  }
}

/** Track crossing a highway on a deck: piers either side of the carriageway, slab, rails. The highway is the tile's ground sprite. */
function drawRailDeck(ctx: Ctx, m: number): void {
  const DECK = 1.5 * HSTEP, SLAB = 2.5;
  const s = new Scene(ctx, 0);
  const pier = (u0: number, v0: number, u1: number, v1: number) => s.box(u0, v0, u1, v1, DECK - SLAB, '#6b6f75', '#8a8f96');
  if (m === 5) {
    pier(0.3, 0.02, 0.7, 0.14);
    pier(0.3, 0.86, 0.7, 0.98);
    s.box(0.26, 0, 0.74, 1, SLAB, '#7d776c', '#8d867a', { z0: DECK - SLAB, key: 50 });
  } else {
    pier(0.02, 0.3, 0.14, 0.7);
    pier(0.86, 0.3, 0.98, 0.7);
    s.box(0, 0.26, 1, 0.74, SLAB, '#7d776c', '#8d867a', { z0: DECK - SLAB, key: 50 });
  }
  s.render();
  const saved = SLOPE;
  SLOPE = [saved[0] + 1.5, saved[1] + 1.5, saved[2] + 1.5, saved[3] + 1.5];
  drawTrack(ctx, m);
  SLOPE = saved;
}

function drawTrack(ctx: Ctx, m: number): void {
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
  const bd = bend(m);
  if (bd) {
    // a bend: sleepers along the curve, then the two rails
    for (let t = 0.05; t < 1; t += 0.09) {
      const [u, v] = bd.q(t), [nu, nv] = bd.normal(t);
      seg(P(u - nu * 0.16, v - nv * 0.16), P(u + nu * 0.16, v + nv * 0.16), '#6b5537', 1.5);
    }
    bendLine(ctx, bd, -0.07, '#3a3a3a', 1.2);
    bendLine(ctx, bd, 0.07, '#3a3a3a', 1.2);
    return;
  }
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
/**
 * Deck heights (in HSTEP units) of a bridge tile: raised, except the corners on
 * the sides that lead back to land (`ramp` bits N=1 E=2 S=4 W=8), which come
 * down to the ground so the road climbs onto the bridge.
 */
export function bridgeSlope(ramp: number): Corners {
  const c: Corners = [1.5, 1.5, 1.5, 1.5];
  if (ramp & 1) { c[0] = 0; c[1] = 0; }
  if (ramp & 2) { c[1] = 0; c[2] = 0; }
  if (ramp & 4) { c[2] = 0; c[3] = 0; }
  if (ramp & 8) { c[3] = 0; c[0] = 0; }
  return c;
}

/** height of the pier under a deck: the deck's height at the tile centre */
function pierHeight(deck: Corners): number {
  return (deck[0] + deck[1] + deck[2] + deck[3]) / 4 * HSTEP;
}

function drawBridge(ctx: Ctx, mask: number, ramp = 0): void {
  const saved = SLOPE;
  const deck = bridgeSlope(ramp);
  SLOPE = [0, 0, 0, 0];
  drawWater(ctx, 0, 1, mask & 1, 0);
  const ph = pierHeight(deck);
  if (ph > 0) {
    const pier = new Scene(ctx, 0);
    pier.box(0.4, 0.4, 0.6, 0.6, ph, '#6b6f75', '#8a8f96');
    pier.render();
  }
  SLOPE = deck;
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

/** Zoned but still empty: hatched in the zone colour, double outline and a letter, so it reads on any ground. */
function drawEmptyZone(ctx: Ctx, zone: ZoneType): void {
  drawGrass(ctx, zone);
  const c = ZONE_COLOR[zone];
  const d = diamond(0.08);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d[0][0], d[0][1]);
  for (const [x, y] of d.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = alpha(c, 0.3);
  ctx.fill();
  // stripes along one iso diagonal
  ctx.strokeStyle = alpha(c, 0.8);
  ctx.lineWidth = 2;
  for (let k = -0.9; k <= 1.9; k += 0.18) {
    const a = P(k, 0), b = P(k - 1, 1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  // dark stripes in between, so the hatching also reads when the zone colour is close to the grass
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1.5;
  for (let k = -0.81; k <= 1.9; k += 0.18) {
    const a = P(k, 0), b = P(k - 1, 1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.restore();
  poly(ctx, d, 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 3.5);
  poly(ctx, d, 'rgba(0,0,0,0)', c, 1.6);
  const [x, y] = P(0.5, 0.5);
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineJoin = 'round';
  const letter = zone === Overlay.Res ? 'R' : zone === Overlay.Com ? 'C' : 'I';
  ctx.strokeText(letter, x, y + 0.5);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(letter, x, y + 0.5);
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

  box(u0: number, v0: number, u1: number, v1: number, h: number, wall: string, top: string, opts: { z0?: number; windows?: boolean; floors?: boolean; roof?: boolean; key?: number } = {}): void {
    const z0 = opts.z0 ?? 0;
    const ctx = this.ctx;
    const seed = this.seed;
    const tint = this.tint;
    this.elems.push({
      key: opts.key ?? u0 + v0 + (z0 > 0 ? 10 : 0),
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
  /** `rise` = height of the cap as a fraction of its screen half-width: 0.7 for a shallow cap, 1 for a hemisphere */
  dome(u: number, v: number, r: number, z0: number, color: string, rise = 0.7): void {
    const ctx = this.ctx;
    this.elems.push({
      key: u + v + (z0 > 0 ? 10 : 0),
      draw: () => {
        const [cx, cy] = P(u, v, z0);
        const rx = r * TILE_W / 2, ry = r * TILE_H / 2;
        const dh = rx * rise;
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

  house(u0: number, v0: number, u1: number, v1: number, h: number, rh: number, wall: string, roof: string, opts: { door?: boolean; chimney?: boolean } = {}): void {
    const ctx = this.ctx;
    const tint = this.tint;
    this.elems.push({
      key: u0 + v0,
      draw: () => {
        const edge = 'rgba(0,0,0,0.28)';
        const vm = (v0 + v1) / 2;
        poly(ctx, [P(u0, v1), P(u1, v1), P(u1, v1, h), P(u0, v1, h)], shade(wall, 0.9 * tint), edge);
        poly(ctx, [P(u1, v0), P(u1, v1), P(u1, v1, h), P(u1, vm, h + rh), P(u1, v0, h)], shade(wall, 0.7 * tint), edge);
        if (opts.door !== false) {
          // door and window drawn in the plane of the front wall
          const w = u1 - u0;
          poly(ctx, [P(u0 + w * 0.22, v1, 0), P(u0 + w * 0.38, v1, 0), P(u0 + w * 0.38, v1, 6), P(u0 + w * 0.22, v1, 6)], '#34495e');
          const wz = h * 0.45;
          poly(ctx, [P(u0 + w * 0.6, v1, wz), P(u0 + w * 0.8, v1, wz), P(u0 + w * 0.8, v1, wz + 3.5), P(u0 + w * 0.6, v1, wz + 3.5)], '#d9e6f2');
        }
        poly(ctx, [P(u0, v0, h), P(u1, v0, h), P(u1, vm, h + rh), P(u0, vm, h + rh)], shade(roof, 1.08 * tint), edge);
        poly(ctx, [P(u0, vm, h + rh), P(u1, vm, h + rh), P(u1, v1, h), P(u0, v1, h)], shade(roof, 0.84 * tint), edge);
        if (opts.chimney !== false) {
          // chimney near the ridge
          const cu = u0 + (u1 - u0) * 0.72, cw = 0.07, cz = h + rh * 0.55, ct = h + rh + 3;
          poly(ctx, [P(cu, vm + cw, cz), P(cu + cw, vm + cw, cz), P(cu + cw, vm + cw, ct), P(cu, vm + cw, ct)], '#9a9a9a', edge);
          poly(ctx, [P(cu + cw, vm - cw, cz), P(cu + cw, vm + cw, cz), P(cu + cw, vm + cw, ct), P(cu + cw, vm - cw, ct)], '#7a7a7a', edge);
          poly(ctx, [P(cu, vm - cw, ct), P(cu + cw, vm - cw, ct), P(cu + cw, vm + cw, ct), P(cu, vm + cw, ct)], '#b5b5b5', edge);
        }
      },
    });
  }

  chimney(u: number, v: number, h: number, z0 = 0, w = 0.12, smoke = true): void {
    this.cylinder(u + w / 2, v + w / 2, w / 2, h - z0, '#5a5f66', '#2e2e2e', { z0 });
    if (smoke) currentEffects.push({ kind: 'smoke', u: u + w / 2, v: v + w / 2, z: h, color: '' });
  }

  /** steam or smoke rising from (u, v, z) while the building runs */
  steam(u: number, v: number, z: number): void {
    currentEffects.push({ kind: 'smoke', u, v, z, color: '' });
  }

  /** a small light the renderer blinks at (u, v, z) */
  beacon(u: number, v: number, z: number, color = '#ff3b30'): void {
    currentEffects.push({ kind: 'beacon', u, v, z, color });
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
    this.beacon(u, v, z + len);
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
  ['#fff3a0', '#ff5d5d'], ['#ffd9a8', '#ff8c2e'], ['#bfe2ff', '#2f8fdb'], ['#ffc9d9', '#e8467c'],
  ['#bff2d0', '#2fb56b'], ['#dcc8ff', '#8a5be0'], ['#fff8e0', '#ff7a3d'], ['#b8ecf2', '#20a6b8'],
];
const R_APT: Pal[] = [
  ['#fff0c2', '#ff5d5d'], ['#c9f0f4', '#20a6b8'], ['#ff9a86', '#3a4a6b'], ['#ffe9a8', '#ff7a3d'],
  ['#bfe2ff', '#2f6fd0'], ['#f5cfe8', '#9b4fc9'], ['#cdeec2', '#3f9a4a'], ['#fff8e0', '#2f8fdb'],
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

// ---- icon-only sprites ----------------------------------------------------

/** A small yellow bulldozer, for the toolbar: low and long, blade at the front. */
function drawBulldozer(ctx: Ctx): void {
  drawGrass(ctx, 2);
  const s = new Scene(ctx, 11);
  // tracks
  s.box(0.1, 0.26, 0.8, 0.39, 5, '#3a3d42', '#5a5f66');
  s.box(0.1, 0.61, 0.8, 0.74, 5, '#3a3d42', '#5a5f66');
  s.custom(3, (c) => {
    c.strokeStyle = '#8a8f96';
    c.lineWidth = 1;
    for (const v of [0.325, 0.675]) {
      for (let u = 0.16; u < 0.8; u += 0.09) {
        const [x, y] = P(u, v, 2.5);
        c.beginPath(); c.moveTo(x - 1.5, y); c.lineTo(x + 1.5, y); c.stroke();
      }
    }
  });
  // low chassis, engine hood at the front, small cab at the back
  s.box(0.18, 0.32, 0.78, 0.68, 6, '#f2b632', '#e0a020', { z0: 5 });
  s.box(0.5, 0.37, 0.76, 0.63, 5, '#e0a020', '#f2b632', { z0: 11 });
  s.box(0.22, 0.36, 0.48, 0.64, 9, '#f2b632', '#c98a12', { z0: 11 });
  s.custom(50, (c) => {
    poly(c, [P(0.25, 0.64, 13), P(0.45, 0.64, 13), P(0.45, 0.64, 19), P(0.25, 0.64, 19)], '#284260');
    poly(c, [P(0.48, 0.39, 13), P(0.48, 0.61, 13), P(0.48, 0.61, 19), P(0.48, 0.39, 19)], '#1d3248');
  });
  s.cylinder(0.56, 0.42, 0.02, 6, '#333', '#222', { z0: 16 });
  // blade, slightly curved look with a lighter top edge, and its two arms
  s.box(0.82, 0.14, 0.9, 0.86, 9, '#9aa0a6', '#d0d4d8');
  s.custom(40, (c) => {
    c.strokeStyle = '#7a7f86';
    c.lineWidth = 2;
    for (const v of [0.3, 0.7]) {
      const [x0, y0] = P(0.72, v, 9);
      const [x1, y1] = P(0.84, v, 6);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
  });
  s.render();
}

// ---- structures -----------------------------------------------------------

const STRUCT_LOT: Record<string, string> = {
  power: '#8a8d8a', water: '#8fa39a', service: '#9b9ea3', park: '#8ccf6a', transport: '#8f9296', reward: '#b5b0a8',
};

/** `frame` only matters for animated structures (the wind turbine rotor, 6 frames over a third of a turn). */
/**
 * One tile of park. Neighbouring park tiles (`mask`: N=1 E=2 S=4 W=8) are
 * joined by paths and the hedge only runs along the open sides, so a cluster
 * of small parks reads as a single garden with a pond, a playground, benches.
 */
function parkTile(s: Scene, mask: number, variant: number, frame = 0): void {
  const path = '#d9d2bd', hedge = '#2e7d3a', hedgeTop = '#43a047';
  s.custom(-2, (c) => {
    poly(c, diamond(0.02), 'rgba(180,235,130,0.35)');
    if (mask & 1) poly(c, [P(0.42, 0), P(0.58, 0), P(0.58, 0.5), P(0.42, 0.5)], path);
    if (mask & 4) poly(c, [P(0.42, 0.5), P(0.58, 0.5), P(0.58, 1), P(0.42, 1)], path);
    if (mask & 8) poly(c, [P(0, 0.42), P(0.5, 0.42), P(0.5, 0.58), P(0, 0.58)], path);
    if (mask & 2) poly(c, [P(0.5, 0.42), P(1, 0.42), P(1, 0.58), P(0.5, 0.58)], path);
    const [x, y] = P(0.5, 0.5);
    c.fillStyle = path;
    c.beginPath();
    c.ellipse(x, y, mask ? 7 : 9, mask ? 3.5 : 4.5, 0, 0, Math.PI * 2);
    c.fill();
  });
  const sides: [number, [number, number, number, number]][] = [
    [1, [0.06, 0.03, 0.94, 0.1]], [2, [0.9, 0.06, 0.97, 0.94]], [4, [0.06, 0.9, 0.94, 0.97]], [8, [0.03, 0.06, 0.1, 0.94]],
  ];
  for (const [bit, [u0, v0, u1, v1]] of sides) if (!(mask & bit)) s.box(u0, v0, u1, v1, 3, hedge, hedgeTop);
  switch (variant & 3) {
    case 0:
      s.tree(0.25, 0.27, 5);
      s.tree(0.75, 0.73, 5);
      s.custom(0.9, (c) => {
        const [x, y] = P(0.74, 0.27);
        c.fillStyle = '#7a5230';
        c.fillRect(x - 4, y - 3, 8, 2);
      });
      break;
    case 1:
      // pond with a light rim
      s.disc(0.26, 0.74, 0.17, '#cfe3d0', 0, -1);
      s.disc(0.26, 0.74, 0.14, '#3b78b5', 0, -1);
      s.tree(0.74, 0.26, 5);
      break;
    case 2:
      // playground: a slide and a swing
      s.box(0.17, 0.17, 0.29, 0.29, 7, '#f2c14e', '#e0a93a');
      s.custom(0.3, (c) => poly(c, [P(0.29, 0.19, 7), P(0.29, 0.27, 7), P(0.4, 0.27, 0), P(0.4, 0.19, 0)], '#e04848'));
      s.box(0.7, 0.72, 0.72, 0.74, 9, '#4f6d8f', '#4f6d8f');
      s.box(0.84, 0.72, 0.86, 0.74, 9, '#4f6d8f', '#4f6d8f');
      s.box(0.7, 0.725, 0.86, 0.735, 1, '#7a5230', '#7a5230', { z0: 9 });
      // the seat swings back and forth
      const sw = [-0.035, 0, 0.035][frame % 3];
      s.box(0.76 + sw, 0.715, 0.8 + sw, 0.745, 1.2, '#e04848', '#e04848', { z0: 3 + Math.abs(sw) * 40 });
      s.tree(0.74, 0.26, 4);
      break;
    default:
      // flower bed
      s.disc(0.73, 0.73, 0.15, '#b23a5a', 0, -1);
      s.custom(0.2, (c) => {
        for (const [du, dv, col] of [[-0.06, -0.04, '#ffd23f'], [0.05, -0.05, '#ff8fb1'], [0.0, 0.06, '#ffffff'], [-0.05, 0.05, '#ffd23f']] as [number, number, string][]) {
          const [x, y] = P(0.73 + du, 0.73 + dv);
          c.fillStyle = col;
          c.beginPath();
          c.arc(x, y, 1.2, 0, Math.PI * 2);
          c.fill();
        }
      });
      s.tree(0.27, 0.27, 5);
      break;
  }
}

/** Round wheels seen on the visible side of a parked vehicle: tyre and hub, at (u, v) on the ground. */
function wheels(c: Ctx, at: [number, number][], r: number): void {
  for (const [u, v] of at) {
    const [x, y] = P(u, v, r * 0.8);
    c.fillStyle = '#1d1f23';
    c.beginPath();
    c.ellipse(x, y, r, r * 0.9, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#9aa0a6';
    c.beginPath();
    c.ellipse(x, y, r * 0.4, r * 0.36, 0, 0, Math.PI * 2);
    c.fill();
  }
}

function drawStruct(ctx: Ctx, type: StructType, frame = 0, variant = 0, mask = 0): void {
  // the station turns to run along the track it serves
  if (type === 'station' && frame === 1) SWAP = true;
  const def = STRUCTS[type];
  const n = def.size;
  // a turbine at sea stands on open water, on a pile
  const offshore = type === 'wind' && variant === 1;
  if (offshore) drawWater(ctx, 0, 2, 0, 0);
  else {
    for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) drawGrass(ctx, (tx * 3 + ty) & 3, tx, ty);
    poly(ctx, diamond(0.04, 0, 0, n), STRUCT_LOT[def.category]);
  }
  const s = new Scene(ctx, hash2(n, type.length, 5));
  switch (type) {
    case 'wind':
      // tapered mast, nacelle, and a three-blade rotor drawn as tapered blades
      if (offshore) s.cylinder(0.5, 0.5, 0.2, 3, '#e0b23a', '#d8dcdf');
      else s.disc(0.5, 0.5, 0.16, '#b9bec6', 0, -1);
      s.cylinder(0.5, 0.5, 0.075, 40, '#e8ebee', '#d3d7dc', { rTop: 0.045 });
      s.box(0.45, 0.47, 0.58, 0.53, 4, '#cfd4da', '#e6e9ec', { z0: 40 });
      s.custom(60, (c) => {
        const [x, y] = P(0.5, 0.5, 42);
        c.strokeStyle = 'rgba(40,50,70,0.5)';
        c.lineWidth = 0.6;
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI / 2 + k * (Math.PI * 2 / 3) + 0.35 + (frame % 6) * (Math.PI * 2 / 3) / 6;
          const L = 17;
          const tx = x + Math.cos(a) * L, ty = y + Math.sin(a) * L;
          const px = -Math.sin(a), py = Math.cos(a);
          c.beginPath();
          c.moveTo(x + px * 1.9, y + py * 1.9);
          c.lineTo(tx + px * 0.5, ty + py * 0.5);
          c.lineTo(tx - px * 0.5, ty - py * 0.5);
          c.lineTo(x - px * 1.9, y - py * 1.9);
          c.closePath();
          c.fillStyle = '#f7f8fa';
          c.fill();
          c.stroke();
        }
        c.fillStyle = '#d3d7dc';
        c.beginPath();
        c.arc(x, y, 2.6, 0, Math.PI * 2);
        c.fill();
        c.stroke();
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
    case 'fusion':
      // a glowing spherical containment two and a half tiles wide on a plinth, four radial injectors, two cryogenic
      // towers, a glass hall in front. Depth order is set by hand: injectors behind the sphere first, those in front after the glow.
      s.box(0.1, 0.1, 0.6, 0.7, 10, '#8a9299', '#6c7178', { windows: true });
      s.cylinder(3.6, 0.5, 0.22, 40, '#e8ebee', '#d3d7dc');
      s.cylinder(3.6, 1.05, 0.22, 40, '#e8ebee', '#d3d7dc');
      s.box(1.7, 0.05, 2.2, 0.45, 9, '#8a9299', '#6c7178', { key: 0.5 });
      s.box(0.05, 1.6, 0.55, 2.1, 9, '#8a9299', '#6c7178', { key: 0.5 });
      s.cylinder(1.95, 1.85, 1.35, 6, '#3f4b5c', '#4f5d70');
      s.cylinder(1.95, 1.85, 1.25, 8, '#5a6d8c', '#5a6d8c', { z0: 6 });
      s.dome(1.95, 1.85, 1.25, 14, '#6b7f9e', 1);
      s.custom(30, (c) => {
        // the plasma glows through a window band around the sphere's equator: only the front arc shows
        const [x, y] = P(1.95, 1.85, 30);
        const rx = 1.146 * TILE_W / 2, ry = 1.146 * TILE_H / 2;
        for (const [w, a] of [[8, 0.22], [3, 0.95]] as [number, number][]) {
          c.strokeStyle = `rgba(111,214,255,${a})`;
          c.lineWidth = w;
          c.beginPath();
          c.ellipse(x, y, rx, ry, 0, 0, Math.PI);
          c.stroke();
        }
      });
      s.beacon(1.95, 1.85, 56, '#4fc3ff');
      s.box(3.35, 1.6, 3.85, 2.1, 9, '#8a9299', '#6c7178', { key: 35 });
      s.box(1.7, 3.25, 2.2, 3.5, 9, '#8a9299', '#6c7178', { key: 35 });
      s.box(0.2, 3.55, 3.8, 3.95, 14, '#9fb3c8', '#7f95ab', { windows: true, key: 50 });
      break;
    case 'nuclear':
      // transformer yard at the back, containment dome two tiles wide on a plinth, hyperbolic cooling tower with live
      // steam, vent stack, auxiliary block and turbine hall along the front. Front elements carry explicit keys, and the
      // yard behind the dome low ones.
      s.box(0.1, 0.1, 1.4, 0.6, 1.5, '#7d848c', '#9aa0a6', { key: 0.1 });
      for (const u of [0.3, 0.7, 1.1]) s.box(u, 0.2, u + 0.22, 0.45, 6, '#6c7178', '#8a9299', { z0: 1.5, key: 0.2 });
      s.cylinder(0.25, 0.52, 0.04, 24, '#9aa0a6', '#c0c5ca');
      s.cylinder(1.3, 0.52, 0.04, 24, '#9aa0a6', '#c0c5ca');
      s.cylinder(1.25, 1.9, 1.0, 4, '#a9aeb4', '#c2c6cb');
      s.cylinder(1.25, 1.9, 0.9, 26, '#cfd3d8', '#b9bec4', { z0: 4 });
      s.dome(1.25, 1.9, 0.9, 30, '#e3e6e9', 1);
      s.beacon(1.25, 1.9, 60, '#ff3b30');
      s.cylinder(3.0, 0.95, 0.9, 50, '#d8dbdf', '#c6cacf', { rTop: 0.58 });
      s.cylinder(3.0, 0.95, 0.58, 16, '#dfe2e6', '#6f767e', { z0: 50, rTop: 0.68 });
      s.cylinder(3.0, 0.95, 0.7, 2, '#f2f4f6', '#6f767e', { z0: 66 });
      s.steam(3.0, 0.95, 68);
      s.cylinder(0.3, 2.95, 0.09, 64, '#e8ebee', '#d3d7dc');
      s.beacon(0.3, 2.95, 66, '#ff3b30');
      s.box(2.3, 2.05, 3.8, 2.75, 12, '#aeb6c0', '#8e97a2', { windows: true, key: 45 });
      s.box(0.5, 3.1, 3.85, 3.9, 16, '#c4c9ce', '#a8adb2', { windows: true, floors: true, key: 50 });
      s.box(0.7, 3.3, 3.65, 3.7, 4, '#b3b8be', '#9ea3a9', { z0: 16, key: 51 });
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
      // legs well inside the tank's footprint, and a cross brace between them
      for (const [u, v] of [[0.7, 0.7], [1.3, 0.7], [0.7, 1.3], [1.3, 1.3]]) {
        s.cylinder(u, v, 0.08, 36, '#7a7f86', '#555');
      }
      s.custom(5, (c) => {
        c.strokeStyle = '#6a6f76';
        c.lineWidth = 1.5;
        const pairs: [number, number, number, number][] = [[0.7, 1.3, 1.3, 1.3], [1.3, 0.7, 1.3, 1.3]];
        for (const [u0, v0, u1, v1] of pairs) {
          const [ax, ay] = P(u0, v0, 6), [bx, by] = P(u1, v1, 24);
          const [cx2, cy2] = P(u0, v0, 24), [dx, dy] = P(u1, v1, 6);
          c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.moveTo(cx2, cy2); c.lineTo(dx, dy); c.stroke();
        }
      });
      s.cylinder(1.0, 1.0, 0.62, 22, '#8fc0ee', '#a9d0f5', { z0: 34 });
      s.cylinder(1.0, 1.0, 0.62, 10, '#5c8fc4', '#5c8fc4', { z0: 56, rTop: 0.06 });
      break;
    case 'police':
      // 2x2: main block, lower annex, mast with the blue light, a patrol car on the pad
      s.custom(-2, (c) => poly(c, [P(0.2, 1.55), P(1.85, 1.55), P(1.85, 2), P(0.2, 2)], '#b7bcc4'));
      s.box(0.2, 0.2, 1.8, 1.05, 22, '#8c9bb5', '#3e5a8a', { windows: true, floors: true });
      s.box(0.35, 1.05, 1.45, 1.55, 10, '#a9b6cc', '#6f84a8', { windows: true });
      s.custom(50, (c) => {
        const [x, y] = P(1.72, 1.85), [tx, ty] = P(1.72, 1.85, 24);
        c.strokeStyle = '#ddd';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(tx, ty);
        c.stroke();
        poly(c, [[tx, ty], [tx + 8, ty + 2], [tx, ty + 5]], '#2f5fc4');
      });
      s.beacon(1.72, 1.85, 25, '#3d7fe0');
      // patrol car, nose toward the viewer: white body with a blue band, glazed cabin, light bar
      s.box(0.4, 1.6, 0.74, 1.98, 3.4, '#f4f6f8', '#e2e6ea', { z0: 1.6 });
      s.box(0.44, 1.67, 0.7, 1.9, 3.2, '#f4f6f8', '#dfe4ea', { z0: 5 });
      s.custom(20, (c) => {
        poly(c, [P(0.74, 1.62, 2.6), P(0.74, 1.96, 2.6), P(0.74, 1.96, 3.7), P(0.74, 1.62, 3.7)], '#2f5fc4');
        poly(c, [P(0.7, 1.7, 5.6), P(0.7, 1.87, 5.6), P(0.7, 1.87, 7.9), P(0.7, 1.7, 7.9)], '#1f2a44');
        poly(c, [P(0.46, 1.9, 5.6), P(0.68, 1.9, 5.6), P(0.68, 1.9, 7.9), P(0.46, 1.9, 7.9)], '#a9dcff');
        poly(c, [P(0.42, 1.98, 2.6), P(0.48, 1.98, 2.6), P(0.48, 1.98, 3.6), P(0.42, 1.98, 3.6)], '#fff6cc');
        poly(c, [P(0.66, 1.98, 2.6), P(0.72, 1.98, 2.6), P(0.72, 1.98, 3.6), P(0.66, 1.98, 3.6)], '#fff6cc');
      });
      s.box(0.5, 1.755, 0.57, 1.805, 1.2, '#3d7fe0', '#5fa0ff', { z0: 8.2 });
      s.box(0.57, 1.755, 0.64, 1.805, 1.2, '#e04848', '#ff6b57', { z0: 8.2 });
      s.beacon(0.535, 1.78, 9.8, '#3d7fe0');
      s.custom(21, (c) => wheels(c, [[0.74, 1.68], [0.74, 1.92]], 1.7));
      break;
    case 'fire':
      // 2x2: apron, two-storey brick block, garage wing with two bays (one open), hose tower, truck, flag
      s.custom(-2, (c) => poly(c, [P(0.15, 1.5), P(1.85, 1.5), P(1.85, 2), P(0.15, 2)], '#b7bcc4'));
      s.box(0.15, 0.2, 1.4, 0.95, 20, '#c9524a', '#8f2f2a', { windows: true, floors: true });
      s.box(0.15, 0.95, 1.4, 1.5, 12, '#d6605a', '#9a3a34');
      s.box(0.15, 0.95, 1.4, 1.5, 1.5, '#f0e6d8', '#f0e6d8', { z0: 12 });
      s.custom(2, (c) => {
        for (let k = 0; k < 2; k++) {
          const u0 = 0.27 + k * 0.58, u1 = u0 + 0.44;
          poly(c, [P(u0 - 0.03, 1.5, 0), P(u1 + 0.03, 1.5, 0), P(u1 + 0.03, 1.5, 10.5), P(u0 - 0.03, 1.5, 10.5)], '#f0e6d8');
          if (k === 0) {
            poly(c, [P(u0, 1.5, 0), P(u1, 1.5, 0), P(u1, 1.5, 9.5), P(u0, 1.5, 9.5)], '#2a2f3a');
            poly(c, [P(u0, 1.5, 7.8), P(u1, 1.5, 7.8), P(u1, 1.5, 9.5), P(u0, 1.5, 9.5)], '#c9ced6');
            continue;
          }
          poly(c, [P(u0, 1.5, 0), P(u1, 1.5, 0), P(u1, 1.5, 9.5), P(u0, 1.5, 9.5)], '#c9ced6');
          c.strokeStyle = 'rgba(0,0,0,0.25)';
          c.lineWidth = 0.8;
          for (const z of [2.5, 5, 7.5]) {
            const [ax, ay] = P(u0, 1.5, z), [bx, by] = P(u1, 1.5, z);
            c.beginPath();
            c.moveTo(ax, ay);
            c.lineTo(bx, by);
            c.stroke();
          }
        }
      });
      s.house(1.48, 0.25, 1.85, 0.62, 34, 7, '#b34a43', '#4a4f57', { door: false, chimney: false });
      s.custom(1.8, (c) => {
        poly(c, [P(1.58, 0.62, 0), P(1.74, 0.62, 0), P(1.74, 0.62, 7), P(1.58, 0.62, 7)], '#34495e');
        for (const z of [11, 20, 28]) poly(c, [P(1.85, 0.36, z), P(1.85, 0.51, z), P(1.85, 0.51, z + 4), P(1.85, 0.36, z + 4)], '#d9e6f2');
      });
      s.beacon(1.665, 0.435, 43, '#ff3b30');
      // the truck pulls out of the first bay, nose toward the viewer
      s.box(0.34, 1.51, 0.63, 1.78, 7, '#d63c3c', '#b83232', { z0: 2 });
      s.box(0.34, 1.78, 0.63, 1.98, 8, '#d63c3c', '#b83232', { z0: 2 });
      s.custom(20, (c) => {
        poly(c, [P(0.63, 1.53, 4.3), P(0.63, 1.96, 4.3), P(0.63, 1.96, 5.5), P(0.63, 1.53, 5.5)], '#f4f4f4');
        poly(c, [P(0.63, 1.81, 6.2), P(0.63, 1.95, 6.2), P(0.63, 1.95, 9), P(0.63, 1.81, 9)], '#a9dcff');
        poly(c, [P(0.37, 1.98, 6.2), P(0.6, 1.98, 6.2), P(0.6, 1.98, 9.2), P(0.37, 1.98, 9.2)], '#a9dcff');
        poly(c, [P(0.36, 1.98, 3), P(0.42, 1.98, 3), P(0.42, 1.98, 4.2), P(0.36, 1.98, 4.2)], '#fff6cc');
        poly(c, [P(0.55, 1.98, 3), P(0.61, 1.98, 3), P(0.61, 1.98, 4.2), P(0.55, 1.98, 4.2)], '#fff6cc');
        c.strokeStyle = '#c9ced6';
        c.lineWidth = 1;
        for (const u of [0.41, 0.56]) {
          const [ax, ay] = P(u, 1.55, 9.6), [bx, by] = P(u, 1.75, 9.6);
          c.beginPath();
          c.moveTo(ax, ay);
          c.lineTo(bx, by);
          c.stroke();
        }
        for (let v = 1.58; v < 1.75; v += 0.06) {
          const [ax, ay] = P(0.41, v, 9.6), [bx, by] = P(0.56, v, 9.6);
          c.beginPath();
          c.moveTo(ax, ay);
          c.lineTo(bx, by);
          c.stroke();
        }
      });
      s.box(0.43, 1.85, 0.54, 1.93, 1.5, '#3d7fe0', '#5fa0ff', { z0: 10 });
      s.beacon(0.485, 1.89, 11.5, '#3d7fe0');
      s.custom(21, (c) => wheels(c, [[0.63, 1.6], [0.63, 1.9]], 1.9));
      s.custom(50, (c) => {
        const [x0, y0] = P(1.72, 1.82), [x1, y1] = P(1.72, 1.82, 22);
        c.strokeStyle = '#d8dde3';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
        poly(c, [[x1, y1], [x1 + 8, y1 + 2], [x1, y1 + 5]], '#e04848');
      });
      break;
    case 'school':
      // schoolyard with a painted court, main block with a porch, low wing, hoop, flag, trees
      s.custom(-2, (c) => {
        poly(c, [P(1.45, 1.45), P(2.85, 1.45), P(2.85, 2.85), P(1.45, 2.85)], '#c9c2b5');
        c.strokeStyle = 'rgba(255,255,255,0.7)';
        c.lineWidth = 1;
        const [cx, cy] = P(2.15, 2.15);
        c.beginPath();
        c.ellipse(cx, cy, 11, 5.5, 0, 0, Math.PI * 2);
        c.stroke();
        const a = P(1.6, 2.15), b = P(2.7, 2.15);
        c.beginPath();
        c.moveTo(a[0], a[1]);
        c.lineTo(b[0], b[1]);
        c.stroke();
      });
      s.box(0.3, 0.3, 2.7, 1.3, 16, '#f4e3a1', '#e07b39', { windows: true, floors: true });
      s.box(0.3, 1.3, 1.1, 2.7, 12, '#f7ecc0', '#e07b39', { windows: true });
      s.box(1.3, 1.3, 1.9, 1.5, 9, '#f4e3a1', '#c65f28');
      s.custom(3, (c) => {
        poly(c, [P(1.5, 1.5, 0), P(1.7, 1.5, 0), P(1.7, 1.5, 7), P(1.5, 1.5, 7)], '#34495e');
        const [x, y] = P(1.5, 0.3, 16);
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(x, y - 4, 2.6, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#34495e';
        c.lineWidth = 0.8;
        c.beginPath();
        c.moveTo(x, y - 4);
        c.lineTo(x, y - 6);
        c.moveTo(x, y - 4);
        c.lineTo(x + 1.5, y - 4);
        c.stroke();
      });
      s.box(2.6, 2.6, 2.66, 2.66, 9, '#7a7f86', '#7a7f86');
      s.custom(30, (c) => {
        poly(c, [P(2.5, 2.63, 6), P(2.74, 2.63, 6), P(2.74, 2.63, 10), P(2.5, 2.63, 10)], '#f4f4f4');
        const [hx, hy] = P(2.62, 2.66, 7);
        c.strokeStyle = '#e04848';
        c.lineWidth = 1;
        c.beginPath();
        c.ellipse(hx, hy, 2.2, 1.1, 0, 0, Math.PI * 2);
        c.stroke();
      });
      s.custom(50, (c) => {
        const [x0, y0] = P(1.35, 2.75), [x1, y1] = P(1.35, 2.75, 22);
        c.strokeStyle = '#d8dde3';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
        poly(c, [[x1, y1], [x1 + 8, y1 + 2], [x1, y1 + 5]], '#2f80b9');
      });
      s.tree(0.55, 2.85, 4);
      s.tree(2.85, 0.5, 4);
      break;
    case 'hospital':
      s.box(0.3, 0.3, 2.7, 2.7, 30, '#eef0f2', '#d8dcdf', { windows: true });
      s.custom(50, (c) => {
        poly(c, [P(1.2, 1.4, 30), P(1.8, 1.4, 30), P(1.8, 1.6, 30), P(1.2, 1.6, 30)], '#d63b3b');
        poly(c, [P(1.4, 1.2, 30), P(1.6, 1.2, 30), P(1.6, 1.8, 30), P(1.4, 1.8, 30)], '#d63b3b');
      });
      break;
    case 'station':
      // platform with a safety line and a bench, pitched-roof building with a clock, canopy on posts
      s.box(0.1, 0.1, 1.9, 0.9, 3, '#b8b8b8', '#cfcfcf');
      s.custom(0.5, (c) => poly(c, [P(0.12, 0.14, 3), P(1.88, 0.14, 3), P(1.88, 0.2, 3), P(0.12, 0.2, 3)], '#f2c14e'));
      s.box(0.55, 0.7, 0.9, 0.78, 2.2, '#2e7d3a', '#43a047', { z0: 3 });
      s.box(1.25, 0.72, 1.31, 0.78, 7, '#3d4654', '#3d4654', { z0: 3 });
      s.custom(4, (c) => poly(c, [P(1.18, 0.75, 7.5), P(1.4, 0.75, 7.5), P(1.4, 0.75, 10), P(1.18, 0.75, 10)], '#2f5fc4'));
      for (const u of [0.25, 1.0, 1.75]) s.box(u - 0.04, 0.46, u + 0.04, 0.54, 12, '#7a7a7a', '#8a8a8a', { z0: 3 });
      s.box(0.15, 0.15, 1.85, 0.85, 1.5, '#8d8d8d', '#a5a5a5', { z0: 15, key: 20 });
      s.house(0.2, 1.1, 1.8, 1.9, 14, 6, '#e8e0d0', '#c62828', { chimney: false });
      s.custom(30, (c) => {
        const [x, y] = P(1.0, 1.9, 10);
        c.fillStyle = '#ffffff';
        c.strokeStyle = '#34495e';
        c.lineWidth = 0.8;
        c.beginPath();
        c.arc(x, y, 2.6, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x, y - 2);
        c.moveTo(x, y);
        c.lineTo(x + 1.4, y + 0.6);
        c.stroke();
      });
      break;
    case 'bus':
      // depot shed with an open front and a ridge roof, two buses, a fuel pump and a stop sign
      s.custom(-2, (c) => poly(c, [P(0.1, 1.4), P(1.9, 1.4), P(1.9, 2), P(0.1, 2)], '#b7bcc4'));
      s.box(0.1, 0.1, 1.9, 1.4, 14, '#9a9a9a', '#7a7a7a');
      s.box(0.1, 0.55, 1.9, 0.95, 3, '#7a7a7a', '#8a8f96', { z0: 14 });
      s.custom(2, (c) => {
        poly(c, [P(0.35, 1.4, 0), P(1.65, 1.4, 0), P(1.65, 1.4, 11), P(0.35, 1.4, 11)], '#2a2f3a');
        poly(c, [P(0.35, 1.4, 9.5), P(1.65, 1.4, 9.5), P(1.65, 1.4, 11), P(0.35, 1.4, 11)], '#c9ced6');
        poly(c, [P(0.1, 1.4, 11.5), P(1.9, 1.4, 11.5), P(1.9, 1.4, 13), P(0.1, 1.4, 13)], '#f2c14e');
      });
      // bus on the apron, along u, nose to the right
      s.box(0.2, 1.5, 1.0, 1.85, 8, '#f2c14e', '#d9a93a', { z0: 1.5 });
      s.custom(20, (c) => {
        poly(c, [P(0.25, 1.85, 4), P(0.95, 1.85, 4), P(0.95, 1.85, 7), P(0.25, 1.85, 7)], '#a9dcff');
        poly(c, [P(1.0, 1.55, 4), P(1.0, 1.8, 4), P(1.0, 1.8, 7.5), P(1.0, 1.55, 7.5)], '#a9dcff');
        poly(c, [P(1.0, 1.53, 2.2), P(1.0, 1.6, 2.2), P(1.0, 1.6, 3.2), P(1.0, 1.53, 3.2)], '#fff6cc');
        poly(c, [P(1.0, 1.75, 2.2), P(1.0, 1.82, 2.2), P(1.0, 1.82, 3.2), P(1.0, 1.75, 3.2)], '#fff6cc');
        wheels(c, [[0.37, 1.85], [0.85, 1.85]], 1.6);
      });
      // second bus leaving the depot, along v, nose toward the viewer
      s.box(1.2, 1.42, 1.55, 1.97, 8, '#f2c14e', '#d9a93a', { z0: 1.5 });
      s.custom(21, (c) => {
        poly(c, [P(1.55, 1.47, 4), P(1.55, 1.92, 4), P(1.55, 1.92, 7), P(1.55, 1.47, 7)], '#a9dcff');
        poly(c, [P(1.23, 1.97, 4), P(1.52, 1.97, 4), P(1.52, 1.97, 7.5), P(1.23, 1.97, 7.5)], '#a9dcff');
        poly(c, [P(1.24, 1.97, 2.2), P(1.3, 1.97, 2.2), P(1.3, 1.97, 3.2), P(1.24, 1.97, 3.2)], '#fff6cc');
        poly(c, [P(1.45, 1.97, 2.2), P(1.51, 1.97, 2.2), P(1.51, 1.97, 3.2), P(1.45, 1.97, 3.2)], '#fff6cc');
        wheels(c, [[1.55, 1.52], [1.55, 1.88]], 1.6);
      });
      s.box(1.72, 1.45, 1.84, 1.55, 7, '#e04848', '#b83232');
      s.custom(30, (c) => {
        const [x0, y0] = P(1.75, 1.9), [x1, y1] = P(1.75, 1.9, 14);
        c.strokeStyle = '#d8dde3';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
        c.fillStyle = '#2f5fc4';
        c.beginPath();
        c.arc(x1, y1 - 2, 2.6, 0, Math.PI * 2);
        c.fill();
      });
      break;
    case 'port': {
      // the quay side faces the water: `frame` is the side (0 = +v, 1 = +u, 2 = -v, 3 = -u).
      // (a, b): a runs along the quay, b goes from the back (0) to the water (3)
      const side = frame % 4;
      const R = (a0: number, b0: number, a1: number, b1: number): [number, number, number, number] =>
        side === 0 ? [a0, b0, a1, b1] : side === 1 ? [b0, a0, b1, a1] : side === 2 ? [a0, 3 - b1, a1, 3 - b0] : [3 - b1, a0, 3 - b0, a1];
      const pt = (a: number, b: number, z = 0): Pt2 =>
        side === 0 ? P(a, b, z) : side === 1 ? P(b, a, z) : side === 2 ? P(a, 3 - b, z) : P(3 - b, a, z);
      s.box(0.05, 0.05, 2.95, 2.95, 2, '#8f959c', '#b5bac0');
      s.box(...R(0.25, 0.25, 1.75, 1.35), 15, '#d5dbe2', '#5d7a92', { z0: 2, windows: true });
      s.box(...R(0.25, 0.25, 1.75, 0.35), 3, '#5d7a92', '#4b6578', { z0: 17 });
      s.box(...R(0.25, 1.25, 1.75, 1.35), 3, '#5d7a92', '#4b6578', { z0: 17 });
      s.custom(10, (c) => {
        c.strokeStyle = 'rgba(0,0,0,0.18)';
        c.lineWidth = 1;
        for (let k = 1; k < 6; k++) {
          const [ax, ay] = pt(0.25 + k * 0.25, 0.25, 17), [bx, by] = pt(0.25 + k * 0.25, 1.35, 17);
          c.beginPath();
          c.moveTo(ax, ay);
          c.lineTo(bx, by);
          c.stroke();
        }
      });
      {
        const cols = ['#e0603a', '#3a6fd8', '#3fa845', '#f2c14e', '#8c5bd8', '#20a6b8'];
        let k = 0;
        for (const a of [1.95, 2.3, 2.65]) for (const b of [0.3, 0.75, 1.2]) {
          s.box(...R(a, b, a + 0.28, b + 0.38), 7, cols[k % 6], shade(cols[k % 6], 0.85), { z0: 2 });
          if (k % 3 !== 1) s.box(...R(a, b, a + 0.28, b + 0.38), 7, cols[(k + 2) % 6], shade(cols[(k + 2) % 6], 0.85), { z0: 9 });
          k++;
        }
      }
      s.box(...R(0.55, 2.3, 0.69, 2.44), 38, '#c9503a', '#a33d2b', { z0: 2 });
      s.box(...R(1.85, 2.3, 1.99, 2.44), 38, '#c9503a', '#a33d2b', { z0: 2 });
      s.box(...R(0.2, 2.32, 2.85, 2.42), 4, '#c9503a', '#d9634c', { z0: 40 });
      s.custom(100, (c) => {
        const [tx, ty] = pt(2.55, 2.37, 40);
        c.fillStyle = '#5a5f66';
        c.fillRect(tx - 3, ty - 1, 6, 3);
        c.strokeStyle = '#333';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(tx, ty + 2);
        c.lineTo(tx, ty + 18);
        c.stroke();
        c.fillStyle = '#f2c14e';
        c.fillRect(tx - 4, ty + 18, 8, 5);
        const [lx, ly] = pt(0.62, 2.37, 42);
        c.fillStyle = '#ff3b30';
        c.beginPath();
        c.arc(lx, ly - 4, 1.2, 0, Math.PI * 2);
        c.fill();
      });
      for (const a of [0.4, 1.2, 2.0, 2.7]) {
        const [cu, cv] = R(a, 2.82, a, 2.82);
        s.cylinder(cu, cv, 0.05, 3, '#3d4654', '#5a6270', { z0: 2 });
      }
      s.box(...R(1.1, 1.75, 1.7, 2.05), 6, '#f2c14e', '#d9a520', { z0: 2 });
      break;
    }
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
      // paved square, stepped plinth, white column and a golden figure
      s.disc(0.5, 0.5, 0.46, '#d3d7dd', 0, -1);
      for (const [u, v] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]] as [number, number][]) s.disc(u, v, 0.09, '#3fa845', 0, -1);
      s.box(0.28, 0.28, 0.72, 0.72, 5, '#c4c9d1', '#e6e9ed');
      s.box(0.36, 0.36, 0.64, 0.64, 5, '#b7bcc5', '#e0e3e8', { z0: 5 });
      s.cylinder(0.5, 0.5, 0.075, 20, '#eceef1', '#ffffff', { z0: 10 });
      s.cylinder(0.5, 0.5, 0.12, 2.5, '#d6d9de', '#f4f5f7', { z0: 30 });
      s.cylinder(0.5, 0.5, 0.05, 9, '#dba82e', '#f2c94c', { z0: 32.5 });
      s.box(0.5, 0.46, 0.53, 0.5, 7, '#dba82e', '#f2c94c', { z0: 38 });
      s.custom(60, (c) => {
        const [x, y] = P(0.5, 0.5, 44);
        c.fillStyle = '#f2c94c';
        c.strokeStyle = 'rgba(0,0,0,0.35)';
        c.lineWidth = 0.8;
        c.beginPath();
        c.arc(x, y, 2.6, 0, Math.PI * 2);
        c.fill();
        c.stroke();
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
      parkTile(s, 0, 0);
      break;
    case 'bigpark': {
      // 2x2, four layouts picked by position: fountain square, pond and gazebo, playground, flower garden
      const path = '#d9d2bd', water = '#3b78b5', rim = '#cfe3d0';
      const jet = [10, 14, 12][frame % 3];
      s.custom(-3, (c) => poly(c, diamond(0.03, 0, 0, 2), 'rgba(180,235,130,0.35)'));
      // iron railings (unlike the small park's hedge); a side shared with another big park (mask N=1 E=2 S=4 W=8) stays open
      const fence = (u0: number, v0: number, u1: number, v1: number, key: number) => s.custom(key, (c) => {
        const H = 5, along = u1 - u0 > v1 - v0 ? 'u' : 'v';
        c.strokeStyle = '#3d4654';
        c.lineWidth = 1;
        const a0 = P(u0, v0, H * 0.45), a1 = P(u1, v1, H * 0.45), b0 = P(u0, v0, H), b1 = P(u1, v1, H);
        c.beginPath();
        c.moveTo(a0[0], a0[1]); c.lineTo(a1[0], a1[1]);
        c.moveTo(b0[0], b0[1]); c.lineTo(b1[0], b1[1]);
        c.stroke();
        c.lineWidth = 0.8;
        const n = Math.round((along === 'u' ? u1 - u0 : v1 - v0) / 0.12);
        for (let k = 0; k <= n; k++) {
          const u = along === 'u' ? u0 + (u1 - u0) * k / n : u0, v = along === 'v' ? v0 + (v1 - v0) * k / n : v0;
          const p0 = P(u, v, 0), p1 = P(u, v, H + (k % 4 === 0 ? 1.5 : 0));
          c.lineWidth = k % 4 === 0 ? 1.4 : 0.8;
          c.beginPath();
          c.moveTo(p0[0], p0[1]);
          c.lineTo(p1[0], p1[1]);
          c.stroke();
        }
      });
      if (!(mask & 1)) fence(0.05, 0.05, 1.95, 0.05, -1.5);
      if (!(mask & 8)) fence(0.05, 0.05, 0.05, 1.95, -1.5);
      if (!(mask & 2)) fence(1.95, 0.05, 1.95, 1.95, 60);
      if (!(mask & 4)) fence(0.05, 1.95, 1.95, 1.95, 60);
      const band = (u0: number, v0: number, u1: number, v1: number) => s.custom(-2, (c) => poly(c, [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], path));
      const bench = (u: number, v: number, along: 'u' | 'v') => {
        if (along === 'u') s.box(u - 0.09, v - 0.03, u + 0.09, v + 0.03, 2, '#7a5230', '#9a6a3a');
        else s.box(u - 0.03, v - 0.09, u + 0.03, v + 0.09, 2, '#7a5230', '#9a6a3a');
      };
      const fountain = (u: number, v: number) => {
        s.cylinder(u, v, 0.1, 3, '#b9bec6', '#d5d9de');
        s.custom(30, (c) => {
          const [x, y] = P(u, v, 3);
          c.strokeStyle = 'rgba(190,230,255,0.9)';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x, y - jet);
          c.stroke();
          c.fillStyle = 'rgba(190,230,255,0.8)';
          for (const [dx, dy] of [[-3, 3], [3, 2], [-1.5, 6], [2, 6]]) {
            c.beginPath();
            c.arc(x + dx, y - jet + dy + (frame % 3), 1, 0, Math.PI * 2);
            c.fill();
          }
        });
      };
      const flowerBed = (u: number, v: number, col: string) => {
        s.disc(u, v, 0.17, '#3fa845', 0, -1.2);
        s.disc(u, v, 0.13, col, 0, -1);
        s.custom(0.2, (c) => {
          for (const [du, dv] of [[-0.05, -0.03], [0.04, -0.05], [0, 0.05], [-0.04, 0.04], [0.05, 0.02]]) {
            const [x, y] = P(u + du, v + dv);
            c.fillStyle = 'rgba(255,255,255,0.8)';
            c.beginPath();
            c.arc(x, y, 1, 0, Math.PI * 2);
            c.fill();
          }
        });
      };
      switch (variant & 3) {
        case 0:
          // fountain square: crossing paths, round plaza, pond and fountain, trees and benches
          s.custom(-2, (c) => {
            poly(c, [P(0.92, 0), P(1.08, 0), P(1.08, 2), P(0.92, 2)], path);
            poly(c, [P(0, 0.92), P(2, 0.92), P(2, 1.08), P(0, 1.08)], path);
            const [x, y] = P(1, 1);
            c.fillStyle = path;
            c.beginPath();
            c.ellipse(x, y, 20, 10, 0, 0, Math.PI * 2);
            c.fill();
          });
          s.disc(1, 1, 0.36, rim, 0, -1.2);
          s.disc(1, 1, 0.32, water, 0, -1);
          fountain(1, 1);
          for (const [u, v] of [[0.38, 0.38], [1.62, 0.38], [0.38, 1.62], [1.62, 1.62]]) s.tree(u, v, 5.5);
          bench(0.55, 0.84, 'u'); bench(1.45, 0.84, 'u'); bench(0.84, 1.45, 'v'); bench(1.16, 0.55, 'v');
          break;
        case 1:
          // pond and gazebo: a winding pond, an L path, a gazebo with a red cone roof, flower beds
          s.custom(-2, (c) => {
            poly(c, [P(0, 0.45), P(0.62, 0.45), P(0.62, 0.6), P(0, 0.6)], path);
            poly(c, [P(0.46, 0.6), P(0.62, 0.6), P(0.62, 2), P(0.46, 2)], path);
          });
          if (mask & 1) band(0.46, 0, 0.62, 0.45);
          if (mask & 2) { band(0.62, 0.72, 2, 0.86); band(0.46, 0.6, 0.62, 0.86); }
          s.disc(1.3, 1.3, 0.46, rim, 0, -1.3);
          s.disc(1.3, 1.3, 0.42, water, 0, -1.1);
          s.disc(0.98, 1.5, 0.3, rim, 0, -1.3);
          s.disc(0.98, 1.5, 0.26, water, 0, -1.1);
          s.disc(1.55, 0.45, 0.3, '#c9c2b5', 0, -1);
          s.cylinder(1.55, 0.45, 0.22, 8, '#e8e0d0', '#d8d0c0');
          s.cylinder(1.55, 0.45, 0.29, 6, '#c62828', '#a82020', { z0: 8, rTop: 0.03 });
          flowerBed(0.95, 0.25, '#e8467c');
          flowerBed(1.72, 1.85, '#ffd23f');
          s.tree(0.24, 1.15, 5); s.tree(0.26, 1.78, 5); s.tree(1.82, 1.1, 5); s.tree(1.1, 0.8, 4);
          bench(0.32, 0.7, 'u');
          break;
        case 2:
          // playground: sand pit with slide, swings and seesaw, path in, trees
          s.custom(-2, (c) => {
            poly(c, [P(0.9, 0.9), P(1.85, 0.9), P(1.85, 1.85), P(0.9, 1.85)], '#e8d9a8');
            poly(c, [P(0, 0.95), P(0.9, 0.95), P(0.9, 1.1), P(0, 1.1)], path);
          });
          if (mask & 1) band(0.6, 0, 0.75, 0.95);
          if (mask & 4) band(0.6, 1.1, 0.75, 2);
          if (mask & 2) { band(0.75, 0.75, 0.9, 1.1); band(0.9, 0.75, 2, 0.9); }
          s.box(1.02, 1.02, 1.18, 1.18, 7, '#f2c14e', '#e0a93a');
          s.custom(0.3, (c) => poly(c, [P(1.18, 1.05, 7), P(1.18, 1.15, 7), P(1.42, 1.15, 0), P(1.42, 1.05, 0)], '#e04848'));
          s.box(1.5, 1.52, 1.53, 1.55, 9, '#4f6d8f', '#4f6d8f');
          s.box(1.76, 1.52, 1.79, 1.55, 9, '#4f6d8f', '#4f6d8f');
          s.box(1.5, 1.525, 1.79, 1.545, 1, '#7a5230', '#7a5230', { z0: 9 });
          {
            const sw = [-0.04, 0, 0.04][frame % 3];
            s.box(1.6 + sw, 1.515, 1.66 + sw, 1.555, 1.2, '#e04848', '#e04848', { z0: 3 + Math.abs(sw) * 35 });
          }
          s.box(1.05, 1.6, 1.45, 1.65, 1, '#3a6fd8', '#5a8fe8', { z0: 2.5 });
          s.box(1.22, 1.58, 1.28, 1.67, 2.5, '#7a7f86', '#7a7f86');
          s.tree(0.35, 0.35, 5.5); s.tree(1.6, 0.35, 5); s.tree(0.35, 1.65, 5);
          bench(0.6, 1.2, 'u');
          break;
        default:
          // flower garden: a square loop of path, four beds, an obelisk, an arbour, corner trees
          s.custom(-2, (c) => {
            poly(c, [P(0.35, 0.35), P(1.65, 0.35), P(1.65, 0.48), P(0.35, 0.48)], path);
            poly(c, [P(0.35, 1.52), P(1.65, 1.52), P(1.65, 1.65), P(0.35, 1.65)], path);
            poly(c, [P(0.35, 0.35), P(0.48, 0.35), P(0.48, 1.65), P(0.35, 1.65)], path);
            poly(c, [P(1.52, 0.35), P(1.65, 0.35), P(1.65, 1.65), P(1.52, 1.65)], path);
          });
          if (mask & 1) band(0.93, 0, 1.07, 0.35);
          if (mask & 4) band(0.93, 1.65, 1.07, 2);
          if (mask & 2) band(1.65, 0.93, 2, 1.07);
          if (mask & 8) band(0, 0.93, 0.35, 1.07);
          flowerBed(0.78, 0.78, '#e8467c');
          flowerBed(1.22, 0.78, '#ffd23f');
          flowerBed(0.78, 1.22, '#8a5be0');
          flowerBed(1.22, 1.22, '#ff8c2e');
          s.box(0.95, 0.95, 1.05, 1.05, 3, '#c4c9d1', '#e6e9ed');
          s.box(0.97, 0.97, 1.03, 1.03, 14, '#d5d9de', '#f2f3f5', { z0: 3 });
          s.cylinder(1, 1, 0.035, 2, '#dba82e', '#f2c94c', { z0: 17 });
          s.box(0.9, 0.36, 0.93, 0.39, 8, '#7a5230', '#7a5230');
          s.box(1.07, 0.36, 1.1, 0.39, 8, '#7a5230', '#7a5230');
          s.box(0.87, 0.34, 1.13, 0.41, 1, '#3fa845', '#4cbf52', { z0: 8 });
          for (const [u, v] of [[0.2, 0.2], [1.8, 0.2], [0.2, 1.8], [1.8, 1.8]]) s.tree(u, v, 4.5);
          bench(0.7, 1.74, 'u'); bench(0.26, 0.72, 'v'); bench(1.74, 0.72, 'v');
          break;
      }
      break;
    }
  }
  s.render();
}

// ---- cache ----------------------------------------------------------------

const NO_EFFECTS: Effect[] = [];

export class SpriteCache {
  private cache = new Map<string, HTMLCanvasElement>();
  private effects = new Map<string, Effect[]>();

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
      currentEffects = [];
      drawByKey(ctx, key);
      if (!this.effects.has(key)) this.effects.set(key, currentEffects);
      N = 1;
      SWAP = false;
      SLOPE = [0, 0, 0, 0];
      ALT = 0;
      this.cache.set(k, c);
    }
    return c;
  }

  /** smoke and lights declared by the sprite with this key (built at least once already) */
  effectsOf(key: string): Effect[] {
    return this.effects.get(key) ?? NO_EFFECTS;
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

// ---- vehicles on rails and water, construction cranes ----------------------

export type VehicleKind = 'loco' | 'wagon' | 'freight' | 'cargo' | 'sail';

/**
 * Centred on the tile, long side along `axis`; `back` mirrors it so the visible
 * short face is the rear. Parts are drawn from the far end to the near end.
 */
function drawVehicle(ctx: Ctx, kind: VehicleKind, axis: 'x' | 'y', back: number): void {
  const pt = (l: number, w: number, z = 0): Pt2 => {
    const ll = back ? -l : l;
    return axis === 'x' ? P(0.5 + ll, 0.5 + w, z) : P(0.5 + w, 0.5 + ll, z);
  };
  const edge = 'rgba(0,0,0,0.35)';
  const parts: { key: number; draw: () => void }[] = [];
  const near = (l: number) => (back ? -l : l); // position along the viewer's axis: larger = nearer
  /** a box: long side toward the viewer, the end that faces the viewer, the top */
  const block = (l0: number, l1: number, w0: number, w1: number, z0: number, h: number, wall: string, top: string, lw = 0.5, key = near((l0 + l1) / 2)) => {
    const zt = z0 + h;
    const le = back ? l0 : l1;
    parts.push({ key, draw: () => {
      poly(ctx, [pt(l0, w1, z0), pt(l1, w1, z0), pt(l1, w1, zt), pt(l0, w1, zt)], shade(wall, 0.9), edge, lw);
      poly(ctx, [pt(le, w0, z0), pt(le, w1, z0), pt(le, w1, zt), pt(le, w0, zt)], shade(wall, 0.7), edge, lw);
      poly(ctx, [pt(l0, w0, zt), pt(l1, w0, zt), pt(l1, w1, zt), pt(l0, w1, zt)], top, edge, lw);
    } });
  };
  /** a row of windows on the near long side of the block spanning l0..l1 */
  const windows = (l0: number, l1: number, w: number, z0: number, z1: number, count: number, color = '#1f2a44') => {
    parts.push({ key: near((l0 + l1) / 2) + 0.001, draw: () => {
      const step = (l1 - l0) / count;
      for (let k = 0; k < count; k++) {
        const a = l0 + step * k + step * 0.2, b = l0 + step * (k + 1) - step * 0.2;
        poly(ctx, [pt(a, w, z0), pt(b, w, z0), pt(b, w, z1), pt(a, w, z1)], color);
      }
    } });
  };
  const flush = () => { parts.sort((a, b) => a.key - b.key); for (const part of parts) part.draw(); };

  if (kind === 'loco' || kind === 'wagon' || kind === 'freight') {
    const L = 0.6, W = 0.2;
    // bogies and any deck are the base: drawn before everything that stands on them
    block(-L / 2 + 0.04, -L / 2 + 0.16, -W / 2, W / 2, 0, 1.5, '#2b2f36', '#2b2f36', 0.5, -20);
    block(L / 2 - 0.16, L / 2 - 0.04, -W / 2, W / 2, 0, 1.5, '#2b2f36', '#2b2f36', 0.5, -20);
    if (kind === 'loco') {
      block(-L / 2, L / 2 - 0.08, -W / 2, W / 2, 1.5, 9, '#d63c3c', '#a82e2e');
      block(L / 2 - 0.08, L / 2, -W / 2 + 0.02, W / 2 - 0.02, 1.5, 6, '#f2c14e', '#d9a520');
      windows(-L / 2 + 0.06, L / 2 - 0.12, W / 2, 6, 8.5, 3, '#a9dcff');
      const le = back ? -L / 2 : L / 2;
      parts.push({ key: 9, draw: () => poly(ctx, [pt(le, -0.04, 3), pt(le, 0.04, 3), pt(le, 0.04, 5), pt(le, -0.04, 5)], back ? '#ff5a4a' : '#fff6cc') });
    } else if (kind === 'wagon') {
      block(-L / 2, L / 2, -W / 2, W / 2, 1.5, 3.5, '#2f5fb8', '#2f5fb8');
      block(-L / 2, L / 2, -W / 2, W / 2, 5, 4.5, '#eef2f7', '#8f979f');
      windows(-L / 2 + 0.04, L / 2 - 0.04, W / 2, 6, 8.6, 4);
      parts.push({ key: 0.002, draw: () => poly(ctx, [pt(-L / 2 + 0.02, W / 2, 4.6), pt(L / 2 - 0.02, W / 2, 4.6), pt(L / 2 - 0.02, W / 2, 5.4), pt(-L / 2 + 0.02, W / 2, 5.4)], '#f2c14e') });
    } else {
      block(-L / 2, L / 2, -W / 2, W / 2, 1.5, 1.5, '#5a5f66', '#7a7f86', 0.5, -10);
      block(-L / 2 + 0.03, -0.02, -W / 2 + 0.02, W / 2 - 0.02, 3, 6, '#3fa845', '#2f8a36');
      block(0.02, L / 2 - 0.03, -W / 2 + 0.02, W / 2 - 0.02, 3, 6, '#e0603a', '#b84a2a');
    }
    flush();
    return;
  }
  if (kind === 'cargo') {
    const L = 1.0, W = 0.3;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    const [wx, wy] = pt(-L / 2 - 0.1, 0, 0);
    ctx.beginPath();
    ctx.ellipse(wx, wy, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // hull: long side, then the end that faces the viewer (pointed bow, or the flat stern when going away)
    const hull = (z0: number, z1: number, side: string, end: string) => {
      poly(ctx, [pt(-L / 2, W / 2, z0), pt(L / 2 - 0.22, W / 2, z0), pt(L / 2, 0, z0), pt(L / 2, 0, z1), pt(L / 2 - 0.22, W / 2, z1), pt(-L / 2, W / 2, z1)], side, edge, 0.4);
      if (back) poly(ctx, [pt(-L / 2, -W / 2, z0), pt(-L / 2, W / 2, z0), pt(-L / 2, W / 2, z1), pt(-L / 2, -W / 2, z1)], end, edge, 0.4);
      else poly(ctx, [pt(L / 2 - 0.22, -W / 2, z0), pt(L / 2, 0, z0), pt(L / 2, 0, z1), pt(L / 2 - 0.22, -W / 2, z1)], end, edge, 0.4);
    };
    hull(0, 1.6, '#b83232', '#8f2626');
    hull(1.6, 5.5, '#2f3640', '#22272e');
    poly(ctx, [pt(-L / 2, -W / 2, 5.5), pt(L / 2 - 0.22, -W / 2, 5.5), pt(L / 2, 0, 5.5), pt(L / 2 - 0.22, W / 2, 5.5), pt(-L / 2, W / 2, 5.5)], '#8a9aa8', edge, 0.4);
    const cols = ['#e0603a', '#3a6fd8', '#3fa845', '#f2c14e', '#8c5bd8', '#20a6b8'];
    for (let k = 0; k < 3; k++) {
      const l0 = -0.22 + k * 0.2, l1 = l0 + 0.17;
      block(l0, l1, -W / 2 + 0.03, 0, 5.5, 4.5, cols[k], shade(cols[k], 0.85));
      block(l0, l1, 0.02, W / 2 - 0.03, 5.5, 4.5, cols[k + 3], shade(cols[k + 3], 0.85));
      if (k < 2) block(l0, l1, -W / 2 + 0.03, 0, 10, 4.5, cols[k + 2], shade(cols[k + 2], 0.85));
    }
    block(-L / 2 + 0.04, -L / 2 + 0.2, -W / 2 + 0.04, W / 2 - 0.04, 5.5, 10, '#f2f4f6', '#d8dde3');
    windows(-L / 2 + 0.05, -L / 2 + 0.19, W / 2 - 0.04, 12, 14, 2, '#5fbdf0');
    block(-L / 2 + 0.08, -L / 2 + 0.14, -0.04, 0.04, 15.5, 5, '#d63c3c', '#22272e');
    parts.push({ key: near(L / 2 - 0.1), draw: () => {
      const [m0x, m0y] = pt(L / 2 - 0.1, 0, 5.5), [m1x, m1y] = pt(L / 2 - 0.1, 0, 14);
      ctx.strokeStyle = '#d8dde3';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m0x, m0y);
      ctx.lineTo(m1x, m1y);
      ctx.stroke();
    } });
    flush();
    return;
  }
  // sailing boat
  const L = 0.44, W = 0.16;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const [kx, ky] = pt(-L / 2 - 0.06, 0, 0);
  ctx.beginPath();
  ctx.ellipse(kx, ky, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  poly(ctx, [pt(-L / 2, W / 2, 0), pt(L / 2 - 0.14, W / 2, 0), pt(L / 2, 0, 0), pt(L / 2, 0, 3), pt(L / 2 - 0.14, W / 2, 3), pt(-L / 2, W / 2, 3)], '#2f5390', edge, 0.4);
  if (back) poly(ctx, [pt(-L / 2, -W / 2, 0), pt(-L / 2, W / 2, 0), pt(-L / 2, W / 2, 3), pt(-L / 2, -W / 2, 3)], '#24417a', edge, 0.4);
  else poly(ctx, [pt(L / 2 - 0.14, -W / 2, 0), pt(L / 2, 0, 0), pt(L / 2, 0, 3), pt(L / 2 - 0.14, -W / 2, 3)], '#24417a', edge, 0.4);
  poly(ctx, [pt(-L / 2, -W / 2, 3), pt(L / 2 - 0.14, -W / 2, 3), pt(L / 2, 0, 3), pt(L / 2 - 0.14, W / 2, 3), pt(-L / 2, W / 2, 3)], '#f4f4f4', edge, 0.4);
  const mast0 = pt(-0.02, 0, 3), mast1 = pt(-0.02, 0, 19);
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mast0[0], mast0[1]);
  ctx.lineTo(mast1[0], mast1[1]);
  ctx.stroke();
  const sail = (a: Pt2, b: Pt2, c: Pt2, color: string) => {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.quadraticCurveTo((b[0] + c[0]) / 2 + 3, (b[1] + c[1]) / 2 + 1, c[0], c[1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  };
  sail(pt(-0.02, 0, 18.5), pt(-0.02, 0, 4.5), pt(-L / 2 + 0.02, 0, 4.5), '#ffffff');
  sail(pt(-0.02, 0, 16), pt(L / 2 - 0.02, 0, 3.5), pt(-0.02, 0, 4.5), '#ffe08a');
}

/** A tower crane standing on the tile, jib turned by `frame` (eighths of a turn); overlays a building that just grew. */
function drawCrane(ctx: Ctx, frame: number): void {
  const a = (frame % 8) * Math.PI / 4;
  const top = 84;
  const yellow = '#f2c14e', dark = '#8a6a10';
  const s = new Scene(ctx, 0);
  // concrete base and lattice mast
  s.box(0.38, 0.38, 0.62, 0.62, 2, '#a8adb5', '#c9ced6');
  s.box(0.455, 0.455, 0.545, 0.545, top, '#e0b23a', yellow, { z0: 2 });
  s.render();
  ctx.strokeStyle = 'rgba(80,60,10,0.6)';
  ctx.lineWidth = 0.6;
  for (let z = 4; z < top; z += 5) {
    const [x0, y0] = P(0.455, 0.545, z), [x1, y1] = P(0.545, 0.545, z + 5), [x2, y2] = P(0.545, 0.455, z);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  const jibU = 0.5 + Math.cos(a) * 0.9, jibV = 0.5 + Math.sin(a) * 0.9;
  const cwU = 0.5 - Math.cos(a) * 0.32, cwV = 0.5 - Math.sin(a) * 0.32;
  const [mx, my] = P(0.5, 0.5, top);
  const [jx, jy] = P(jibU, jibV, top);
  const [cx, cy] = P(cwU, cwV, top);
  // trussed jib: two chords and a zigzag between them
  ctx.strokeStyle = yellow;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(jx, jy);
  ctx.moveTo(cx, cy - 3);
  ctx.lineTo(jx, jy - 3);
  ctx.stroke();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    const x = cx + (jx - cx) * t, y = cy + (jy - cy) * t - (k % 2 ? 3 : 0);
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // tower top, tie lines, cab and counterweight
  ctx.beginPath();
  ctx.moveTo(mx, my - 12);
  ctx.lineTo(jx, jy - 3);
  ctx.moveTo(mx, my - 12);
  ctx.lineTo(cx, cy - 3);
  ctx.stroke();
  ctx.strokeStyle = yellow;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(mx, my - 12);
  ctx.stroke();
  const [cabx, caby] = P(0.5 + Math.cos(a) * 0.14, 0.5 + Math.sin(a) * 0.14, top);
  ctx.fillStyle = '#3d4654';
  ctx.fillRect(cabx - 3, caby - 6, 6, 6);
  ctx.fillStyle = '#a9dcff';
  ctx.fillRect(cabx - 2, caby - 5, 4, 2.5);
  ctx.fillStyle = '#7d8590';
  ctx.fillRect(cx - 3.5, cy - 2, 7, 5);
  // trolley, hoist line and hook block
  const [hx, hy] = P(0.5 + Math.cos(a) * 0.68, 0.5 + Math.sin(a) * 0.68, top);
  ctx.fillStyle = dark;
  ctx.fillRect(hx - 2, hy - 1, 4, 2);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx, hy + 24);
  ctx.stroke();
  ctx.fillStyle = '#5a5f66';
  ctx.fillRect(hx - 2.5, hy + 24, 5, 3);
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath();
  ctx.arc(mx, my - 13, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'butt';
}

// ---- cars ------------------------------------------------------------------

export const CAR_COLORS = ['#f2f2f2', '#d94141', '#3a6fd8', '#f2c14e', '#3a3d44', '#8ccf6a', '#e07b39', '#b26ad4'];

/**
 * Small car centred on the tile, long side along `axis` ('x' = u, 'y' = v),
 * built from a roof line (rear to front) extruded across its width. `back`
 * mirrors it so the short face turned toward the viewer is the rear, with
 * tail lights. `shape` 0 = saloon, 1 = van.
 */
function drawCar(ctx: Ctx, axis: 'x' | 'y', colorIdx: number, back: number, shape: number): void {
  const col = CAR_COLORS[Math.abs(colorIdx) % CAR_COLORS.length];
  const glass = '#bfe3f7';
  const van = shape === 1;
  const L = van ? 0.32 : 0.3, W = van ? 0.15 : 0.13, Z0 = 1.3;
  const hw = W / 2;
  // car space: l along the road (front at +l), w across, z up
  const pt = (l: number, w: number, z = 0): Pt2 => {
    const ll = back ? -l : l;
    return axis === 'x' ? P(0.5 + ll, 0.5 + w, z) : P(0.5 + w, 0.5 + ll, z);
  };
  const profile: Pt2[] = van
    ? [[-L / 2, 6], [0.04, 6], [0.09, 4.3], [L / 2, 4]]
    : [[-L / 2, 3.9], [-0.11, 4], [-0.065, 6.1], [0.035, 6.1], [0.085, 4], [L / 2, 3.7]];
  const win: Pt2[] = van
    ? [[-0.14, 4.3], [-0.14, 5.7], [0.03, 5.7], [0.075, 4.3]]
    : [[-0.1, 4.15], [-0.06, 5.85], [0.03, 5.85], [0.075, 4.15]];
  const edge = 'rgba(0,0,0,0.35)';

  // soft shadow on the road
  const c = pt(0, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(c[0], c[1], L * 19, W * 19 + 1, Math.atan2(TILE_H, axis === 'x' ? TILE_W : -TILE_W), 0, Math.PI * 2);
  ctx.fill();

  // long side toward the viewer, following the roof line, then its windows and a door pillar
  poly(ctx, [pt(-L / 2, hw, Z0), pt(L / 2, hw, Z0), ...profile.slice().reverse().map(([l, z]) => pt(l, hw, z))], shade(col, 0.88), edge, 0.5);
  poly(ctx, win.map(([l, z]) => pt(l, hw, z)), shade(glass, 0.85));
  const pillar = van ? -0.04 : -0.015;
  const a = pt(pillar, hw, win[0][1]), b = pt(pillar, hw, win[1][1]);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();

  // short face toward the viewer: the front, or the rear when driving away
  const lf = back ? -L / 2 : L / 2;
  const zf = back ? profile[0][1] : profile[profile.length - 1][1];
  poly(ctx, [pt(lf, -hw, Z0), pt(lf, hw, Z0), pt(lf, hw, zf), pt(lf, -hw, zf)], shade(col, 0.7), edge, 0.5);
  const light = back ? '#ff5a4a' : '#fff6cc';
  for (const w of [-hw + 0.012, hw - 0.04]) {
    poly(ctx, [pt(lf, w, 2.2), pt(lf, w + 0.028, 2.2), pt(lf, w + 0.028, 3.1), pt(lf, w, 3.1)], light);
  }

  // roof line: flat parts in the body colour, slopes in glass
  for (let k = 0; k + 1 < profile.length; k++) {
    const [l0, z0] = profile[k], [l1, z1] = profile[k + 1];
    const sloped = Math.abs(z1 - z0) > 1;
    poly(ctx, [pt(l0, -hw, z0), pt(l1, -hw, z1), pt(l1, hw, z1), pt(l0, hw, z0)], sloped ? glass : shade(col, 1.08), edge, 0.5);
  }

  // wheels on the visible side
  for (const l of [-L / 2 + 0.065, L / 2 - 0.065]) {
    const [wx, wy] = pt(l, hw, Z0 - 0.2);
    ctx.fillStyle = '#1d1f23';
    ctx.beginPath();
    ctx.ellipse(wx, wy, 1.7, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9aa0a6';
    ctx.beginPath();
    ctx.ellipse(wx, wy, 0.7, 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawByKey(ctx: Ctx, key: string): void {
  const parts = key.split(':');
  const num = (i: number) => parseInt(parts[i], 10);
  switch (parts[0]) {
    case 'grass': SLOPE = parseSlope(parts[1]); ALT = parts[3] ? num(3) : 0; return drawGrass(ctx, num(2));
    case 'water': return drawWater(ctx, num(1), num(2), num(3), num(4));
    case 'tree': SLOPE = parseSlope(parts[1]); ALT = parts[3] ? num(3) : 0; return drawTrees(ctx, num(2), parts[4] ? num(4) : 0);
    case 'road': SLOPE = parseSlope(parts[2]); ALT = parts[3] ? num(3) : 0; return drawRoad(ctx, num(1));
    case 'bridge': return drawBridge(ctx, num(1), parts[2] ? num(2) : 0);
    case 'hwy': SLOPE = parseSlope(parts[2]); ALT = parts[4] ? num(4) : 0; return drawHighway(ctx, num(1), parts[3] ? num(3) : 0);
    case 'hwybridge': return drawHighwayBridge(ctx, num(1), parts[2] ? num(2) : 0, parts[3] ? num(3) : 0);
    case 'rail': SLOPE = parseSlope(parts[2]); return drawRail(ctx, num(1), parts[3]);
    case 'railover': SLOPE = parseSlope(parts[2]); return drawRailDeck(ctx, num(1));
    case 'railbridge': return drawRailBridge(ctx, num(1), num(2));
    case 'wire': SLOPE = parseSlope(parts[2]); return drawWire(ctx, num(1));
    case 'zone': return drawEmptyZone(ctx, num(1) as ZoneType);
    case 'rubble': SLOPE = parseSlope(parts[1]); return drawRubble(ctx, num(2));
    case 'icon': return drawBulldozer(ctx);
    case 'car': return drawCar(ctx, parts[1] as 'x' | 'y', num(2), num(3), num(4));
    case 'fire': return drawFlames(ctx, num(1));
    case 'bld': return drawBuilding(ctx, num(1) as ZoneType, num(2), num(3));
    case 'big': return drawBigBuilding(ctx, num(1) as ZoneType, num(2), num(3), num(4));
    case 'st': return drawStruct(ctx, parts[1] as StructType, parts[2] ? num(2) : 0, parts[3] ? num(3) : 0, parts[4] ? num(4) : 0);
    case 'park': {
      drawGrass(ctx, 1);
      const s = new Scene(ctx, num(2));
      parkTile(s, num(1), num(2), parts[3] ? num(3) : 0);
      s.render();
      return;
    }
    case 'vehicle': return drawVehicle(ctx, parts[1] as VehicleKind, parts[2] as 'x' | 'y', num(3));
    case 'crane': return drawCrane(ctx, num(1));
  }
}

// ---- icons -----------------------------------------------------------------

const iconCache = new SpriteCache();

/**
 * Small square thumbnail of one or more sprites stacked (ground first), for
 * toolbar buttons. Tall sprites are bottom-aligned and cropped at the top.
 */
export function renderIcon(keys: string[], n = 1, size = 44, zoom = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const visibleH = n * TILE_H + (n === 1 ? 62 : 80);
  let scale = Math.min(size / (n * TILE_W), size / visibleH) * zoom;
  if (zoom === 1) {
    for (const key of keys) {
      const spr = iconCache.get(key, scale, n);
      ctx.drawImage(spr, (size - spr.width) / 2, size - spr.height);
    }
    return c;
  }
  // zoomed in: the part that matters runs from the top of what is drawn down to just
  // below the footprint centre; it is scaled to fit the square and centred, the front
  // corner of the ground is allowed to spill out
  const compose = (sc: number) => {
    const sprs = keys.map((k) => iconCache.get(k, sc, n));
    const w = Math.max(...sprs.map((sp) => sp.width)), h = Math.max(...sprs.map((sp) => sp.height));
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d')!;
    for (const sp of sprs) tctx.drawImage(sp, (w - sp.width) / 2, h - sp.height);
    const d = tctx.getImageData(0, 0, w, h).data;
    let top = h;
    for (let y = 0; y < h && top === h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { top = y; break; }
    const bottom = (MAX_H + n * TILE_H / 2 + 0.3 * n * TILE_H) * sc;
    return { tmp, top, bottom };
  };
  let { tmp, top, bottom } = compose(scale);
  const maxH = size - 4;
  if (bottom - top > maxH) {
    scale *= maxH / (bottom - top);
    ({ tmp, top, bottom } = compose(scale));
  }
  const y = Math.round((size - (bottom - top)) / 2 - top);
  ctx.drawImage(tmp, Math.round((size - tmp.width) / 2), y);
  return c;
}
