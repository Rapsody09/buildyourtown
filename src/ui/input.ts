import type { Pt } from '../game/tools';
import { Renderer, ZOOM_LEVELS } from '../render/renderer';

export interface InputHandlers {
  onHover(tile: Pt | null): void;
  /**
   * `touch` is true for a finger; `hold` when the finger was held down first: a
   * building then follows the finger and is placed on release, whereas a plain
   * tap previews first and places on a second tap.
   */
  onDragStart(tile: Pt, touch: boolean, hold?: boolean): void;
  onDrag(tile: Pt): void;
  onDragEnd(tile: Pt): void;
  onDragCancel(): void;
  onCameraChange(): void;
  /** a two-finger gesture is in progress: freeze animations, redraw at once on camera changes */
  onGesture(active: boolean): void;
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
 * Touch: one finger pans (a CSS translate follows the finger, the camera is
 * committed a few times per second); a tap uses the tool once; press and hold
 * then drag draws with it; two fingers = pan + pinch zoom. The camera only knows the discrete zoom steps: during the
 * pinch the canvas is scaled with a CSS transform, and each time the fingers
 * cross over to another step the camera is really moved there (and the
 * transform rebased), so the picture follows the fingers continuously and the
 * final snap is small.
 */
export function attachInput(canvas: HTMLCanvasElement, renderer: Renderer, h: InputHandlers): void {
  let panning = false;
  let dragging = false;
  let spaceHeld = false;
  let lastMouse: Pt = { x: 0, y: 0 };
  let lastTile: Pt | null = null;
  const fingers = new Map<number, Finger>();
  /** zoom0/dist0: at gesture start; level: committed camera zoom; ax/ay: screen point kept under the fingers since the last commit */
  let pinch: { zoom0: number; dist0: number; level: number; ax: number; ay: number; cx: number; cy: number } | null = null;
  // the canvas box without any transform: getBoundingClientRect() moves with the gesture transforms
  let baseRect = canvas.getBoundingClientRect();
  // one finger: idle until it moves (pan) or is held (draw with the tool); a short tap uses the tool once
  const HOLD_MS = 280, SLOP = 8, PAN_COMMIT_MS = 80, PAN_COMMIT_PX = 48;
  let touchMode: 'idle' | 'pan' | 'draw' = 'idle';
  let touchStart: Pt | null = null;
  let touchId = -1;
  let holdTimer = 0;
  /** one-finger pan previewed with a CSS translate and committed to the camera a few times per second */
  let pan: { ax: number; ay: number; cx: number; cy: number; at: number } | null = null;

  canvas.style.touchAction = 'none';
  const samePt = (a: Pt | null, b: Pt | null) => !!a && !!b && a.x === b.x && a.y === b.y;
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = pinch || pan ? baseRect : canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const nearestLevel = (z: number) => ZOOM_LEVELS.reduce((b, l) => Math.abs(l - z) < Math.abs(b - z) ? l : b);
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
    baseRect = canvas.getBoundingClientRect();
    const [a, b] = [...fingers.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    pinch = { zoom0: renderer.camera.zoom, dist0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), level: renderer.camera.zoom, ax: cx, ay: cy, cx, cy };
    canvas.style.transition = '';
    canvas.style.transformOrigin = `${cx}px ${cy}px`;
    h.onGesture(true);
  };

  /** move the camera so the world point that was under the fingers at the last commit is under them now */
  const commitPan = () => {
    if (!pinch) return;
    renderer.camera.x -= (pinch.cx - pinch.ax) / pinch.level;
    renderer.camera.y -= (pinch.cy - pinch.ay) / pinch.level;
    pinch.ax = pinch.cx;
    pinch.ay = pinch.cy;
  };

  const movePinch = () => {
    if (!pinch) return;
    const [a, b] = [...fingers.values()];
    pinch.cx = (a.x + b.x) / 2;
    pinch.cy = (a.y + b.y) / 2;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const target = Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], pinch.zoom0 * dist / pinch.dist0));
    const level = nearestLevel(target);
    if (level !== pinch.level) {
      // really zoom the camera to the new step, around the fingers, and rebase the preview on it
      commitPan();
      renderer.zoomAt(pinch.cx, pinch.cy, level);
      pinch.level = level;
      canvas.style.transformOrigin = `${pinch.cx}px ${pinch.cy}px`;
      h.onCameraChange();
    }
    canvas.style.transform = `translate(${pinch.cx - pinch.ax}px, ${pinch.cy - pinch.ay}px) scale(${target / pinch.level})`;
  };

  const endPinch = () => {
    if (!pinch) return;
    commitPan();
    h.onCameraChange(); // drawn at once while the gesture is still on
    // the camera already sits on the nearest step: ease the small residual scale away
    canvas.style.transition = 'transform 120ms ease-out';
    canvas.style.transform = '';
    pinch = null;
    h.onGesture(false);
  };

  const startTouchPan = (x: number, y: number) => {
    baseRect = canvas.getBoundingClientRect();
    pan = { ax: x, ay: y, cx: x, cy: y, at: performance.now() };
    touchMode = 'pan';
    canvas.style.transition = '';
    h.onGesture(true);
  };
  const commitTouchPan = () => {
    if (!pan) return;
    const z = renderer.camera.zoom;
    renderer.camera.x -= (pan.cx - pan.ax) / z;
    renderer.camera.y -= (pan.cy - pan.ay) / z;
    pan.ax = pan.cx;
    pan.ay = pan.cy;
    pan.at = performance.now();
    h.onCameraChange(); // drawn at once
    canvas.style.transform = '';
  };
  const moveTouchPan = (x: number, y: number) => {
    if (!pan) return;
    pan.cx = x;
    pan.cy = y;
    const dx = x - pan.ax, dy = y - pan.ay;
    if (performance.now() - pan.at >= PAN_COMMIT_MS || Math.hypot(dx, dy) >= PAN_COMMIT_PX) commitTouchPan();
    else canvas.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const endTouchPan = () => {
    commitTouchPan();
    pan = null;
    h.onGesture(false);
  };
  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; } };
  const resetTouch = () => { clearHold(); touchMode = 'idle'; touchStart = null; touchId = -1; };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      fingers.set(e.pointerId, local(e));
      if (fingers.size === 2) {
        // a second finger: whatever the first was doing turns into a pinch
        clearHold();
        if (touchMode === 'draw') { dragging = false; h.onDragCancel(); }
        if (touchMode === 'pan') { commitTouchPan(); pan = null; h.onGesture(false); }
        touchMode = 'idle';
        touchStart = null;
        startPinch();
        return;
      }
      if (fingers.size > 2) return;
      clearHold();
      touchStart = local(e);
      touchId = e.pointerId;
      touchMode = 'idle';
      if (h.toolActive()) {
        holdTimer = window.setTimeout(() => {
          holdTimer = 0;
          const f = fingers.get(touchId);
          if (!f || touchMode !== 'idle') return;
          touchMode = 'draw';
          dragging = true;
          navigator.vibrate?.(12);
          lastTile = renderer.screenToTile(f.x, f.y);
          h.onDragStart(lastTile, true, true);
        }, HOLD_MS);
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
    if (e.pointerType === 'touch') {
      if (!fingers.has(e.pointerId)) return;
      const p = local(e);
      fingers.set(e.pointerId, p);
      if (pinch) { if (fingers.size >= 2) movePinch(); return; }
      if (e.pointerId !== touchId) return;
      if (touchMode === 'idle') {
        if (!touchStart || Math.hypot(p.x - touchStart.x, p.y - touchStart.y) < SLOP) return;
        clearHold();
        startTouchPan(p.x, p.y);
        return;
      }
      if (touchMode === 'pan') { moveTouchPan(p.x, p.y); return; }
      const t = renderer.screenToTile(p.x, p.y);
      if (samePt(t, lastTile)) return;
      lastTile = t;
      h.onDrag(t);
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
    h.onHover(t);
    if (dragging) h.onDrag(t);
  });

  const release = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      const p = fingers.get(e.pointerId) ?? local(e);
      fingers.delete(e.pointerId);
      if (pinch) {
        if (fingers.size < 2) {
          endPinch();
          // the finger still down goes on panning
          const left = [...fingers.entries()][0];
          if (left) { touchId = left[0]; touchStart = left[1]; startTouchPan(left[1].x, left[1].y); }
        }
        return;
      }
      if (e.pointerId !== touchId) return;
      const cancel = e.type === 'pointercancel';
      if (touchMode === 'pan') {
        endTouchPan();
      } else if (touchMode === 'draw') {
        dragging = false;
        if (cancel) h.onDragCancel(); else h.onDragEnd(renderer.screenToTile(p.x, p.y));
      } else if (!cancel) {
        // a plain tap: use the tool once on this tile (the magnifier tells about it)
        const t = renderer.screenToTile(p.x, p.y);
        h.onDragStart(t, true);
        h.onDragEnd(t);
      }
      resetTouch();
      return;
    }
    if (panning) {
      panning = false;
      canvas.style.cursor = spaceHeld ? 'grab' : '';
      return;
    }
    if (dragging && e.button === 0) {
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
    if (pinch) { canvas.style.transform = ''; pinch = null; h.onGesture(false); }
    if (pan) { canvas.style.transform = ''; pan = null; h.onGesture(false); }
    resetTouch();
    canvas.style.cursor = '';
  });
}
