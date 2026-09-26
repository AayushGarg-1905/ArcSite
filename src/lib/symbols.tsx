import { Rect, Circle, Line, Ellipse } from 'react-konva';
import type { ReactNode } from 'react';

/**
 * Furniture / kitchen symbols, top view, drawn at REAL-WORLD size.
 * Canvas scale is 50px = 1m, so a 150cm double bed is 75px wide.
 * Each draw() renders inside a w×h box starting at (0,0); the canvas
 * scales it if the user resizes width/height.
 */
export type SymbolDef = {
    id: string;
    name: string;
    icon: string;
    w: number;
    h: number;
    size: string; // real-world size label
    draw: (c: string) => ReactNode;
};

const SW = 2; // outline width

export const SYMBOLS: SymbolDef[] = [
    {
        id: 'bedDouble', name: 'Double Bed', icon: '🛏️', w: 75, h: 100, size: `5' × 6'6"`,
        draw: (c) => (<>
            <Rect width={75} height={100} fill="white" stroke={c} strokeWidth={SW} />
            <Rect x={6} y={6} width={28} height={20} stroke={c} strokeWidth={1.2} />
            <Rect x={41} y={6} width={28} height={20} stroke={c} strokeWidth={1.2} />
            <Line points={[0, 32, 75, 32]} stroke={c} strokeWidth={1.2} />
        </>),
    },
    {
        id: 'bedSingle', name: 'Single Bed', icon: '🛌', w: 45, h: 95, size: `3' × 6'3"`,
        draw: (c) => (<>
            <Rect width={45} height={95} fill="white" stroke={c} strokeWidth={SW} />
            <Rect x={6} y={6} width={33} height={18} stroke={c} strokeWidth={1.2} />
            <Line points={[0, 30, 45, 30]} stroke={c} strokeWidth={1.2} />
        </>),
    },
    {
        id: 'sofa', name: 'Sofa', icon: '🛋️', w: 90, h: 40, size: `6' × 2'8"`,
        draw: (c) => (<>
            <Rect width={90} height={40} fill="white" stroke={c} strokeWidth={SW} />
            <Line points={[0, 10, 90, 10]} stroke={c} strokeWidth={1.5} />
            <Line points={[8, 0, 8, 40]} stroke={c} strokeWidth={1.2} />
            <Line points={[82, 0, 82, 40]} stroke={c} strokeWidth={1.2} />
            <Line points={[45, 10, 45, 40]} stroke={c} strokeWidth={1} dash={[3, 2]} />
        </>),
    },
    {
        id: 'dining', name: 'Dining Table', icon: '🍽️', w: 60, h: 80, size: `4' × 2'6" + chairs`,
        draw: (c) => (<>
            <Rect x={9} y={22} width={42} height={36} fill="white" stroke={c} strokeWidth={SW} />
            {[[9, 2], [33, 2], [9, 66], [33, 66]].map(([x, y], i) => (
                <Rect key={i} x={x} y={y} width={18} height={12} fill="white" stroke={c} strokeWidth={1.2} />
            ))}
        </>),
    },
    {
        id: 'chair', name: 'Chair', icon: '🪑', w: 23, h: 23, size: `1'6" sq`,
        draw: (c) => (<>
            <Rect width={23} height={23} fill="white" stroke={c} strokeWidth={SW} />
            <Line points={[0, 6, 23, 6]} stroke={c} strokeWidth={1.5} />
        </>),
    },
    {
        id: 'counter', name: 'Kitchen Counter', icon: '🧑‍🍳', w: 60, h: 30, size: `4' × 2' run`,
        draw: (c) => (<>
            <Rect width={60} height={30} fill="white" stroke={c} strokeWidth={SW} />
            <Line points={[0, 15, 60, 15]} stroke={c} strokeWidth={1} dash={[4, 3]} />
            <Line points={[20, 0, 20, 30]} stroke={c} strokeWidth={1} />
            <Line points={[40, 0, 40, 30]} stroke={c} strokeWidth={1} />
        </>),
    },
    {
        id: 'sink', name: 'Sink', icon: '🚰', w: 30, h: 23, size: `2' × 1'6"`,
        draw: (c) => (<>
            <Rect width={30} height={23} fill="white" stroke={c} strokeWidth={SW} />
            <Ellipse x={15} y={11.5} radiusX={10} radiusY={7} stroke={c} strokeWidth={1.2} />
            <Circle x={15} y={11.5} radius={1.5} fill={c} />
        </>),
    },
    {
        id: 'stove', name: 'Stove (4 burner)', icon: '🔥', w: 30, h: 30, size: `2' sq`,
        draw: (c) => (<>
            <Rect width={30} height={30} fill="white" stroke={c} strokeWidth={SW} />
            {[[8, 8], [22, 8], [8, 22], [22, 22]].map(([x, y], i) => (
                <Circle key={i} x={x} y={y} radius={5} stroke={c} strokeWidth={1.2} />
            ))}
        </>),
    },
    {
        id: 'toilet', name: 'Toilet', icon: '🚻', w: 30, h: 35, size: `2' × 2'4"`,
        draw: (c) => (<>
            <Rect width={30} height={8} fill="white" stroke={c} strokeWidth={SW} />
            <Ellipse x={15} y={22} radiusX={11} radiusY={12} fill="white" stroke={c} strokeWidth={SW} />
            <Ellipse x={15} y={23} radiusX={6.5} radiusY={7.5} stroke={c} strokeWidth={1.2} />
        </>),
    },
    {
        id: 'tub', name: 'Bathtub', icon: '🛁', w: 85, h: 35, size: `5'7" × 2'4"`,
        draw: (c) => (<>
            <Rect width={85} height={35} cornerRadius={14} fill="white" stroke={c} strokeWidth={SW} />
            <Rect x={6} y={6} width={73} height={23} cornerRadius={9} stroke={c} strokeWidth={1.2} />
            <Circle x={14} y={17.5} radius={2} stroke={c} strokeWidth={1.2} />
        </>),
    },
    {
        id: 'wardrobe', name: 'Wardrobe', icon: '🚪', w: 60, h: 30, size: `4' × 2' deep`,
        draw: (c) => (<>
            <Rect width={60} height={30} fill="white" stroke={c} strokeWidth={SW} />
            <Line points={[0, 0, 60, 30]} stroke={c} strokeWidth={1} />
            <Line points={[60, 0, 0, 30]} stroke={c} strokeWidth={1} />
            <Line points={[30, 0, 30, 30]} stroke={c} strokeWidth={1} />
        </>),
    },
    {
        id: 'plant', name: 'Plant', icon: '🪴', w: 25, h: 25, size: `~1'8" pot`,
        draw: (c) => (<>
            <Circle x={12.5} y={12.5} radius={11} fill="white" stroke={c} strokeWidth={SW} />
            <Circle x={12.5} y={12.5} radius={5.5} stroke={c} strokeWidth={1.2} />
            <Circle x={12.5} y={12.5} radius={1.6} fill={c} />
        </>),
    },
];

export const SYMBOL_MAP: Record<string, SymbolDef> = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));

/** color with alpha: '#rrggbb' + '14' => ~8% fill */
export function fade(hex: string, alphaHex = '14'): string {
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex + alphaHex;
    return hex;
}
