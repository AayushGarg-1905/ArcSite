export type ToolId =
  | 'select'
  | 'pan'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'dimension'
  | 'text'
  | 'line'
  | 'rect'
  | 'circle'
  | 'pen'
  | 'eraser'
  | 'autodim';

export type Layer = { id: string; name: string; color: string; visible: boolean; locked: boolean };

/**
 * A drawing surface. There is always exactly one 'plan' scene (the floor plan).
 * Each 'elevation' scene is a separate, independently-scaled canvas the user
 * creates for a specific wall/room view — e.g. "Living Room — North Wall".
 */
export type SceneKind = 'plan' | 'elevation';

export type Scene = {
  id: string;
  name: string;
  kind: SceneKind;
};

export type CadEntity = {
  id: string;
  type: 'wall' | 'room' | 'door' | 'window' | 'dimension' | 'text' | 'line' | 'rect' | 'circle' | 'freehand' | 'symbol';
  layer: string;
  /** which Scene this entity is drawn on. Undefined = legacy floor-plan entity (treated as the 'plan' scene). */
  sceneId?: string;
  // generic geometry (stage coords, 1px = 1cm by default, scaled for display)
  points?: number[]; // wall / line / dimension => [x1,y1,x2,y2]; freehand => polyline
  x?: number;
  y?: number;
  width?: number; // room/rect/door/window width in px
  height?: number; // room/rect height in px; also door/window opening HEIGHT in px when drawn on an elevation scene
  /** degrees. box entities (room/rect/door/window/text) rotate about their
   *  pivot; wall/line/dimension are stored unrotated as points and rotated
   *  by rewriting points (helpers in lib/geometry). Doors/windows drawn on an
   *  elevation scene ignore rotation — they're always drawn face-on. */
  rotation?: number;
  label?: string;
  thickness?: number; // wall thickness px / pen stroke width px
  color?: string; // stroke color (#rrggbb); closed shapes get a light fill of it
  fontSize?: number;
  symbol?: string; // symbol kind id when type === 'symbol';
  /** true when this dimension line was auto-generated (bulk removable via toggle) */
  autoDim?: boolean;
  /** id of the measured object when autoDim is true (click it again to remove) */
  autoFor?: string;
};

export const uid = () => Math.random().toString(36).slice(2, 9);
