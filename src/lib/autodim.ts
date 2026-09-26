import type { CadEntity, SceneKind } from '../types';
import { uid } from '../types';
import { pointAt } from './geometry';

/** gap between the measured edge and its dimension line (px) */
const GAP = 40;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** dimension line parallel to (x1,y1)-(x2,y2), pushed out along (nx,ny) */
function offsetSeg(x1: number, y1: number, x2: number, y2: number, nx: number, ny: number, sceneId: string): CadEntity | null {
    if (Math.hypot(x2 - x1, y2 - y1) < 1) return null;
    return {
        id: uid(), type: 'dimension', layer: 'dims', sceneId, autoDim: true,
        points: [r1(x1 + nx * GAP), r1(y1 + ny * GAP), r1(x2 + nx * GAP), r1(y2 + ny * GAP)],
    };
}

/**
 * Dimension line for a free segment. Side rule (deterministic, no guessing):
 * horizontal-ish segments go below (+y), vertical ones go right (+x).
 */
function segDim(x1: number, y1: number, x2: number, y2: number, sceneId: string): CadEntity | null {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const n1 = { x: -dy / len, y: dx / len };
    const n2 = { x: dy / len, y: -dx / len };
    const n = n1.y > 0.0001 ? n1 : n2.y > 0.0001 ? n2 : n1.x > 0 ? n1 : n2;
    return offsetSeg(x1, y1, x2, y2, n.x, n.y, sceneId);
}

/** width (bottom edge, pushed down/out) + height (right edge, pushed right/out) for a box */
function boxDims(e: CadEntity, sceneId: string): CadEntity[] {
    const w = e.width ?? 0, h = e.height ?? 0;
    if (w < 1 || h < 1) return [];
    const rad = ((e.rotation ?? 0) * Math.PI) / 180;
    const ux = { x: Math.cos(rad), y: Math.sin(rad) }; // local +x (width dir)
    const uy = { x: -Math.sin(rad), y: Math.cos(rad) }; // local +y (height dir)
    const o = { x: e.x ?? 0, y: e.y ?? 0 };
    const at = (i: number, j: number) => ({
        x: o.x + i * w * ux.x + j * h * uy.x,
        y: o.y + i * w * ux.y + j * h * uy.y,
    });
    const out: CadEntity[] = [];
    const b0 = at(0, 1), b1 = at(1, 1);
    const r0 = at(1, 0), r1p = at(1, 1);
    const wd = offsetSeg(b0.x, b0.y, b1.x, b1.y, uy.x, uy.y, sceneId);
    const hd = offsetSeg(r0.x, r0.y, r1p.x, r1p.y, ux.x, ux.y, sceneId);
    if (wd) out.push(wd);
    if (hd) out.push(hd);
    return out;
}

/**
 * Auto-measure everything dimensionable on one scene: walls/lines by segment,
 * rooms/rects (and face-on doors/windows on elevations) by W+H, plan
 * doors/windows by opening width. Skips existing dimensions, text, circles,
 * sketches and furniture. Returns new `dimension` entities (autoDim: true).
 */
export function autoDimensions(entities: CadEntity[], sceneId: string, kind: SceneKind): CadEntity[] {
    const out: CadEntity[] = [];
    for (const e of entities) {
        if ((e.sceneId ?? 'plan') !== sceneId) continue;
        if (e.type === 'wall' || e.type === 'line') {
            const p = e.points;
            if (!p || p.length !== 4) continue;
            const d = segDim(p[0], p[1], p[2], p[3], sceneId);
            if (d) out.push(d);
        } else if (e.type === 'room' || e.type === 'rect' || (kind === 'elevation' && (e.type === 'door' || e.type === 'window'))) {
            out.push(...boxDims(e, sceneId));
        } else if (e.type === 'door' || e.type === 'window') {
            const w = e.width ?? 0;
            if (w < 1) continue;
            const tip = pointAt(e.x ?? 0, e.y ?? 0, e.rotation ?? 0, w);
            const d = segDim(e.x ?? 0, e.y ?? 0, tip.x, tip.y, sceneId);
            if (d) out.push(d);
        }
    }
    return out;
}
