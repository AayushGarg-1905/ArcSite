import type { CadEntity, Scene } from '../types';
import type { ProjectBackend, ProjectData, ProjectMeta } from './projects';
import { DEFAULT_SCENES } from './projects';

const INDEX_KEY = 'arcsite-projects-v1';
const DATA_PREFIX = 'arcsite-proj-';
const LEGACY_KEY = 'arcsite-clone-v1';

/** Multi-project storage in this browser's localStorage. Works with zero setup. */
export class LocalBackend implements ProjectBackend {
  readonly kind = 'local' as const;

  private readIndex(): ProjectMeta[] {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      const arr = raw ? (JSON.parse(raw) as ProjectMeta[]) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  private writeIndex(list: ProjectMeta[]) {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(list));
    } catch {
      // quota exceeded (too many thumbnails?) — retry without thumbnails
      try {
        localStorage.setItem(INDEX_KEY, JSON.stringify(list.map((m) => ({ ...m, thumbnail: undefined }))));
      } catch { /* ignore */ }
    }
  }

  /** one-time migration of the old single-drawing key into a real project */
  private migrateLegacy(): ProjectMeta[] {
    let list = this.readIndex();
    if (list.length > 0) return list;
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (raw) {
        const entities = JSON.parse(raw) as CadEntity[];
        if (Array.isArray(entities) && entities.length) {
          const now = Date.now();
          const meta: ProjectMeta = {
            id: `p_legacy_${now.toString(36)}`, name: 'My Home (imported)',
            createdAt: now, updatedAt: now, entityCount: entities.length,
          };
          localStorage.setItem(DATA_PREFIX + meta.id, JSON.stringify({ entities, scenes: DEFAULT_SCENES }));
          list = [meta];
          this.writeIndex(list);
          localStorage.removeItem(LEGACY_KEY);
        }
      }
    } catch { /* ignore */ }
    return list;
  }

  async list(): Promise<ProjectMeta[]> {
    const list = this.migrateLegacy();
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<ProjectData | null> {
    try {
      const raw = localStorage.getItem(DATA_PREFIX + id);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      // legacy format: a bare entities array with no scenes info
      if (Array.isArray(parsed)) {
        return { entities: parsed as CadEntity[], scenes: DEFAULT_SCENES };
      }
      const obj = parsed as { entities?: unknown; scenes?: unknown };
      const entities = Array.isArray(obj.entities) ? (obj.entities as CadEntity[]) : [];
      const scenes = Array.isArray(obj.scenes) && obj.scenes.length ? (obj.scenes as Scene[]) : DEFAULT_SCENES;
      return { entities, scenes };
    } catch {
      return null;
    }
  }

  async save(meta: ProjectMeta, entities: CadEntity[], scenes: Scene[]): Promise<void> {
    localStorage.setItem(DATA_PREFIX + meta.id, JSON.stringify({ entities, scenes }));
    const list = this.readIndex();
    const i = list.findIndex((m) => m.id === meta.id);
    if (i >= 0) list[i] = meta;
    else list.push(meta);
    this.writeIndex(list);
  }

  async remove(id: string): Promise<void> {
    localStorage.removeItem(DATA_PREFIX + id);
    this.writeIndex(this.readIndex().filter((m) => m.id !== id));
  }
}
