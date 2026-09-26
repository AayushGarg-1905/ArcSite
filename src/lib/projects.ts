import type { CadEntity, Scene } from '../types';

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  entityCount: number;
  /** small jpeg data-url for the project card */
  thumbnail?: string;
};

export type ProjectData = {
  entities: CadEntity[];
  /** the floor plan + any elevation views saved with this project */
  scenes: Scene[];
};

export interface ProjectBackend {
  readonly kind: 'local' | 'cloud';
  list(): Promise<ProjectMeta[]>;
  load(id: string): Promise<ProjectData | null>;
  save(meta: ProjectMeta, entities: CadEntity[], scenes: Scene[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export const newProjectId = () =>
  `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const DEFAULT_SCENES: Scene[] = [{ id: 'plan', name: 'Floor Plan', kind: 'plan' }];

/** grab the visible canvas as a full-size PNG data-url (for PNG export + thumbnails) */
export function captureStage(): string | null {
  try {
    const c = document.querySelector('canvas');
    return c ? c.toDataURL('image/png') : null;
  } catch {
    return null;
  }
}

/** downscale a data-url image to a small jpeg suitable for project cards / cloud docs */
export function makeThumb(full: string | null, maxW = 320): Promise<string | undefined> {
  if (!full) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d');
        if (!ctx) return resolve(undefined);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.65));
      } catch {
        resolve(undefined);
      }
    };
    img.onerror = () => resolve(undefined);
    img.src = full;
  });
}
