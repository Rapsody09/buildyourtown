import type { Pt } from '../game/tools';
import { Renderer, ZOOM_LEVELS } from '../render/renderer';

export interface InputHandlers {
  onHover(tile: Pt | null): void;
  /** `touch` is true for a finger: click tools then preview first and confirm on a second tap */
  onDragStart(tile: Pt, touch: boolean): void;
  onDrag(tile: Pt): void;
  onDragEnd(tile: Pt): void;
  onDragCancel(): void;
  onCameraChange(): void;
  /** return true when the key was consumed */
  onKey(key: string, e: KeyboardEvent): boolean;
  /** does a tool currently want single-finger drags? (otherwise one finger pans) */
  toolActive(): boolean;
}

interface Finger {
  x: number;
  y: number;
}

/**
 * Mouse: left = tool, right/middle or space = pan, wheel = zoom.
 * Touch: one finger = tool when one is selected, otherwise pan; two fingers =
 * pan + pinch zoom (rendered as a CSS transform during the gesture, then
 * snapped to the nearest zoom step).
 */
export function attachInput(canvas: HTMLCanvasElement, renderer: Renderer, h: InputHandlers): void {
  let panning = false;
  let dragging = false;
  let spaceHeld = false;
  let lastMouse: Pt = { x: 0, y: 0 };
  let lastTile: Pt | null = null;
  const fingers = new Map<number, Finger>();
  let pinch: { dist: number; cx: number; cy: number; zoom: number; scale: number; dx: number; dy: number } | null = null;

  canvas.style.touchAction = 'none';
  const samePt = (a: Pt | null, b: Pt | null) => !!a && !!b && a.x === b.x && a.y === b.y;
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tileAt = (e: { clientX: number; clientY: number }): Pt => {
    const p = local(e);
    return renderer.screenToTile(p.x, p.y);
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const startPan = (e: PointerEvent) => {
    panning = true;
    lastMouse = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  };

  const startPinch = () => {
    if (dragging) { dragging = false; h.onDragCancel(); }
    panning = false;
    const [a, b] = [...fingers.values()];
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      zoom: renderer.camera.zoom, scale: 1, dx: 0, dy: 0,
    };
    canvas.style.transformOrigin = `${pinch.cx}px ${pinch.cy}px`;
  };

  const endPinch = () => {
    if (!pinch) return;
    const target = pinch.zoom * pinch.scale;
    const level = ZOOM_LEVELS.reduce((b, z) => Math.abs(z - target) < Math.abs(b - target) ? z : b);
    // pan first (in screen px at the old zoom), then zoom around the pinch centre
    renderer.camera.x -= pinch.dx / renderer.camera.zoom;
    renderer.camera.y -= pinch.dy / renderer.camera.zoom;
    renderer.zoomAt(pinch.cx, pinch.cy, level);
    canvas.style.transform = '';
    pinch = null;
    h.onCameraChange();
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      fingers.set(e.pointerId, local(e));
      if (fingers.size === 2) { startPinch(); return; }
      if (fingers.size > 2) return;
      if (h.toolActive()) {
        dragging = true;
        h.onDragStart(tileAt(e), true);
      } else {
        startPan(e);
      }
      return;
    }
    lastMouse = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld)) {
      startPan(e);
      e.preventDefault();
      return;
    }
    if (e.button === 0) {
      dragging = true;
      h.onDragStart(tileAt(e), false);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && fingers.has(e.pointerId)) fingers.set(e.pointerId, local(e));
    if (pinch && fingers.size >= 2) {
      const [a, b] = [...fingers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const minS = ZOOM_LEVELS[0] / pinch.zoom, maxS = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] / pinch.zoom;
      pinch.scale = Math.max(minS, Math.min(maxS, dist / Math.max(1, pinch.dist)));
      pinch.dx = cx - pinch.cx;
      pinch.dy = cy - pinch.cy;
      canvas.style.transform = `translate(${pinch.dx}px, ${pinch.dy}px) scale(${pinch.scale})`;
      return;
    }
    if (panning) {
      const z = renderer.camera.zoom;
      renderer.camera.x -= (e.clientX - lastMouse.x) / z;
      renderer.camera.y -= (e.clientY - lastMouse.y) / z;
      lastMouse = { x: e.clientX, y: e.clientY };
      h.onCameraChange();
      return;
    }
    const t = tileAt(e);
    if (samePt(t, lastTile)) return;
    lastTile = t;
    if (e.pointerType === 'mouse') h.onHover(t);
    if (dragging) h.onDrag(t);
  });

  const release = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      fingers.delete(e.pointerId);
      if (pinch) {
        if (fingers.size < 2) endPinch();
        if (fingers.size === 0) panning = false;
        return;
      }
    }
    if (panning) {
      panning = false;
      canvas.style.cursor = spaceHeld ? 'grab' : '';
      return;
    }
    if (dragging && (e.pointerType === 'touch' || e.button === 0)) {
      dragging = false;
      if (e.type === 'pointercancel') h.onDragCancel();
      else h.onDragEnd(tileAt(e));
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    lastTile = null;
    h.onHover(null);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomStep(e.deltaY < 0 ? 1 : -1, p.x, p.y);
  }, { passive: false });

  function zoomStep(dir: number, sx: number, sy: number): void {
    const i = ZOOM_LEVELS.indexOf(renderer.camera.zoom);
    const j = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, (i < 0 ? 1 : i) + dir));
    if (i === j) return;
    renderer.zoomAt(sx, sy, ZOOM_LEVELS[j]);
    h.onCameraChange();
  }

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      if (!spaceHeld) {
        spaceHeld = true;
        canvas.style.cursor = 'grab';
      }
      e.preventDefault();
      return;
    }
    const pan = 48 / renderer.camera.zoom;
    switch (e.key) {
      case 'ArrowLeft': renderer.camera.x -= pan; break;
      case 'ArrowRight': renderer.camera.x += pan; break;
      case 'ArrowUp': renderer.camera.y -= pan; break;
      case 'ArrowDown': renderer.camera.y += pan; break;
      case '+': case '=': zoomStep(1, renderer.width / 2, renderer.height / 2); return;
      case '-': zoomStep(-1, renderer.width / 2, renderer.height / 2); return;
      case 'Escape':
        if (dragging) { dragging = false; h.onDragCancel(); }
        h.onKey('Escape', e);
        return;
      default:
        if (h.onKey(e.key, e)) e.preventDefault();
        return;
    }
    e.preventDefault();
    h.onCameraChange();
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceHeld = false;
      if (!panning) canvas.style.cursor = '';
    }
  });

  window.addEventListener('blur', () => {
    if (dragging) { dragging = false; h.onDragCancel(); }
    panning = false;
    spaceHeld = false;
    fingers.clear();
    if (pinch) { canvas.style.transform = ''; pinch = null; }
    canvas.style.cursor = '';
  });
}
