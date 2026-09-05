import type { Pt } from '../game/tools';
import { Renderer, ZOOM_LEVELS } from '../render/renderer';

export interface InputHandlers {
  onHover(tile: Pt | null): void;
  onDragStart(tile: Pt): void;
  onDrag(tile: Pt): void;
  onDragEnd(tile: Pt): void;
  onDragCancel(): void;
  onCameraChange(): void;
  /** return true when the key was consumed */
  onKey(key: string, e: KeyboardEvent): boolean;
}

export function attachInput(canvas: HTMLCanvasElement, renderer: Renderer, h: InputHandlers): void {
  let panning = false;
  let dragging = false;
  let spaceHeld = false;
  let lastMouse: Pt = { x: 0, y: 0 };
  let lastTile: Pt | null = null;

  const samePt = (a: Pt | null, b: Pt | null) => !!a && !!b && a.x === b.x && a.y === b.y;
  const tileAt = (e: MouseEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return renderer.screenToTile(e.clientX - r.left, e.clientY - r.top);
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('mousedown', (e) => {
    lastMouse = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld)) {
      panning = true;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (e.button === 0) {
      dragging = true;
      h.onDragStart(tileAt(e));
    }
  });

  window.addEventListener('mousemove', (e) => {
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

  window.addEventListener('mouseup', (e) => {
    if (panning && (e.button === 1 || e.button === 2 || e.button === 0)) {
      panning = false;
      canvas.style.cursor = spaceHeld ? 'grab' : '';
      return;
    }
    if (dragging && e.button === 0) {
      dragging = false;
      h.onDragEnd(tileAt(e));
    }
  });

  canvas.addEventListener('mouseleave', () => {
    lastTile = null;
    h.onHover(null);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  function zoomStep(dir: number, sx: number, sy: number): void {
    const i = ZOOM_LEVELS.indexOf(renderer.camera.zoom);
    const j = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + dir));
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
    canvas.style.cursor = '';
  });
}
