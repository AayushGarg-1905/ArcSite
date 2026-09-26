export const snapVal = (v: number, grid: number, enabled: boolean) =>
    enabled ? Math.round(v / grid) * grid : v;

export const dist = (x1: number, y1: number, x2: number, y2: number) =>
    Math.hypot(x2 - x1, y2 - y1);

/** total length of a polyline point array */
export function pathLen(points: number[]): number {
    let d = 0;
    for (let i = 0; i + 3 < points.length; i += 2) d += Math.hypot(points[i + 2] - points[i], points[i + 3] - points[i + 1]);
    return d;
}

/** px -> display length. 50px = 1m default scale */
export const PX_PER_M = 50;
export const M_PER_FT = 0.3048;

export function fmtLen(px: number, unit: 'm' | 'ft'): string {
    const m = px / PX_PER_M;
    if (unit === 'm') {
        if (m < 1) return `${Math.round(m * 100)} cm`;
        return `${m.toFixed(2)} m`;
    }
    const ft = m / M_PER_FT;
    if (ft < 1) return `${Math.round(ft * 12)} in`;
    return `${ft.toFixed(2)} ft`;
}

export function roomArea(w: number, h: number, unit: 'm' | 'ft'): string {
    const m2 = (w / PX_PER_M) * (h / PX_PER_M);
    if (unit === 'm') return `${m2.toFixed(2)} m² (${Math.round(m2 * 10.764)} ft²)`;
    const ft2 = m2 * 10.7639;
    return `${ft2.toFixed(1)} ft²`;
}

// ---------- rotation math ----------

export const normalizeAngle = (deg: number) => ((deg % 360) + 360) % 360;

/** angle of segment in degrees, -180..180 */
export const angleOf = (x1: number, y1: number, x2: number, y2: number) =>
    (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;

export const pointAt = (x: number, y: number, angleDeg: number, len: number) => {
    const r = (angleDeg * Math.PI) / 180;
    return { x: x + Math.cos(r) * len, y: y + Math.sin(r) * len };
};

/** rotate [x1,y1,x2,y2] segment to an absolute angle, keeping midpoint fixed */
export function rotateSegment(points: number[], targetAngleDeg: number): number[] {
    const [x1, y1, x2, y2] = points;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const a = pointAt(0, 0, targetAngleDeg, len / 2);
    const b = pointAt(0, 0, targetAngleDeg + 180, len / 2);
    return [mx + a.x, my + a.y, mx + b.x, my + b.y];
}

/** set segment length, keeping start point fixed and current angle */
export function setSegmentLength(points: number[], lenPx: number): number[] {
    const [x1, y1, x2, y2] = points;
    const ang = angleOf(x1, y1, x2, y2);
    const p = pointAt(x1, y1, Number.isFinite(ang) ? ang : 0, lenPx);
    return [x1, y1, p.x, p.y];
}

// ---------- unit-aware parsing ----------

/**
 * Parse a typed dimension like "10", "10ft", "10'", `10'6"`, "6in",
 * "3m", "250cm", "12mm" into pixels. Returns null when invalid.
 * Bare numbers are interpreted in the current unit.
 */
export function parseLenToPx(
    input: string,
    unit: 'm' | 'ft',
    opts: { min?: number } = {}
): number | null {
    const min = opts.min ?? 0;
    const raw = input.trim().toLowerCase().replace(/,/g, '');
    if (!raw) return null;

    const toPxFromM = (m: number) => m * PX_PER_M;

    // feet + inches combo: 10'6", 10'6, 10' 6.5", 12'
    const fi = raw.match(/^(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)?\s*("|in|inch|inches)?$/);
    if (fi) {
        const feet = parseFloat(fi[1]);
        const inch = fi[2] ? parseFloat(fi[2]) : 0;
        if (!Number.isFinite(feet) || !Number.isFinite(inch)) return null;
        const px = toPxFromM(feet * M_PER_FT + inch * 0.0254);
        return px > min ? px : null;
    }

    const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet|in|inch|inches|"|')?$/);
    if (!m) return null;
    const val = parseFloat(m[1]);
    if (!Number.isFinite(val)) return null;
    const suffix = (m[2] ?? '').trim();
    let meters: number;
    switch (suffix) {
        case 'mm': meters = val / 1000; break;
        case 'cm': meters = val / 100; break;
        case 'm': meters = val; break;
        case 'ft':
        case 'feet':
        case "'": meters = val * M_PER_FT; break;
        case 'in':
        case 'inch':
        case 'inches':
        case '"': meters = (val / 12) * M_PER_FT; break;
        default:
            meters = unit === 'm' ? val : val * M_PER_FT;
    }
    const px = toPxFromM(meters);
    if (!Number.isFinite(px) || !(px > min)) return null;
    return px;
}

/** Parse a coordinate value (allows negatives/zero), bare numbers in current unit. */
export function parseCoordToPx(input: string, unit: 'm' | 'ft'): number | null {
    return parseLenToPx(input, unit, { min: -Infinity });
}

/** Format px as a short editable number in the current unit (no suffix). */
export function lenToUnitNum(px: number, unit: 'm' | 'ft'): string {
    const m = px / PX_PER_M;
    const v = unit === 'm' ? m : m / M_PER_FT;
    return String(Math.round(v * 100) / 100);
}

// ---------- wall thickness in real architectural units ----------

/**
 * Parse wall thickness like `9"`, `9in`, `230mm`, `23cm`.
 * A bare number means inches (ft mode) or cm (metric mode) — nobody
 * specifies a 9-foot-thick wall, so feet/meters are never the default.
 */
export function parseThicknessToPx(input: string, unit: 'm' | 'ft'): number | null {
    const raw = input.trim().toLowerCase();
    if (!raw) return null;
    const hasUnit = /(mm|cm|m|ft|feet|in|inch|inches|"|')$/.test(raw);
    const withUnit = hasUnit ? raw : `${raw}${unit === 'ft' ? 'in' : 'cm'}`;
    return parseLenToPx(withUnit, unit);
}

/** Format px thickness as an editable number: inches (ft mode) or cm (metric). */
export function thicknessToUnitNum(px: number, unit: 'm' | 'ft'): string {
    if (unit === 'ft') {
        const inch = ((px / PX_PER_M) * 100) / 2.54;
        return String(Math.round(inch * 10) / 10);
    }
    const cm = (px / PX_PER_M) * 100;
    return String(Math.round(cm * 10) / 10);
}

export const thicknessUnitLabel = (unit: 'm' | 'ft') =>
    unit === 'ft' ? 'in (e.g. 9", 4.5)' : 'cm (e.g. 23, 11.5)';

// ---------- DXF import units ($INSUNITS) ----------

/** AutoCAD $INSUNITS code -> meters per unit. 0 = unitless. */
const INSUNIT_TO_M: Record<number, number> = {
    1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01, 6: 1,
    7: 1000, 8: 2.54e-8, 9: 2.54e-5, 10: 0.9144, 11: 1e-10,
    12: 1e-9, 13: 1e-6, 14: 0.1, 15: 10, 16: 100, 17: 1e9,
    18: 1.495978707e11, 19: 9.4607304725808e15, 20: 3.08567758149137e16,
    21: 1200 / 3937,
};

export const INSUNIT_LABELS: Record<number, string> = {
    0: 'unitless', 1: 'inches', 2: 'feet', 3: 'miles', 4: 'millimeters',
    5: 'centimeters', 6: 'meters', 7: 'kilometers', 8: 'microinches',
    9: 'mils', 10: 'yards', 11: 'angstroms', 12: 'nanometers',
    13: 'microns', 14: 'decimeters', 15: 'dekameters', 16: 'hectometers',
    17: 'gigameters', 18: 'astronomical units', 19: 'light years',
    20: 'parsecs', 21: 'US survey feet',
};

/**
 * Scale factor converting DXF drawing units to canvas px (50px = 1m).
 * Unitless/unknown (incl. our own DXF exports, which are already px)
 * returns 1 so round-trips stay exact.
 */
export function dxfUnitsToPxScale(insunits: unknown): number {
    const code = typeof insunits === 'number' ? insunits : parseInt(String(insunits ?? '0'), 10);
    if (!Number.isFinite(code) || code === 0) return 1;
    const toM = INSUNIT_TO_M[code];
    if (toM === undefined) return 1;
    return toM * PX_PER_M;
}

export const insunitsLabel = (insunits: unknown): string => {
    const code = typeof insunits === 'number' ? insunits : parseInt(String(insunits ?? '0'), 10);
    return INSUNIT_LABELS[code] ?? 'unitless';
};
