import DxfParser from 'dxf-parser';
import type { CadEntity } from '../types';
import { uid } from '../types';
import { dxfUnitsToPxScale, insunitsLabel } from './geometry';

export interface DxfImportResult {
    entities: CadEntity[];
    /** raw $INSUNITS code from the file header (0 = unitless/unspecified) */
    insunits: number;
    unitsLabel: string;
    /** scale applied to reach canvas px (1 = file units used as-is) */
    scale: number;
}

export async function importDxfFile(file: File): Promise<DxfImportResult> {
    const text = await file.text();
    const parser = new DxfParser();
    const dxf = parser.parseSync(text) as {
        entities?: Record<string, unknown>[];
        header?: Record<string, unknown>;
    } | null;
    // Exact dimensions: honor the file's declared units ($INSUNITS).
    const rawUnits = dxf?.header?.['$INSUNITS'];
    const insunits = typeof rawUnits === 'number' ? rawUnits : parseInt(String(rawUnits ?? '0'), 10);
    const scale = dxfUnitsToPxScale(Number.isFinite(insunits) ? insunits : 0);
    const out: CadEntity[] = [];
    // dxf-parser returns y-up; flip y so it looks right on screen
    const flip = (y: number) => -y;
    const list = (dxf?.entities ?? []) as unknown as Record<string, never>[];
    for (const raw of list) {
        const e = raw as unknown as {
            type?: string; vertices?: { x: number; y: number }[]; shape?: boolean;
            center?: { x: number; y: number }; radius?: number;
            startAngle?: number; endAngle?: number;
            startPoint?: { x: number; y: number }; text?: string;
        };
        try {
            if (e.type === 'LINE' && e.vertices && e.vertices.length >= 2) {
                out.push({
                    id: uid(), type: 'line', layer: 'walls',
                    points: [e.vertices[0].x, flip(e.vertices[0].y), e.vertices[1].x, flip(e.vertices[1].y)],
                });
            } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
                const v = (e.vertices ?? []) as { x: number; y: number }[];
                for (let i = 0; i < v.length - 1; i++) {
                    out.push({
                        id: uid(), type: 'line', layer: 'walls',
                        points: [v[i].x, flip(v[i].y), v[i + 1].x, flip(v[i + 1].y)],
                    });
                }
                if (e.shape && v.length > 2) {
                    const a = v[0], b = v[v.length - 1];
                    out.push({ id: uid(), type: 'line', layer: 'walls', points: [b.x, flip(b.y), a.x, flip(a.y)] });
                }
            } else if (e.type === 'CIRCLE' && e.center && e.radius) {
                out.push({
                    id: uid(), type: 'circle', layer: 'walls',
                    x: e.center.x, y: flip(e.center.y), width: e.radius * 2, height: e.radius * 2,
                });
            } else if (e.type === 'ARC' && e.center && e.radius !== undefined) {
                // approximate arc as line segments -> store as line chain start/end + keep as circle outline
                const sa = e.startAngle ?? 0, ea = e.endAngle ?? 0;
                out.push({
                    id: uid(), type: 'line', layer: 'walls',
                    points: [
                        e.center.x + (e.radius ?? 0) * Math.cos(sa),
                        flip(e.center.y + (e.radius ?? 0) * Math.sin(sa)),
                        e.center.x + (e.radius ?? 0) * Math.cos(ea),
                        flip(e.center.y + (e.radius ?? 0) * Math.sin(ea)),
                    ],
                });
            } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
                out.push({
                    id: uid(), type: 'text', layer: 'text',
                    x: e.startPoint?.x ?? 0, y: flip(e.startPoint?.y ?? 0),
                    label: e.text ?? 'TEXT', fontSize: 16,
                });
            }
        } catch { /* skip bad entity */ }
    }
    // exact-size scaling: convert file units -> canvas px (translation follows)
    if (scale !== 1) {
        for (const e of out) {
            if (e.points) e.points = e.points.map((v) => v * scale);
            if (e.x !== undefined) e.x *= scale;
            if (e.y !== undefined) e.y *= scale;
            if (e.width !== undefined) e.width *= scale;
            if (e.height !== undefined) e.height *= scale;
        }
    }
    // normalize: shift so min x/y near 100
    if (out.length) {
        let minX = Infinity, minY = Infinity;
        for (const e of out) {
            if (e.points) { minX = Math.min(minX, e.points[0], e.points[2]); minY = Math.min(minY, e.points[1], e.points[3]); }
            if (e.x !== undefined) { minX = Math.min(minX, e.x); minY = Math.min(minY, e.y ?? 0); }
        }
        const dx = 100 - minX, dy = 100 - minY;
        for (const e of out) {
            if (e.points) e.points = [e.points[0] + dx, e.points[1] + dy, e.points[2] + dx, e.points[3] + dy];
            if (e.x !== undefined) { e.x += dx; e.y = (e.y ?? 0) + dy; }
        }
    }
    return { entities: out, insunits: Number.isFinite(insunits) ? insunits : 0, unitsLabel: insunitsLabel(insunits), scale };
}

export function exportDxf(entities: CadEntity[]): string {
    const L: string[] = [];
    L.push('0', 'SECTION', '2', 'ENTITIES');
    for (const e of entities) {
        if (e.type === 'wall' || e.type === 'line' || e.type === 'dimension') {
            const p = e.points ?? [0, 0, 10, 10];
            L.push('0', 'LINE', '8', e.layer, '10', String(p[0]), '20', String(-p[1]), '11', String(p[2]), '21', String(-p[3]));
        } else if (e.type === 'room' || e.type === 'rect') {
            const x = e.x ?? 0, y = -(e.y ?? 0), w = e.width ?? 50, h = e.height ?? 50;
            L.push('0', 'LWPOLYLINE', '8', e.layer, '90', '4', '70', '1',
                '10', String(x), '20', String(y),
                '10', String(x + w), '20', String(y),
                '10', String(x + w), '20', String(y - h),
                '10', String(x), '20', String(y - h));
        } else if (e.type === 'circle') {
            L.push('0', 'CIRCLE', '8', e.layer, '10', String(e.x ?? 0), '20', String(-(e.y ?? 0)), '40', String((e.width ?? 20) / 2));
        } else if (e.type === 'text') {
            L.push('0', 'TEXT', '8', e.layer, '10', String(e.x ?? 0), '20', String(-(e.y ?? 0)), '40', '16', '1', e.label ?? '');
        } else if (e.type === 'door' || e.type === 'window') {
            const x = e.x ?? 0, y = e.y ?? 0, w = e.width ?? 60;
            L.push('0', 'LINE', '8', e.layer, '10', String(x), '20', String(-y), '11', String(x + w), '21', String(-y));
        } else if (e.type === 'freehand' && e.points && e.points.length >= 4) {
            const p = e.points;
            for (let i = 0; i + 3 < p.length; i += 2) {
                L.push('0', 'LINE', '8', e.layer, '10', String(p[i]), '20', String(-p[i + 1]), '11', String(p[i + 2]), '21', String(-p[i + 3]));
            }
        } else if (e.type === 'symbol') {
            const x = e.x ?? 0, y = -(e.y ?? 0), w = e.width ?? 50, h = e.height ?? 50;
            L.push('0', 'LWPOLYLINE', '8', e.layer, '90', '4', '70', '1',
                '10', String(x), '20', String(y),
                '10', String(x + w), '20', String(y),
                '10', String(x + w), '20', String(y - h),
                '10', String(x), '20', String(y - h));
            L.push('0', 'TEXT', '8', e.layer, '10', String(x), '20', String(y), '40', '12', '1', e.label ?? 'symbol');
        }
    }
    L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\n');
}

export function download(name: string, content: string | Blob) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function entitiesToSvg(entities: CadEntity[], w = 1200, h = 800): string {
    const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background:white">`];
    for (const e of entities) {
        if (e.type === 'wall' || e.type === 'line' || e.type === 'dimension') {
            const p = e.points ?? [0, 0, 0, 0];
            const sw = e.type === 'wall' ? (e.thickness ?? 6) : 2;
            const col = e.type === 'dimension' ? '#dc2626' : '#111';
            parts.push(`<line x1="${p[0]}" y1="${p[1]}" x2="${p[2]}" y2="${p[3]}" stroke="${col}" stroke-width="${sw}" />`);
        } else if (e.type === 'room' || e.type === 'rect') {
            parts.push(`<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="rgba(37,99,235,0.08)" stroke="#2563eb" stroke-width="2"/>`);
            if (e.label) parts.push(`<text x="${(e.x ?? 0) + 8}" y="${(e.y ?? 0) + 22}" font-size="14" fill="#1e3a8a">${e.label.replace(/</g, '&lt;')}</text>`);
        } else if (e.type === 'circle') {
            parts.push(`<ellipse cx="${(e.x ?? 0) + (e.width ?? 0) / 2}" cy="${(e.y ?? 0) + (e.height ?? 0) / 2}" rx="${(e.width ?? 0) / 2}" ry="${(e.height ?? 0) / 2}" fill="none" stroke="#111" stroke-width="2"/>`);
        } else if (e.type === 'text') {
            parts.push(`<text x="${e.x}" y="${e.y}" font-size="${e.fontSize ?? 16}" fill="#111">${(e.label ?? '').replace(/</g, '&lt;')}</text>`);
        } else if (e.type === 'door') {
            parts.push(`<g transform="translate(${e.x} ${e.y}) rotate(${e.rotation ?? 0})"><rect width="${e.width}" height="6" fill="#b45309"/><path d="M 0 6 A ${e.width} ${e.width} 0 0 1 ${e.width} ${6 - (e.width ?? 60)}" fill="none" stroke="#b45309" stroke-dasharray="4 3"/></g>`);
        } else if (e.type === 'window') {
            parts.push(`<g transform="translate(${e.x} ${e.y}) rotate(${e.rotation ?? 0})"><rect width="${e.width}" height="10" fill="white" stroke="#0284c7" stroke-width="2"/><line x1="0" y1="5" x2="${e.width}" y2="5" stroke="#0284c7"/></g>`);
        } else if (e.type === 'freehand' && e.points) {
            const pts = [];
            for (let i = 0; i + 1 < (e.points ?? []).length; i += 2) pts.push(`${e.points[i]},${e.points[i + 1]}`);
            parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${e.color ?? '#111'}" stroke-width="${e.thickness ?? 3}" stroke-linecap="round" stroke-linejoin="round"/>`);
        } else if (e.type === 'symbol') {
            parts.push(`<g transform="translate(${e.x} ${e.y}) rotate(${e.rotation ?? 0} ${(e.width ?? 0) / 2} ${(e.height ?? 0) / 2})"><rect width="${e.width}" height="${e.height}" fill="white" stroke="${e.color ?? '#7c3aed'}" stroke-width="2"/><text x="4" y="14" font-size="11" fill="#555">${(e.label ?? 'symbol').replace(/</g, '&lt;')}</text></g>`);
        }
    }
    parts.push('</svg>');
    return parts.join('\n');
}
