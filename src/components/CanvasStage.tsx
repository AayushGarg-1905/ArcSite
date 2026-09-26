import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer as KLayer, Line, Rect, Circle, Text, Group, Arc } from 'react-konva';
import type Konva from 'konva';
import { useStore } from '../store';
import {
  snapVal, dist, fmtLen, roomArea, PX_PER_M, pathLen,
  normalizeAngle, angleOf, pointAt, rotateSegment,
  parseLenToPx,
} from '../lib/geometry';
import { SYMBOL_MAP, fade } from '../lib/symbols';
import { uid, type CadEntity, type SceneKind } from '../types';

type Pt = { x: number; y: number };

type ResizeMode =
  | { kind: 'point'; idx: 0 | 1 }
  | { kind: 'corner'; sx: 1 | -1; sy: 1 | -1 }
  | { kind: 'edge'; sx: 1 | -1 | 0; sy: 1 | -1 | 0 }
  | { kind: 'doorlen' }
  | { kind: 'circle' };

const ROTATABLE = new Set(['wall', 'line', 'dimension', 'room', 'rect', 'door', 'window', 'text', 'symbol']);
const isBox = (t: string) => t === 'room' || t === 'rect' || t === 'symbol';
/** on an elevation scene, doors/windows are drawn face-on as plain w×h boxes (no rotation) */
const isBoxLike = (t: string, kind: SceneKind) => isBox(t) || (kind === 'elevation' && (t === 'door' || t === 'window'));

export default function CanvasStage() {
  const s = useStore();
  const stageRef = useRef<Konva.Stage>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, scale: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const [pending, setPending] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [penPts, setPenPts] = useState<number[] | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth - 560, h: window.innerHeight - 130 });
  const contRef = useRef<HTMLDivElement>(null);

  // typed-dimension inputs while drawing
  const [dimText, setDimText] = useState('');
  const [roomWText, setRoomWText] = useState('');
  const [roomHText, setRoomHText] = useState('');
  // door/window placement defaults (replaces the old prompt)
  const [doorWText, setDoorWText] = useState('3ft');
  const [doorHText, setDoorHText] = useState('7ft'); // used only on elevation scenes
  const [doorRotText, setDoorRotText] = useState('0');

  const rotatingRef = useRef(false);
  const resizeRef = useRef<ResizeMode | null>(null);
  // multi-touch: active pointers by pointerId (screen px) + pinch-gesture snapshot
  const pointersRef = useRef(new Map<number, Pt>());
  const pinchRef = useRef<{ d0: number; m0: Pt; cam0: { x: number; y: number; scale: number } } | null>(null);
  // node currently being moved via Konva drag (cleared on dragend; the window
  // pointerup safety-net force-finishes it if the button was released off-canvas)
  const dragNodeRef = useRef<Konva.Node | null>(null);
  const pendingRef = useRef<Pt | null>(null);
  pendingRef.current = pending;
  const cursorRef = useRef<Pt | null>(null);
  cursorRef.current = cursor;
  const penRef = useRef<number[] | null>(null);
  penRef.current = penPts;

  // which scene (floor plan or a named elevation) is active, and its entities only
  const activeKind: SceneKind = s.scenes.find((sc) => sc.id === s.activeSceneId)?.kind ?? 'plan';
  const sceneEntities = useMemo(
    () => s.entities.filter((e) => (e.sceneId ?? 'plan') === s.activeSceneId),
    [s.entities, s.activeSceneId]
  );
  const sel = sceneEntities.find((e) => e.id === s.selectedId) ?? null;

  useEffect(() => {
    const onR = () => {
      const el = contRef.current;
      if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    onR();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  // tablet Esc: tapping the armed tool again bumps cancelSeq via cancelAll()
  useEffect(() => {
    setPending(null);
    setPenPts(null);
    useStore.setState({ pendingSymbol: null });
    setDimText(''); setRoomWText(''); setRoomHText('');
    rotatingRef.current = false;
    resizeRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cancelSeq]);

  const toWorld = (): Pt | null => {
    const st = stageRef.current;
    if (!st) return null;
    const p = st.getPointerPosition();
    if (!p) return null;
    return { x: (p.x - cam.x) / cam.scale, y: (p.y - cam.y) / cam.scale };
  };

  const snapPt = (p: Pt): Pt => ({
    x: snapVal(p.x, s.grid, s.snap),
    y: snapVal(p.y, s.grid, s.snap),
  });

  /**
   * Grid magnet: lock onto a grid line only within a few screen-px of it,
   * otherwise track the pointer exactly. Used by move + resize drags so a
   * fractional endpoint follows the cursor smoothly instead of yanking a
   * full grid cell on first touch. (Fresh draws keep hard snapPt so corners
   * always close exactly.)
   */
  const magnetPt = (p: Pt): Pt => {
    const st = useStore.getState();
    if (!st.snap || !st.grid) return p;
    const th = 5 / camRef.current.scale;
    const near = (v: number) => {
      const r = Math.round(v / st.grid) * st.grid;
      return Math.abs(r - v) <= th ? r : v;
    };
    return { x: near(p.x), y: near(p.y) };
  };

  /**
   * Polar tracking while drawing: if the segment direction is within a few
   * degrees of a 45° multiple, lock it there (keeps the cursor distance).
   * Walls drawn near-horizontal/vertical come out exactly straight instead
   * of 88.7°-crooked. Deliberate odd angles (>=5° off) pass through untouched.
   */
  const snapDrawAngle = (a: Pt, b: Pt): Pt => {
    const d = dist(a.x, a.y, b.x, b.y);
    if (d < 1) return b;
    const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const locked = Math.round(ang / 45) * 45;
    if (Math.abs(ang - locked) > 5) return b;
    const r = (locked * Math.PI) / 180;
    return { x: a.x + Math.cos(r) * d, y: a.y + Math.sin(r) * d };
  };

  const layerOf = (id: string) => s.layers.find((l) => l.id === id);
  const visible = (e: CadEntity) => layerOf(e.layer)?.visible !== false;

  /** a finger/stylus lifted (or the gesture was cancelled): forget it, end pinch */
  const endPointer = (pointerId: number) => {
    pointersRef.current.delete(pointerId);
    if (pointersRef.current.size < 2 && pinchRef.current) {
      pinchRef.current = null;
      const st = stageRef.current;
      if (st) st.draggable(useStore.getState().tool === 'pan');
    }
  };

  // ---------- rotation ----------

  /** pivot point about which an entity rotates (world coords) */
  const pivotOf = (e: CadEntity): Pt => {
    if (e.points && e.points.length === 4) {
      const p = e.points;
      return { x: (p[0] + p[2]) / 2, y: (p[1] + p[3]) / 2 };
    }
    if (e.points) {
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i + 1 < e.points.length; i += 2) { sx += e.points[i]; sy += e.points[i + 1]; n++; }
      return { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
    }
    if (isBox(e.type)) {
      return { x: (e.x ?? 0) + (e.width ?? 0) / 2, y: (e.y ?? 0) + (e.height ?? 0) / 2 };
    }
    if (e.type === 'circle') {
      return { x: (e.x ?? 0) + (e.width ?? 0) / 2, y: (e.y ?? 0) + (e.height ?? 0) / 2 };
    }
    return { x: e.x ?? 0, y: e.y ?? 0 }; // door/window pivot = origin, text = position
  };

  const rotateSelectedBy = (stepDeg: number) => {
    if (!sel || !ROTATABLE.has(sel.type)) return;
    if (activeKind === 'elevation' && (sel.type === 'door' || sel.type === 'window')) return; // face-on, no rotation
    const st = useStore.getState();
    st.checkpoint();
    if (sel.points && sel.points.length === 4) {
      const cur = angleOf(sel.points[0], sel.points[1], sel.points[2], sel.points[3]);
      st.updateEntity(sel.id, { points: rotateSegment(sel.points, normalizeAngle(cur + stepDeg)) }, true);
    } else if (!sel.points) {
      st.updateEntity(sel.id, { rotation: normalizeAngle((sel.rotation ?? 0) + stepDeg) }, true);
    }
  };

  // keyboard: R rotates, Ctrl+Z/Y undo/redo, Ctrl+D duplicate, arrows nudge, Esc cancels, typing digits jumps to dimension box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !typing && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
        return;
      }
      if (mod && !typing && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        useStore.getState().redo();
        return;
      }
      if (mod && !typing && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const st = useStore.getState();
        const src = st.entities.find((en) => en.id === st.selectedId);
        if (src) {
          const off = st.grid || 10;
          const copy: CadEntity = { ...src, id: uid() };
          if (copy.points) copy.points = copy.points.map((v) => v + off);
          else { copy.x = (copy.x ?? 0) + off; copy.y = (copy.y ?? 0) + off; }
          st.addEntity(copy);
          st.setSelected(copy.id);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (pendingRef.current) setPending(null);
        if (penRef.current) setPenPts(null);
        useStore.setState({ pendingSymbol: null });
        setDimText(''); setRoomWText(''); setRoomHText('');
        rotatingRef.current = false;
        resizeRef.current = null;
        // Bail out of the active command into Select: stray clicks after Esc
        // must never create extra walls / dimensions. Also clears selection.
        const st = useStore.getState();
        if (st.tool !== 'select') st.setTool('select');
        if (st.selectedId) st.setSelected(null);
        return;
      }
      if (typing || mod) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const st = useStore.getState();
        if (st.selectedId) {
          e.preventDefault();
          st.removeEntity(st.selectedId);
        }
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const st = useStore.getState();
        if (!st.selectedId) return;
        e.preventDefault();
        const step = e.shiftKey ? (st.grid || 10) : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        st.nudge(dx, dy);
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        rotateSelectedBy(e.shiftKey ? 90 : 15);
        return;
      }
      // SketchUp-style: typing a number while drawing focuses the dimension box
      if (pendingRef.current && /[0-9.'"]/.test(e.key) && e.key.length === 1) {
        const st = useStore.getState();
        const el =
          (st.tool === 'wall' || st.tool === 'line' || st.tool === 'dimension' || st.tool === 'circle')
            ? document.getElementById('dim-input')
            : document.getElementById('dim-w-input');
        el?.focus();
      }
    };
    const onUp = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      rotatingRef.current = false;
      resizeRef.current = null;
      // safety net: a Konva drag released off-canvas never fires dragend, so
      // the move would silently revert on next render — force-finish it here
      // (no-op when the drag already ended normally and cleared the ref)
      dragNodeRef.current?.stopDrag();
      dragNodeRef.current = null;
      // Stage's own onPointerUp already committed strokes released over the canvas
      if ((e.target as HTMLElement)?.tagName === 'CANVAS') return;
      // finish an in-progress pen stroke released outside the canvas
      const pts = penRef.current;
      if (pts && pts.length >= 4) {
        const st = useStore.getState();
        const id = uid();
        st.addEntity({ id, type: 'freehand', layer: 'walls', sceneId: st.activeSceneId, points: pts, thickness: st.penWidth, color: st.drawColor });
        st.setSelected(id);
        setPenPts(null);
      } else if (pts) {
        setPenPts(null);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.selectedId, activeKind]);

  // ---------- commit helpers ----------

  const commitSegment = (a: Pt, b: Pt) => {
    // layers are assigned automatically per tool (no layer UI)
    const layerFor: Record<string, string> = { wall: 'walls', line: 'walls', dimension: 'dims' };
    const layer = layerFor[s.tool] ?? 'walls';
    const id = uid();
    s.addEntity({
      id, type: s.tool === 'wall' ? 'wall' : s.tool === 'dimension' ? 'dimension' : 'line',
      layer, sceneId: s.activeSceneId, points: [a.x, a.y, b.x, b.y], thickness: s.wallThickness, color: s.drawColor,
    });
    s.setSelected(id);
  };

  const commitBox = (a: Pt, w: number, h: number) => {    const layer = 'rooms';
    const cur = cursorRef.current;
    const x = cur && cur.x < a.x ? a.x - w : a.x;
    const y = cur && cur.y < a.y ? a.y - h : a.y;
    const label = s.tool === 'room' ? prompt('Room name?', 'Room') ?? 'Room' : undefined;
    const id = uid();
    s.addEntity({ id, type: s.tool as 'room' | 'rect', layer, sceneId: s.activeSceneId, x, y, width: w, height: h, label: label || undefined, color: s.drawColor });
    s.setSelected(id);
  };

  const commitTwoClick = (endRaw: Pt, exact = false) => {
    const a = pendingRef.current;
    if (!a) return;
    const b = exact ? endRaw : snapDrawAngle(a, snapPt(endRaw));
    if (s.tool === 'wall' || s.tool === 'line' || s.tool === 'dimension') {
      if (dist(a.x, a.y, b.x, b.y) < 0.5) { setPending(null); return; }
      commitSegment(a, b);
    } else if (s.tool === 'room' || s.tool === 'rect') {
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (w < 1 || h < 1) { setPending(null); return; }
      commitBox(a, w, h);
    } else if (s.tool === 'circle') {
      const r = dist(a.x, a.y, b.x, b.y);
      if (r < 1) { setPending(null); return; }
      const id = uid();
      s.addEntity({ id, type: 'circle', layer: 'walls', sceneId: s.activeSceneId, x: a.x - r, y: a.y - r, width: r * 2, height: r * 2, color: s.drawColor });
      s.setSelected(id);
    }
    setPending(null);
    setDimText(''); setRoomWText(''); setRoomHText('');
  };

  /** Apply the typed dimension box (Enter) */
  const applyTyped = () => {
    const a = pendingRef.current;
    if (!a) return;
    const cur = cursorRef.current ? snapPt(cursorRef.current) : null;
    if (s.tool === 'wall' || s.tool === 'line' || s.tool === 'dimension') {
      const len = parseLenToPx(dimText, s.unit);
      if (len == null) { alert(`Can't parse "${dimText}". Try e.g. 10ft, 10'6", 3m, 250cm.`); return; }
      let ang = 0;
      if (cur && dist(a.x, a.y, cur.x, cur.y) > 0.001) ang = angleOf(a.x, a.y, cur.x, cur.y);
      const rawB = pointAt(a.x, a.y, ang, len);
      const b = snapDrawAngle(a, rawB); // typed length, cursor direction straightened
      commitTwoClick(b, true);
    } else if (s.tool === 'room' || s.tool === 'rect') {
      const w = parseLenToPx(roomWText, s.unit);
      const h = parseLenToPx(roomHText, s.unit);
      if (w == null || h == null) { alert('Enter width and height, e.g. 12ft x 10ft or 3.6m x 3m.'); return; }
      commitBox(a, w, h);
      setPending(null);
    } else if (s.tool === 'circle') {
      const r = parseLenToPx(dimText, s.unit);
      if (r == null) { alert(`Can't parse radius "${dimText}".`); return; }
      const id = uid();
      s.addEntity({ id, type: 'circle', layer: 'walls', sceneId: s.activeSceneId, x: a.x - r, y: a.y - r, width: r * 2, height: r * 2, color: s.drawColor });
      s.setSelected(id);
      setPending(null);
      setDimText('');
    }
  };

  const placeSymbol = (kindId: string, w: Pt) => {
    const def = SYMBOL_MAP[kindId];
    if (!def) return;
    const p = snapPt(w);
    const id = uid();
    s.addEntity({
      id, type: 'symbol', symbol: kindId, layer: 'furniture', sceneId: s.activeSceneId,
      x: p.x - def.w / 2, y: p.y - def.h / 2, width: def.w, height: def.h,
      rotation: 0, color: s.drawColor, label: def.name,
    });
    s.setSelected(id);
  };

  const handleClickPlace = (w: Pt) => {
    const p = snapPt(w);
    // layers are assigned automatically per tool (no layer UI)
    const layer = s.tool === 'text' ? 'text' : 'doors'; // door / window / text tools only reach here
    if (s.tool === 'door' || s.tool === 'window') {
      const fallback = s.tool === 'door' ? 60 : 100;
      const parsedW = parseLenToPx(doorWText, s.unit);
      const width = parsedW ?? fallback;
      const id = uid();
      if (activeKind === 'elevation') {
        // face-on box: real width x height, positioned by its center
        const fallbackH = s.tool === 'door' ? 105 : 60; // ~2.1m door head height / ~1.2m window
        const parsedH = parseLenToPx(doorHText, s.unit);
        const height = parsedH ?? fallbackH;
        s.addEntity({
          id, type: s.tool, layer, sceneId: s.activeSceneId,
          x: p.x - width / 2, y: p.y - height / 2, width, height, color: s.drawColor,
        });
      } else {
        const rot = parseFloat(doorRotText);
        s.addEntity({
          id, type: s.tool, layer, sceneId: s.activeSceneId,
          x: p.x - width / 2, y: p.y, width,
          rotation: Number.isFinite(rot) ? normalizeAngle(rot) : 0, color: s.drawColor,
        });
      }
      s.setSelected(id);
    } else if (s.tool === 'text') {
      const label = prompt('Text?', 'Note');
      if (label) {
        const id = uid();
        s.addEntity({ id, type: 'text', layer, sceneId: s.activeSceneId, x: p.x, y: p.y, label, fontSize: 16, color: s.drawColor });
        s.setSelected(id);
      }
    }
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const st = stageRef.current;
    if (!st) return;
    const old = cam.scale;
    const ptr = st.getPointerPosition();
    if (!ptr) return;
    const next = Math.min(4, Math.max(0.2, old * (e.evt.deltaY < 0 ? 1.1 : 0.9)));
    const wx = (ptr.x - cam.x) / old;
    const wy = (ptr.y - cam.y) / old;
    setCam({ scale: next, x: ptr.x - wx * next, y: ptr.y - wy * next });
  };

  // ---------- rotate-handle drag ----------

  const onRotateMove = (w: Pt, shift: boolean) => {
    const st = useStore.getState();
    const target = st.entities.find((e) => e.id === st.selectedId);
    if (!target || !ROTATABLE.has(target.type)) return;
    if (activeKind === 'elevation' && (target.type === 'door' || target.type === 'window')) return;
    const c = pivotOf(target);
    const cursorAng = (Math.atan2(w.y - c.y, w.x - c.x) * 180) / Math.PI; // -180..180
    const snap = (deg: number) => (shift ? Math.round(deg / 15) * 15 : Math.round(deg * 2) / 2);
    if (target.points && target.points.length === 4) {
      st.updateEntity(target.id, { points: rotateSegment(target.points, normalizeAngle(snap(cursorAng - 90))) }, true);
    } else if (target.type === 'door' || target.type === 'window') {
      st.updateEntity(target.id, { rotation: normalizeAngle(snap(cursorAng)) }, true);
    } else if (!target.points) {
      st.updateEntity(target.id, { rotation: normalizeAngle(snap(cursorAng + 90)) }, true);
    }
  };

  /** drag an active resize handle (world coords). Endpoint drags stretch along
   *  the segment's current axis (angle never changes); Alt frees the endpoint. */
  const onResizeMove = (w: Pt, free = false) => {
    const st = useStore.getState();
    const mode = resizeRef.current;
    const t = st.entities.find((e) => e.id === st.selectedId);
    if (!t || !mode) return;
    const sp = magnetPt(w); // smooth follow + near-grid lock (no hard yank)
    const r1 = (n: number) => Math.round(n * 10) / 10;
    if (t.points && t.points.length === 4 && mode.kind === 'point') {
      const p = [...t.points];
      if (free) {
        p[mode.idx * 2] = r1(sp.x);
        p[mode.idx * 2 + 1] = r1(sp.y);
      } else {
        const j = mode.idx === 0 ? 1 : 0; // fixed end
        const fx = p[j * 2], fy = p[j * 2 + 1];
        let dx = p[mode.idx * 2] - fx, dy = p[mode.idx * 2 + 1] - fy;
        const cur = Math.hypot(dx, dy);
        if (cur < 0.001) {
          // degenerate (zero-length) wall: no axis to keep, place freely
          p[mode.idx * 2] = r1(sp.x);
          p[mode.idx * 2 + 1] = r1(sp.y);
        } else {
          dx /= cur; dy /= cur;
          const along = Math.max(5, (sp.x - fx) * dx + (sp.y - fy) * dy);
          p[mode.idx * 2] = r1(fx + dx * along);
          p[mode.idx * 2 + 1] = r1(fy + dy * along);
        }
      }
      st.updateEntity(t.id, { points: p }, true);
      return;
    }
    if (isBoxLike(t.type, activeKind) && (mode.kind === 'corner' || mode.kind === 'edge')) {
      const w0 = t.width ?? 0, h0 = t.height ?? 0;
      if (w0 < 1 || h0 < 1) return;
      const c = { x: (t.x ?? 0) + w0 / 2, y: (t.y ?? 0) + h0 / 2 };
      const rad = ((t.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const dx = sp.x - c.x, dy = sp.y - c.y;
      const ml = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }; // cursor in unrotated local frame
      let nw = w0, nh = h0, nc = { x: 0, y: 0 };
      if (mode.kind === 'corner') {
        const ax = (-mode.sx * w0) / 2, ay = (-mode.sy * h0) / 2; // fixed opposite corner
        nw = Math.max(5, Math.abs(ml.x - ax));
        nh = Math.max(5, Math.abs(ml.y - ay));
        nc = { x: (ml.x + ax) / 2, y: (ml.y + ay) / 2 };
      } else if (mode.sx !== 0) {
        const ax = (-mode.sx * w0) / 2;
        nw = Math.max(5, Math.abs(ml.x - ax));
        nc = { x: (ml.x + ax) / 2, y: 0 };
      } else {
        const ay = (-mode.sy * h0) / 2;
        nh = Math.max(5, Math.abs(ml.y - ay));
        nc = { x: 0, y: (ml.y + ay) / 2 };
      }
      const cw = { x: c.x + nc.x * cos - nc.y * sin, y: c.y + nc.x * sin + nc.y * cos };
      st.updateEntity(t.id, { width: r1(nw), height: r1(nh), x: r1(cw.x - nw / 2), y: r1(cw.y - nh / 2) }, true);
      return;
    }
    if ((t.type === 'door' || t.type === 'window') && mode.kind === 'doorlen') {
      const len = Math.max(10, dist(t.x ?? 0, t.y ?? 0, sp.x, sp.y));
      st.updateEntity(t.id, { width: r1(len) }, true);
      return;
    }
    if (t.type === 'circle' && mode.kind === 'circle') {
      const cx = (t.x ?? 0) + (t.width ?? 0) / 2, cy = (t.y ?? 0) + (t.height ?? 0) / 2;
      const r = Math.max(5, dist(cx, cy, sp.x, sp.y));
      st.updateEntity(t.id, { x: r1(cx - r), y: r1(cy - r), width: r1(r * 2), height: r1(r * 2) }, true);
    }
  };

  /** resize-handle positions for the selected entity (world coords) */
  const resizeHandles = (): { hx: number; hy: number; mode: ResizeMode; cursor: string }[] | null => {
    if (!sel || s.tool !== 'select') return null;
    const out: { hx: number; hy: number; mode: ResizeMode; cursor: string }[] = [];
    if (sel.points && sel.points.length === 4) {
      const p = sel.points;
      out.push({ hx: p[0], hy: p[1], mode: { kind: 'point', idx: 0 }, cursor: 'move' });
      out.push({ hx: p[2], hy: p[3], mode: { kind: 'point', idx: 1 }, cursor: 'move' });
      return out;
    }
    if (sel.points) return null; // freehand: no handles
    if ((sel.type === 'door' || sel.type === 'window') && activeKind !== 'elevation') {
      const tip = pointAt(sel.x ?? 0, sel.y ?? 0, sel.rotation ?? 0, sel.width ?? 60);
      out.push({ hx: tip.x, hy: tip.y, mode: { kind: 'doorlen' }, cursor: 'ew-resize' });
      return out;
    }
    if (sel.type === 'circle') {
      const cx = (sel.x ?? 0) + (sel.width ?? 0) / 2, cy = (sel.y ?? 0) + (sel.height ?? 0) / 2;
      out.push({ hx: cx + (sel.width ?? 0) / 2, hy: cy, mode: { kind: 'circle' }, cursor: 'ew-resize' });
      return out;
    }
    if (isBoxLike(sel.type, activeKind)) {
      const w = sel.width ?? 0, h = sel.height ?? 0;
      const c = { x: (sel.x ?? 0) + w / 2, y: (sel.y ?? 0) + h / 2 };
      const rad = ((sel.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const toW = (lx: number, ly: number) => ({ x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos });
      ([
        [1, 1], [1, -1], [-1, 1], [-1, -1],
      ] as [1 | -1, 1 | -1][]).forEach(([sx, sy]) => {
        const p = toW((sx * w) / 2, (sy * h) / 2);
        out.push({ hx: p.x, hy: p.y, mode: { kind: 'corner', sx, sy }, cursor: sx * sy > 0 ? 'nwse-resize' : 'nesw-resize' });
      });
      ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [1 | -1 | 0, 1 | -1 | 0][]).forEach(([sx, sy]) => {
        const p = toW((sx * w) / 2, (sy * h) / 2);
        out.push({ hx: p.x, hy: p.y, mode: { kind: 'edge', sx, sy }, cursor: sx !== 0 ? 'ew-resize' : 'ns-resize' });
      });
      return out;
    }
    return null;
  };
  const rotateHandle = (): { hx: number; hy: number; ax: number; ay: number } | null => {
    if (!sel || !ROTATABLE.has(sel.type) || s.tool !== 'select') return null;
    if (activeKind === 'elevation' && (sel.type === 'door' || sel.type === 'window')) return null; // face-on, no rotation
    const off = 46 / cam.scale; // parked well clear of the wall so it never reads as an endpoint
    if (sel.points && sel.points.length === 4) {
      const p = sel.points;
      const mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2;
      const ang = angleOf(p[0], p[1], p[2], p[3]);
      const h = pointAt(mx, my, ang + 90, off);
      return { hx: h.x, hy: h.y, ax: mx, ay: my };
    }
    if (sel.points) return null; // freehand: no rotate handle
    if (sel.type === 'door' || sel.type === 'window') {
      const w = sel.width ?? 60;
      const end = pointAt(sel.x ?? 0, sel.y ?? 0, sel.rotation ?? 0, w + off * 0.6);
      const tip = pointAt(sel.x ?? 0, sel.y ?? 0, sel.rotation ?? 0, w);
      return { hx: end.x, hy: end.y, ax: tip.x, ay: tip.y };
    }
    if (isBox(sel.type)) {
      const c = pivotOf(sel);
      const h = (sel.height ?? 0) / 2;
      const rad = ((sel.rotation ?? 0) * Math.PI) / 180;
      const topX = c.x + h * Math.sin(rad);
      const topY = c.y - h * Math.cos(rad);
      return { hx: c.x + (h + off) * Math.sin(rad), hy: c.y - (h + off) * Math.cos(rad), ax: topX, ay: topY };
    }
    // text: pivot is position
    const h = pointAt(sel.x ?? 0, sel.y ?? 0, (sel.rotation ?? 0) - 90, off);
    return { hx: h.x, hy: h.y, ax: sel.x ?? 0, ay: sel.y ?? 0 };
  };

  // ---------- grid (follows the camera, so it never runs out while panning) ----------

  const grid = useMemo(() => {
    if (!s.showGrid) return null;
    const m = 100; // world-unit margin past the viewport edge
    const x0 = -cam.x / cam.scale - m;
    const x1 = (size.w - cam.x) / cam.scale + m;
    const y0 = -cam.y / cam.scale - m;
    const y1 = (size.h - cam.y) / cam.scale + m;
    let step = 25;
    while ((x1 - x0) / step > 300 || (y1 - y0) / step > 300) step *= 2; // cap node count when zoomed out
    const lines = [];
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const major = Math.round(x / (step * 4)) === x / (step * 4);
      lines.push(
        <Line key={'v' + x} points={[x, y0, x, y1]} stroke={major ? '#d1d5db' : '#eef2f7'} strokeWidth={major ? 1 / cam.scale : 0.6 / cam.scale} listening={false} />
      );
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      const major = Math.round(y / (step * 4)) === y / (step * 4);
      lines.push(
        <Line key={'h' + y} points={[x0, y, x1, y]} stroke={major ? '#d1d5db' : '#eef2f7'} strokeWidth={major ? 1 / cam.scale : 0.6 / cam.scale} listening={false} />
      );
    }
    // origin axes span the visible area too
    lines.push(<Line key="ax" points={[x0, 0, x1, 0]} stroke="#fecaca" strokeWidth={1 / cam.scale} listening={false} />);
    lines.push(<Line key="ay" points={[0, y0, 0, y1]} stroke="#bfdbfe" strokeWidth={1 / cam.scale} listening={false} />);
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.showGrid, cam.scale, cam.x, cam.y, size]);

  const preview = () => {
    if (!pending || !cursor) return null;
    const b = snapPt(cursor);
    const a = pending;
    if (s.tool === 'wall' || s.tool === 'line' || s.tool === 'dimension') {
      const sb = snapDrawAngle(a, b); // preview shows the straightened line WYSIWYG
      return (
        <>
          <Line points={[a.x, a.y, sb.x, sb.y]} stroke="#2563eb" strokeWidth={s.tool === 'wall' ? s.wallThickness : 2} dash={[8, 5]} listening={false} />
          <Text x={sb.x + 8} y={sb.y - 20} text={fmtLen(dist(a.x, a.y, sb.x, sb.y), s.unit)} fontSize={13} fill="#1d4ed8" listening={false} />
        </>
      );
    }
    if (s.tool === 'room' || s.tool === 'rect' || s.tool === 'circle') {
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (s.tool === 'circle') {
        const r = dist(a.x, a.y, b.x, b.y);
        return <Circle x={a.x} y={a.y} radius={r} stroke="#2563eb" dash={[8, 5]} listening={false} />;
      }
      return (
        <>
          <Rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={w} height={h} stroke="#2563eb" dash={[8, 5]} fill="rgba(37,99,235,0.1)" listening={false} />
          <Text x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y) - 18} text={`${fmtLen(w, s.unit)} × ${fmtLen(h, s.unit)}`} fontSize={13} fill="#1d4ed8" listening={false} />
        </>
      );
    }
    return null;
  };

  // ---------- entity rendering ----------

  /**
   * Thin strokes (1.5px dimension hairlines, pen sketches, thin walls) are
   * nearly impossible to click. A wide hitStrokeWidth on the same node keeps
   * them clickable without doubling the Konva node count.
   */
  const hitWidth = (visible: number) => Math.max(14 / cam.scale, visible + 2);

  const renderEntity = (e: CadEntity) => {
    if (!visible(e)) return null;
    const isSel = s.selectedId === e.id;
    const selProps = isSel ? { shadowColor: '#2563eb', shadowBlur: 8 } : {};
    const C = e.color ?? '#111827';
    const common = {
      onClick: (ev: Konva.KonvaEventObject<MouseEvent>) => {
        ev.cancelBubble = true;
        if (s.tool === 'eraser') { s.removeEntity(e.id); return; }
        if (s.tool === 'autodim') { s.toggleAutoDimFor(e.id); return; }
        s.setSelected(e.id);
      },
      onTap: () => {
        if (s.tool === 'eraser') s.removeEntity(e.id);
        else if (s.tool === 'autodim') s.toggleAutoDimFor(e.id);
        else s.setSelected(e.id);
      },
      draggable: s.tool === 'select',
      // Live grid-magnet while dragging (when Snap is on): lock onto a grid
      // line only within a few screen-px of it, otherwise track the cursor
      // exactly. Plain quantizing made EVERY drop land slightly off-cursor,
      // which is worse — drops must be either cursor-exact or grid-exact.
      dragBoundFunc: (pos: { x: number; y: number }) => magnetPt(pos),
      onDragStart: (ev: Konva.KonvaEventObject<DragEvent>) => { s.checkpoint(); dragNodeRef.current = ev.target; },
      ...selProps,
    };
    const dragPoints = {
      onDragEnd: (ev: Konva.KonvaEventObject<DragEvent>) => {
        dragNodeRef.current = null;
        const n = ev.target;
        const dx = n.x(), dy = n.y();
        n.position({ x: 0, y: 0 });
        if (e.points) {
          const moved = e.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
          s.updateEntity(e.id, { points: moved }, true);
        }
      },
    };
    const dragXY = {
      onDragEnd: (ev: Konva.KonvaEventObject<DragEvent>) => {
        dragNodeRef.current = null;
        s.updateEntity(e.id, { x: ev.target.x(), y: ev.target.y() }, true);
      },
    };
    if (e.type === 'wall' || e.type === 'line') {
      const p = e.points ?? [0, 0, 0, 0];
      const ang = angleOf(p[0], p[1], p[2], p[3]);
      const sw = (e.thickness ?? 6) + (isSel ? 2 : 0);
      return (
        <Group key={e.id}>
          {/* single node: wide hitStrokeWidth keeps thin walls clickable without doubling node count */}
          {/* butt caps: the bar ends exactly at the endpoint = exactly at the resize square */}
          <Line points={p} stroke={C} strokeWidth={sw} hitStrokeWidth={hitWidth(sw)} lineCap="butt" {...common} {...dragPoints} />
          {isSel && (
            <>
              <Line points={p} stroke="#2563eb" strokeWidth={1.5} dash={[6, 4]} listening={false} />
              <Text x={(p[0] + p[2]) / 2 + 8} y={(p[1] + p[3]) / 2 - 22} text={`${fmtLen(dist(p[0], p[1], p[2], p[3]), s.unit)} ∠ ${Math.round(normalizeAngle(ang))}°`} fontSize={12} fill="#1d4ed8" listening={false} />
            </>
          )}
        </Group>
      );
    }
    if (e.type === 'freehand') {
      const p = e.points ?? [];
      const sw = (e.thickness ?? 3) + (isSel ? 1 : 0);
      return (
        <Group key={e.id}>
          <Line points={p} stroke={C} strokeWidth={sw} hitStrokeWidth={hitWidth(sw)} lineCap="round" lineJoin="round" tension={0.5} {...common} {...dragPoints} />
          {isSel && <Text x={p[0] + 8} y={p[1] - 20} text={`sketch ${fmtLen(pathLen(p), s.unit)}`} fontSize={12} fill="#1d4ed8" listening={false} />}
        </Group>
      );
    }
    if (isBox(e.type)) {
      const w = e.width ?? 0, h = e.height ?? 0;
      const cx = (e.x ?? 0) + w / 2, cy = (e.y ?? 0) + h / 2;
      const stroke = e.color ?? (e.type === 'symbol' ? '#7c3aed' : '#2563eb');
      const def = e.type === 'symbol' ? SYMBOL_MAP[e.symbol ?? ''] : undefined;
      return (
        <Group key={e.id}>
          <Group
            x={cx} y={cy} rotation={e.rotation ?? 0}
            {...common}
            onDragEnd={(ev: Konva.KonvaEventObject<DragEvent>) => {
              dragNodeRef.current = null;
              s.updateEntity(e.id, { x: ev.target.x() - w / 2, y: ev.target.y() - h / 2 }, true);
            }}
          >
            {def ? (
              <Group scaleX={w / def.w} scaleY={h / def.h} offsetX={def.w / 2} offsetY={def.h / 2}>
                {def.draw(stroke)}
              </Group>
            ) : (
              <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={e.type === 'room' ? fade(stroke, '12') : 'transparent'} stroke={stroke} strokeWidth={isSel ? 3 : 2} />
            )}
          </Group>
          {e.type === 'room' && (
            <>
              {e.label && <Text x={cx - w / 2 + 8} y={cy - h / 2 + 8} text={e.label} fontSize={15} fill="#1e3a8a" listening={false} />}
              <Text x={cx - w / 2 + 8} y={cy - h / 2 + 28} text={roomArea(w, h, s.unit)} fontSize={11} fill="#475569" listening={false} />
            </>
          )}
          {e.type === 'symbol' && isSel && (
            <Text x={cx - w / 2} y={cy + h / 2 + 6} text={`${def?.name ?? 'Symbol'} ${fmtLen(w, s.unit)}×${fmtLen(h, s.unit)}`} fontSize={11} fill="#6d28d9" listening={false} />
          )}
        </Group>
      );
    }
    if (e.type === 'door') {
      if (activeKind === 'elevation') {
        const w = e.width ?? 90, h = e.height ?? 105;
        const dc = e.color ?? '#b45309';
        return (
          <Group key={e.id} x={e.x} y={e.y} {...common} {...dragXY}>
            <Rect width={w} height={h} fill="#fef3c7" stroke={dc} strokeWidth={isSel ? 3 : 2} />
            <Line points={[w * 0.18, 0, w * 0.18, h]} stroke={dc} strokeWidth={1} dash={[4, 3]} listening={false} />
            {isSel && <Text x={0} y={-18} text={`${fmtLen(w, s.unit)} × ${fmtLen(h, s.unit)}`} fontSize={12} fill="#92400e" listening={false} />}
          </Group>
        );
      }
      const w = e.width ?? 60;
      const dc = e.color ?? '#b45309';
      return (
        <Group key={e.id} x={e.x} y={e.y} rotation={e.rotation ?? 0} {...common} {...dragXY}>
          <Rect width={w} height={6} fill={dc} />
          <Arc angle={90} rotation={180} innerRadius={0} outerRadius={w} stroke={dc} dash={[5, 4]} strokeWidth={1.5} />
          {isSel && <Rect width={w} height={6} stroke="#2563eb" strokeWidth={1.5} />}
          {isSel && <Text x={0} y={-20} text={`${fmtLen(w, s.unit)} ∠ ${Math.round(normalizeAngle(e.rotation ?? 0))}°`} fontSize={12} fill="#92400e" listening={false} />}
        </Group>
      );
    }
    if (e.type === 'window') {
      if (activeKind === 'elevation') {
        const w = e.width ?? 100, h = e.height ?? 60;
        const wc = e.color ?? '#0284c7';
        return (
          <Group key={e.id} x={e.x} y={e.y} {...common} {...dragXY}>
            <Rect width={w} height={h} fill="#eff6ff" stroke={wc} strokeWidth={isSel ? 3 : 2} />
            <Line points={[w / 2, 0, w / 2, h]} stroke={wc} strokeWidth={1.2} listening={false} />
            <Line points={[0, h / 2, w, h / 2]} stroke={wc} strokeWidth={1.2} listening={false} />
            {isSel && <Text x={0} y={-18} text={`${fmtLen(w, s.unit)} × ${fmtLen(h, s.unit)}`} fontSize={12} fill="#0369a1" listening={false} />}
          </Group>
        );
      }
      const w = e.width ?? 100;
      const wc = e.color ?? '#0284c7';
      return (
        <Group key={e.id} x={e.x} y={e.y} rotation={e.rotation ?? 0} {...common} {...dragXY}>
          <Rect width={w} height={10} fill="white" stroke={wc} strokeWidth={2} />
          <Line points={[0, 5, w, 5]} stroke={wc} strokeWidth={1.5} />
          {isSel && <Rect width={w} height={10} stroke="#2563eb" dash={[5, 3]} />}
          {isSel && <Text x={0} y={-20} text={`${fmtLen(w, s.unit)} ∠ ${Math.round(normalizeAngle(e.rotation ?? 0))}°`} fontSize={12} fill="#0369a1" listening={false} />}
        </Group>
      );
    }
    if (e.type === 'dimension') {
      const p = e.points ?? [0, 0, 0, 0];
      const mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2;
      const rc = e.color ?? '#dc2626';
      const sw = isSel ? 2.5 : 1.5;
      return (
        <Group key={e.id}>
          {/* white halo: keeps the hairline readable as one continuous line over walls */}
          <Line points={p} stroke="white" strokeWidth={sw + 4} opacity={0.85} listening={false} />
          <Line points={p} stroke={rc} strokeWidth={sw} hitStrokeWidth={hitWidth(1.5)} {...common} {...dragPoints} />
          <Circle x={p[0]} y={p[1]} radius={3} fill={rc} listening={false} />
          <Circle x={p[2]} y={p[3]} radius={3} fill={rc} listening={false} />
          <Text x={mx + 6} y={my - 18} text={fmtLen(dist(p[0], p[1], p[2], p[3]), s.unit)} fontSize={13} fill="#b91c1c" listening={false} />
        </Group>
      );
    }
    if (e.type === 'text') {
      return <Text key={e.id} x={e.x} y={e.y} rotation={e.rotation ?? 0} text={e.label ?? ''} fontSize={e.fontSize ?? 16} fill={C} {...common} {...dragXY} />;
    }
    if (e.type === 'circle') {
      return <Circle key={e.id} x={(e.x ?? 0) + (e.width ?? 0) / 2} y={(e.y ?? 0) + (e.height ?? 0) / 2} radius={(e.width ?? 20) / 2} stroke={C} strokeWidth={2} {...common} {...dragXY} />;
    }
    return null;
  };

  const rh = rotateHandle();
  const rsHandles = resizeHandles();
  // Rebuilding 3000+ Konva nodes is the main lag source: only re-render the
  // entity list when the entities (or selection/tool/units/layers/zoom) change —
  // plain pointer movement must NOT rebuild it (see onPointerMove below).
  // renderEntity reads: selectedId, tool, unit, layers, activeKind, cam.scale.
  // Dimensions render after (on top of) everything else so a measurement lying
  // exactly on a wall stays one visible, grabbable line instead of breaking up.
  const entityEls = useMemo(
    () => [
      ...sceneEntities.filter((e) => e.type !== 'dimension').map(renderEntity),
      ...sceneEntities.filter((e) => e.type === 'dimension').map(renderEntity),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneEntities, s.selectedId, s.tool, s.unit, s.layers, activeKind, cam.scale]
  );
  const showDimBox = pending && (s.tool === 'wall' || s.tool === 'line' || s.tool === 'dimension' || s.tool === 'circle');
  const showRoomBox = pending && (s.tool === 'room' || s.tool === 'rect');
  const showDoorBox = !pending && (s.tool === 'door' || s.tool === 'window');
  const ghostDef = s.pendingSymbol ? SYMBOL_MAP[s.pendingSymbol] : undefined;

  const dimHint = s.unit === 'ft' ? `e.g. 10ft, 10'6", 36in` : `e.g. 3m, 250cm`;
  const activeSceneName = s.scenes.find((sc) => sc.id === s.activeSceneId)?.name ?? 'Floor Plan';

  return (
    <div ref={contRef} style={{ flex: 1, position: 'relative', background: '#f8fafc', overflow: 'hidden' }}>
      <Stage
        ref={stageRef}
        width={size.w || 800}
        height={size.h || 600}
        x={cam.x}
        y={cam.y}
        scaleX={cam.scale}
        scaleY={cam.scale}
        perfectDrawEnabled={false}
        draggable={s.tool === 'pan'}
        onDragEnd={(e) => { if (s.tool === 'pan' && e.target === e.target.getStage()) setCam((c) => ({ ...c, x: e.target.x(), y: e.target.y() })); }}
        onWheel={handleWheel}
        onPointerDown={(e) => {
          const ev = e.evt;
          pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          if (pointersRef.current.size > 1) {
            // second finger down: start pinch-zoom, cancel any in-progress stroke
            if (pointersRef.current.size === 2) {
              const [a, b] = [...pointersRef.current.values()];
              pinchRef.current = {
                d0: Math.hypot(b.x - a.x, b.y - a.y) || 1,
                m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                cam0: { ...cam },
              };
              stageRef.current?.draggable(false);
              if (pendingRef.current) setPending(null);
              if (penRef.current) setPenPts(null);
              rotatingRef.current = false;
              resizeRef.current = null;
            }
            return;
          }
          if (rotatingRef.current || resizeRef.current) return;
          const w = toWorld();
          if (!w) return;
          // furniture placement works from any non-pan tool
          if (s.pendingSymbol && s.tool !== 'pan') {
            placeSymbol(s.pendingSymbol, w);
            return;
          }
          if (s.tool === 'pen') {
            setPenPts([w.x, w.y]); // raw, no snap — freehand
            return;
          }
          if (s.tool === 'select' || s.tool === 'eraser' || s.tool === 'pan' || s.tool === 'autodim') {
            if (s.tool === 'select') s.setSelected(null);
            return; // autodim/eraser act on entity clicks, never on empty canvas
          }
          if (['wall', 'room', 'line', 'rect', 'circle', 'dimension'].includes(s.tool)) {
            if (!pendingRef.current) {
              setPending(snapPt(w));
              setDimText(''); setRoomWText(''); setRoomHText('');
            } else commitTwoClick(w);
          } else {
            handleClickPlace(w);
          }
        }}
        onPointerMove={(e) => {
          const ev = e.evt;
          if (pointersRef.current.has(ev.pointerId)) {
            pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          }
          const pinch = pinchRef.current;
          if (pinch && pointersRef.current.size >= 2) {            // pinch-zoom + two-finger pan: keep the world point under the
            // gesture midpoint stable while scaling about it
            const [a, b] = [...pointersRef.current.values()];
            const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const scale = Math.min(4, Math.max(0.2, pinch.cam0.scale * d / pinch.d0));
            const wx = (pinch.m0.x - pinch.cam0.x) / pinch.cam0.scale;
            const wy = (pinch.m0.y - pinch.cam0.y) / pinch.cam0.scale;
            setCam({ scale, x: m.x - wx * scale, y: m.y - wy * scale });
            return;
          }
          // a Konva object-drag is in flight: stay out of the way (no cursor
          // state, no re-renders) so the node tracks the pointer in real time
          if (dragNodeRef.current) return;
          const w = toWorld();
          if (!w) return;
          if (rotatingRef.current) { onRotateMove(w, e.evt.shiftKey); return; }
          if (resizeRef.current) { onResizeMove(w, e.evt.altKey); return; }
          if (s.tool === 'pen' && penRef.current) {
            const pts = penRef.current;
            const n = pts.length;
            if (n >= 2 && Math.hypot(w.x - pts[n - 2], w.y - pts[n - 1]) > 1.5 / cam.scale) {
              setPenPts([...pts, w.x, w.y]);
            }
          }
          if (s.tool === 'pan') return; // nothing on screen follows the cursor in pan mode
          // Perf: a setCursor per mousemove re-renders the whole canvas (incl.
          // thousands of imported lines). Only update when it actually moves.
          const sp = s.snap ? snapPt(w) : { x: Math.round(w.x), y: Math.round(w.y) };
          const prev = cursorRef.current;
          if (!prev || Math.abs(prev.x - sp.x) > 0.001 || Math.abs(prev.y - sp.y) > 0.001) setCursor(sp);
        }}
        onPointerUp={(e) => {
          endPointer(e.evt.pointerId);
          if (pinchRef.current) return; // pinch just ended / still active: never commit a stroke
          const pts = penRef.current;
          if (s.tool === 'pen' && pts && pts.length >= 4) {
            const id = uid();
            s.addEntity({ id, type: 'freehand', layer: 'walls', sceneId: s.activeSceneId, points: pts, thickness: s.penWidth, color: s.drawColor });
            s.setSelected(id);
          }
          setPenPts(null);
        }}
        onPointerLeave={(e) => {
          endPointer(e.evt.pointerId);
          setCursor(null);
        }}
        onPointerCancel={(e) => {
          endPointer(e.evt.pointerId);
          if (penRef.current) setPenPts(null);
          if (pendingRef.current) setPending(null);
        }}
      >
        {/* static grid on its own layer: entity drags/redraws never repaint 500 grid lines */}
        <KLayer listening={false}>
          {grid}
        </KLayer>
        <KLayer>
          {entityEls}
          {preview()}
          {/* live pen stroke */}
          {penPts && penPts.length >= 4 && (
            <Line points={penPts} stroke={s.drawColor} strokeWidth={s.penWidth} lineCap="round" lineJoin="round" tension={0.5} listening={false} />
          )}
          {/* furniture ghost */}
          {ghostDef && cursor && (
            <Group x={snapPt(cursor).x} y={snapPt(cursor).y} opacity={0.55} listening={false}>
              <Group offsetX={ghostDef.w / 2} offsetY={ghostDef.h / 2}>
                {ghostDef.draw('#7c3aed')}
              </Group>
            </Group>
          )}
          {pending && <Circle x={pending.x} y={pending.y} radius={4 / cam.scale} fill="#2563eb" listening={false} />}
          {/* resize handles (generous size for fingers/stylus) */}
          {rsHandles?.map((h, i) => {
            const sz = h.mode.kind === 'edge' ? 14 / cam.scale : 16 / cam.scale;
            return (
              <Rect
                key={'rs' + i}
                x={h.hx - sz / 2} y={h.hy - sz / 2} width={sz} height={sz}
                fill="white" stroke="#2563eb" strokeWidth={2 / cam.scale}
                cornerRadius={h.mode.kind === 'edge' ? sz / 2 : 1 / cam.scale}
                onPointerDown={(ev) => { ev.cancelBubble = true; s.checkpoint(); resizeRef.current = h.mode; }}
                onMouseEnter={(ev) => { ev.target.getStage()!.container().style.cursor = h.cursor; }}
                onMouseLeave={(ev) => { ev.target.getStage()!.container().style.cursor = 'default'; }}
              />
            );
          })}
          {/* rotate handle */}
          {rh && (
            <>
              <Line points={[rh.ax, rh.ay, rh.hx, rh.hy]} stroke="#2563eb" strokeWidth={1.2 / cam.scale} dash={[5 / cam.scale, 4 / cam.scale]} listening={false} />
              <Circle
                x={rh.hx} y={rh.hy} radius={12 / cam.scale} fill="white" stroke="#2563eb" strokeWidth={2 / cam.scale}
                onPointerDown={(ev) => { ev.cancelBubble = true; s.checkpoint(); rotatingRef.current = true; }}
                onMouseEnter={(ev) => { ev.target.getStage()!.container().style.cursor = 'grab'; }}
                onMouseLeave={(ev) => { ev.target.getStage()!.container().style.cursor = 'default'; }}
              />
              <Text x={rh.hx + 10 / cam.scale} y={rh.hy - 8 / cam.scale} text="⟳" fontSize={13 / cam.scale} fill="#2563eb" listening={false} />
            </>
          )}
          {cursor && s.tool !== 'select' && (
            <Text
              x={snapPt(cursor).x + 10} y={snapPt(cursor).y + 10}
              text={`${Math.round(snapPt(cursor).x)}, ${Math.round(snapPt(cursor).y)}`}
              fontSize={11 / cam.scale} fill="#64748b" listening={false}
            />
          )}
        </KLayer>
      </Stage>

      {/* typed-dimension overlay */}
      {(showDimBox || showRoomBox || showDoorBox) && (
        <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: 'white', border: '1px solid #bfdbfe', borderRadius: 10, padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, boxShadow: '0 4px 14px rgba(0,0,0,0.12)' }}>
          {showDimBox && (
            <>
              <span style={{ color: '#1d4ed8', fontWeight: 600 }}>{s.tool === 'circle' ? 'Radius:' : 'Length:'}</span>
              <input
                id="dim-input" value={dimText} onChange={(e) => setDimText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyTyped(); if (e.key === 'Escape') setPending(null); e.stopPropagation(); }}
                placeholder={dimHint} style={{ width: 130 }} autoFocus
              />
              <button onClick={applyTyped}>Set ↵</button>
            </>
          )}
          {showRoomBox && (
            <>
              <span style={{ color: '#1d4ed8', fontWeight: 600 }}>W:</span>
              <input id="dim-w-input" value={roomWText} onChange={(e) => setRoomWText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyTyped(); e.stopPropagation(); }} placeholder={s.unit === 'ft' ? '12ft' : '3.6m'} style={{ width: 80 }} autoFocus />
              <span style={{ color: '#1d4ed8', fontWeight: 600 }}>H:</span>
              <input id="dim-h-input" value={roomHText} onChange={(e) => setRoomHText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyTyped(); e.stopPropagation(); }} placeholder={s.unit === 'ft' ? '10ft' : '3m'} style={{ width: 80 }} />
              <button onClick={applyTyped}>Set ↵</button>
            </>
          )}
          {showDoorBox && (
            <>
              <span style={{ color: '#92400e', fontWeight: 600 }}>{s.tool === 'door' ? 'Door' : 'Window'} W:</span>
              <input value={doorWText} onChange={(e) => setDoorWText(e.target.value)} placeholder={dimHint} style={{ width: 90 }} />
              {activeKind === 'elevation' ? (
                <>
                  <span style={{ color: '#92400e', fontWeight: 600 }}>H:</span>
                  <input value={doorHText} onChange={(e) => setDoorHText(e.target.value)} placeholder={dimHint} style={{ width: 90 }} />
                </>
              ) : (
                <>
                  <span style={{ color: '#92400e', fontWeight: 600 }}>Angle:</span>
                  <input value={doorRotText} onChange={(e) => setDoorRotText(e.target.value)} placeholder="0" style={{ width: 55 }} />
                </>
              )}
              <span style={{ color: '#64748b', fontSize: 12 }}>click canvas to place</span>
            </>
          )}
        </div>
      )}

      {/* furniture placement banner */}
      {s.pendingSymbol && ghostDef && (
        <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 10, padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <span>{ghostDef.icon} Click canvas to place <b>{ghostDef.name}</b> ({ghostDef.size}) — click again for more, Esc when done</span>
          <button onClick={() => s.setPendingSymbol(null)}>Done</button>
        </div>
      )}

      <div style={{ position: 'absolute', left: 10, bottom: 10, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: '#475569' }}>
        {s.tool} • {Math.round(cam.scale * 100)}% • snap {s.snap ? `${s.grid}px` : 'off'} • {activeSceneName} • scale 50px=1m
        {pending && <span style={{ color: '#2563eb' }}> — type a dimension + Enter, or click second point (Esc cancels)</span>}
        {s.tool === 'pen' && <span style={{ color: '#2563eb' }}> — draw freehand, release to finish (no snap)</span>}
        {s.tool === 'autodim' && <span style={{ color: '#2563eb' }}> — click a wall/room/opening to pin its dimension, click again to remove (Esc exits)</span>}
        {!pending && sel && ROTATABLE.has(sel.type) && <span style={{ color: '#2563eb' }}> — drag ⟳ to rotate, □ ends resize along axis (Alt frees), R rotates</span>}
      </div>
      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 6 }}>
        <button onClick={() => s.undo()} disabled={!s.past.length} title="Undo (Ctrl+Z)">↩</button>
        <button onClick={() => s.redo()} disabled={!s.future.length} title="Redo (Ctrl+Shift+Z)">↪</button>
        <button onClick={() => setCam({ x: 0, y: 0, scale: 1 })}>Reset view</button>
        <button onClick={() => setCam((c) => ({ ...c, scale: Math.min(4, c.scale * 1.2) }))}>+</button>
        <button onClick={() => setCam((c) => ({ ...c, scale: Math.max(0.2, c.scale / 1.2) }))}>−</button>
      </div>
    </div>
  );
}

export { PX_PER_M };
