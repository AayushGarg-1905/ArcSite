import { create } from 'zustand';
import type { CadEntity, Layer, Scene, ToolId } from './types';
import { uid } from './types';
import { LocalBackend } from './lib/storeLocal';
import { CloudBackend, CLOUD_READY } from './lib/cloud';
import { captureStage, makeThumb, newProjectId, DEFAULT_SCENES, type ProjectMeta } from './lib/projects';
import { autoDimensions } from './lib/autodim';
import { useUI } from './lib/ui';

const MAX_HISTORY = 60;

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';
export type BackendKind = 'local' | 'cloud';

type State = {
  entities: CadEntity[];
  layers: Layer[];
  activeLayer: string;
  tool: ToolId;
  selectedId: string | null;
  grid: number;
  snap: boolean;
  showGrid: boolean;
  unit: 'm' | 'ft';
  wallThickness: number;
  view: 'plan' | 'elevation';
  // scenes: the floor plan + any elevation views the user has created
  scenes: Scene[];
  activeSceneId: string;
  // sketch settings
  drawColor: string;
  penWidth: number;
  pendingSymbol: string | null;
  // history
  past: CadEntity[][];
  future: CadEntity[][];
  // local canvas gesture state that lives outside the store listens here:
  // bump to cancel any in-progress stroke/pending first-click/drag
  cancelSeq: number;
  cancelAll: () => void;
  // projects
  projects: ProjectMeta[];
  currentId: string | null;
  currentName: string;
  currentBackend: BackendKind;
  backendTab: BackendKind;
  userEmail: string | null;
  uid: string | null;
  cloudReady: boolean;
  saveStatus: SaveStatus;
  projectsOpen: boolean;
  addEntity: (e: CadEntity) => void;
  updateEntity: (id: string, patch: Partial<CadEntity>, transient?: boolean) => void;
  removeEntity: (id: string) => void;
  /** move the selected object by dx/dy px (arrow keys on laptop, D-pad on touch) */
  nudge: (dx: number, dy: number) => void;
  /** auto-dim mode: pin/remove measurement lines for one object (each tap = one undo step) */
  toggleAutoDimFor: (id: string) => void;
  setEntities: (e: CadEntity[]) => void;
  setTool: (t: ToolId) => void;
  setSelected: (id: string | null) => void;
  setGrid: (n: number) => void;
  setSnap: (b: boolean) => void;
  setShowGrid: (b: boolean) => void;
  setUnit: (u: 'm' | 'ft') => void;
  setWallThickness: (n: number) => void;
  setDrawColor: (c: string) => void;
  setPenWidth: (n: number) => void;
  setPendingSymbol: (id: string | null) => void;
  addLayer: (name: string) => void;
  toggleLayer: (id: string, key: 'visible' | 'locked') => void;
  clear: () => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  // scenes (plan / elevation views)
  setActiveScene: (id: string) => void;
  addElevationScene: (name: string, wallWidthPx: number, wallHeightPx: number) => void;
  renameScene: (id: string, name: string) => void;
  deleteScene: (id: string) => void;
  // projects
  setProjectsOpen: (open: boolean) => void;
  setBackendTab: (t: BackendKind) => void;
  setAuth: (uid: string | null, email: string | null) => void;
  refreshProjects: () => void;
  createProject: (name: string) => void;
  openProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  duplicateProject: (id: string) => void;
  deleteProject: (id: string) => void;
  uploadToCloud: (id: string) => void;
  saveCurrent: () => void;
};

/** push previous entities onto undo stack (drops redo stack) */
function withHistory(s: Pick<State, 'entities' | 'past'>, entities: CadEntity[]) {
  return {
    entities,
    past: [...s.past.slice(-(MAX_HISTORY - 1)), s.entities],
    future: [] as CadEntity[][],
  };
}

const DEFAULT_LAYERS: Layer[] = [
  { id: 'walls', name: 'Walls', color: '#1f2937', visible: true, locked: false },
  { id: 'rooms', name: 'Rooms', color: '#2563eb', visible: true, locked: false },
  { id: 'doors', name: 'Doors & Windows', color: '#b45309', visible: true, locked: false },
  { id: 'dims', name: 'Dimensions', color: '#dc2626', visible: true, locked: false },
  { id: 'text', name: 'Text', color: '#059669', visible: true, locked: false },
  { id: 'furniture', name: 'Furniture', color: '#7c3aed', visible: true, locked: false },
];

const seed: CadEntity[] = [
  { id: uid(), type: 'room', layer: 'rooms', x: 100, y: 80, width: 300, height: 220, label: 'Living Room' },
  { id: uid(), type: 'room', layer: 'rooms', x: 400, y: 80, width: 220, height: 220, label: 'Bedroom' },
  { id: uid(), type: 'wall', layer: 'walls', points: [100, 300, 620, 300], thickness: 8 },
  { id: uid(), type: 'door', layer: 'doors', x: 330, y: 292, width: 60, rotation: 0 },
  { id: uid(), type: 'window', layer: 'doors', x: 180, y: 292, width: 90, rotation: 0 },
];

// ---------- project backends ----------

const localBackend = new LocalBackend();
const cloudCache = new Map<string, CloudBackend>();

export function backendFor(kind: BackendKind, uid: string | null) {
  if (kind === 'cloud' && uid) {
    let b = cloudCache.get(uid);
    if (!b) {
      b = new CloudBackend(uid);
      cloudCache.set(uid, b);
    }
    return b;
  }
  return localBackend;
}

let saveInFlight = false;
let saveQueued = false;

/** write the current drawing to its owning backend (awaits any in-flight save) */
async function persistNow(): Promise<void> {
  const st = useStore.getState();
  if (!st.currentId) return;
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  useStore.setState({ saveStatus: 'saving' });
  try {
    const thumb = await makeThumb(captureStage());
    const s = useStore.getState();
    if (!s.currentId) return;
    const backend = backendFor(s.currentBackend, s.uid);
    const prev = (await backend.list()).find((m) => m.id === s.currentId);
    const meta: ProjectMeta = {
      id: s.currentId,
      name: s.currentName || 'Untitled',
      createdAt: prev?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      entityCount: s.entities.length,
      thumbnail: thumb ?? prev?.thumbnail,
    };
    await backend.save(meta, s.entities, s.scenes);
    useStore.setState({ saveStatus: 'saved' });
    const cur = useStore.getState();
    if (cur.backendTab === s.currentBackend) {
      backend
        .list()
        .then((list) => useStore.setState({ projects: list }))
        .catch(() => { });
    }
  } catch {
    useStore.setState({ saveStatus: 'error' });
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      await persistNow();
    }
  }
}

/** flush pending autosave (e.g. before switching project / closing tab) */
export const flushSave = () => persistNow();

export const useStore = create<State>()((set, get) => ({
  entities: seed,
  layers: DEFAULT_LAYERS,
  activeLayer: 'walls',
  tool: 'select', // safe default: nothing draws until the user arms a tool
  selectedId: null,
  grid: 10,
  snap: true,
  showGrid: true,
  unit: 'ft',
  wallThickness: 11.43, // px — default 9" wall (50px = 1m). Edited in inch/cm in UI.
  view: 'plan',
  scenes: DEFAULT_SCENES,
  activeSceneId: 'plan',
  drawColor: '#111827',
  penWidth: 3,
  pendingSymbol: null,
  past: [],
  future: [],
  cancelSeq: 0,
  projects: [],
  currentId: null,
  currentName: '',
  currentBackend: 'local',
  backendTab: 'local',
  userEmail: null,
  uid: null,
  cloudReady: CLOUD_READY,
  saveStatus: 'saved',
  projectsOpen: false,
  addEntity: (e) => set((s) => ({ ...withHistory(s, [...s.entities, e]) })),
  updateEntity: (id, patch, transient = false) =>
    set((s) => {
      const cur = s.entities.find((e) => e.id === id);
      // no-op guard: tabbing through panel fields without changing anything
      // must not pollute the undo stack with identical states
      const same = (a: unknown, b: unknown) =>
        a === b ||
        (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === (b as unknown[])[i]));
      if (cur && (Object.keys(patch) as (keyof CadEntity)[]).every((k) => same(cur[k], patch[k]))) return s;
      const entities = s.entities.map((e) => (e.id === id ? { ...e, ...patch } : e));
      if (transient) return { entities };
      return withHistory(s, entities);
    }),
  removeEntity: (id) =>
    set((s) => {
      if (!s.entities.some((e) => e.id === id)) return s; // tap+click double-fire on touch: ignore the echo
      return { ...withHistory(s, s.entities.filter((e) => e.id !== id)), selectedId: null };
    }),
  nudge: (dx, dy) =>
    set((s) => {
      const src = s.entities.find((e) => e.id === s.selectedId);
      if (!src || (!dx && !dy)) return s;
      const patch = src.points
        ? { points: src.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) }
        : { x: (src.x ?? 0) + dx, y: (src.y ?? 0) + dy };
      return withHistory(s, s.entities.map((e) => (e.id === src.id ? { ...e, ...patch } : e)));
    }),
  toggleAutoDimFor: (id) =>
    set((s) => {
      const src = s.entities.find((e) => e.id === id);
      if (!src || (src.sceneId ?? 'plan') !== s.activeSceneId) return s;
      const inScene = (e: CadEntity) => (e.sceneId ?? 'plan') === s.activeSceneId;
      // tapping an auto dimension itself removes just that line
      if (src.autoDim) {
        return withHistory(s, s.entities.filter((e) => e.id !== id));
      }
      // tapping the measured object again removes its pinned lines
      const owned = s.entities.filter((e) => inScene(e) && e.autoDim && e.autoFor === id);
      if (owned.length) {
        const drop = new Set(owned.map((e) => e.id));
        return withHistory(s, s.entities.filter((e) => !drop.has(e.id)));
      }
      const kind = s.scenes.find((sc) => sc.id === s.activeSceneId)?.kind ?? 'plan';
      const dims = autoDimensions([src], s.activeSceneId, kind).map((d) => ({ ...d, autoFor: id }));
      if (!dims.length) return s; // text, circles, sketches, furniture: nothing to measure
      return withHistory(s, [...s.entities, ...dims]);
    }),
  setEntities: (entities) => set((s) => ({ ...withHistory(s, entities), selectedId: null })),
  setTool: (tool) => set({ tool, pendingSymbol: null }),
  cancelAll: () => set((s) => ({ cancelSeq: (s.cancelSeq ?? 0) + 1 })),
  setSelected: (selectedId) => set({ selectedId }),
  setGrid: (grid) => set({ grid }),
  setSnap: (snap) => set({ snap }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setUnit: (unit) => set({ unit }),
  setWallThickness: (wallThickness) => set({ wallThickness }),
  setDrawColor: (drawColor) => set({ drawColor }),
  setPenWidth: (penWidth) => set({ penWidth }),
  setPendingSymbol: (pendingSymbol) => set({ pendingSymbol }),
  addLayer: (name) =>
    set((s) => ({ layers: [...s.layers, { id: uid(), name, color: '#6b7280', visible: true, locked: false }] })),
  toggleLayer: (id, key) =>
    set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, [key]: !l[key] } : l)) })),
  // "New" only clears the scene you're currently looking at — it won't wipe your
  // floor plan while you're sketching an elevation, or vice versa.
  clear: () =>
    set((s) => ({
      ...withHistory(s, s.entities.filter((e) => (e.sceneId ?? 'plan') !== s.activeSceneId)),
      selectedId: null,
    })),
  checkpoint: () =>
    set((s) => ({ past: [...s.past.slice(-(MAX_HISTORY - 1)), s.entities], future: [] })),
  undo: () =>
    set((s) => {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return {
        entities: prev,
        past: s.past.slice(0, -1),
        future: [s.entities, ...s.future].slice(0, MAX_HISTORY),
        selectedId: null,
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return s;
      const [next, ...rest] = s.future;
      return {
        entities: next,
        past: [...s.past, s.entities].slice(-MAX_HISTORY),
        future: rest,
        selectedId: null,
      };
    }),
  // ---------- scenes ----------
  setActiveScene: (id) => {
    const scene = get().scenes.find((sc) => sc.id === id);
    if (!scene) return;
    set({ activeSceneId: id, view: scene.kind, selectedId: null });
  },
  addElevationScene: (name, wallWidthPx, wallHeightPx) => {
    const id = `elev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const trimmed = name.trim() || 'Elevation';
    const scene: Scene = { id, name: trimmed, kind: 'elevation' };
    // seed the new scene with a wall-face rect at the given real dimensions,
    // so there's an immediate, correctly-scaled boundary to draw within
    const wallEntity: CadEntity = {
      id: uid(), type: 'rect', layer: 'walls', sceneId: id,
      x: 100, y: 100, width: wallWidthPx, height: wallHeightPx,
      label: `${trimmed} — wall face`, color: '#94a3b8',
    };
    set((s) => ({
      scenes: [...s.scenes, scene],
      ...withHistory(s, [...s.entities, wallEntity]),
      activeSceneId: id,
      view: 'elevation',
      selectedId: null,
    }));
  },
  renameScene: (id, name) =>
    set((s) => ({ scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, name: name.trim() || sc.name } : sc)) })),
  deleteScene: (id) =>
    set((s) => {
      const scene = s.scenes.find((sc) => sc.id === id);
      if (!scene || scene.kind === 'plan') return s; // the floor plan can't be deleted
      const scenes = s.scenes.filter((sc) => sc.id !== id);
      const entities = s.entities.filter((e) => (e.sceneId ?? 'plan') !== id);
      const wasActive = s.activeSceneId === id;
      return {
        scenes,
        entities,
        activeSceneId: wasActive ? 'plan' : s.activeSceneId,
        view: wasActive ? 'plan' : s.view,
        selectedId: wasActive ? null : s.selectedId,
      };
    }),
  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  setBackendTab: (backendTab) => {
    set({ backendTab });
    get().refreshProjects();
  },
  setAuth: (uid, userEmail) => {
    set({ uid, userEmail });
    if (uid && get().backendTab === 'cloud') get().refreshProjects();
  },
  refreshProjects: () => {
    const s = get();
    if (s.backendTab === 'cloud' && !s.uid) {
      set({ projects: [] });
      return;
    }
    backendFor(s.backendTab, s.uid)
      .list()
      .then((projects) => set({ projects }))
      .catch(() => set({ projects: [] }));
  },
  createProject: (name) => {
    void (async () => {
      await persistNow();
      const s = get();
      const backend = backendFor(s.backendTab, s.uid);
      const now = Date.now();
      const meta: ProjectMeta = {
        id: newProjectId(), name: name.trim() || 'Untitled House',
        createdAt: now, updatedAt: now, entityCount: 0,
      };
      await backend.save(meta, [], DEFAULT_SCENES).catch(() => useUI.getState().toast('Could not create project.', 'error'));
      const list = await backend.list().catch(() => [meta]);
      set({
        entities: [], scenes: DEFAULT_SCENES, activeSceneId: 'plan',
        projects: list, currentId: meta.id, currentName: meta.name,
        currentBackend: s.backendTab, view: 'plan', selectedId: null, past: [], future: [],
        saveStatus: 'saved', projectsOpen: false,
      });
    })();
  },
  openProject: (id) => {
    void (async () => {
      await persistNow();
      const s = get();
      const backend = backendFor(s.backendTab, s.uid);
      const data = await backend.load(id).catch(() => null);
      if (data == null) {
        useUI.getState().toast('Could not open project.', 'error');
        return;
      }
      const list = await backend.list().catch(() => [] as ProjectMeta[]);
      const meta = list.find((m) => m.id === id);
      set({
        entities: data.entities, scenes: data.scenes.length ? data.scenes : DEFAULT_SCENES, activeSceneId: 'plan',
        projects: list, currentId: id, currentName: meta?.name ?? 'Untitled',
        currentBackend: s.backendTab, view: 'plan', selectedId: null, past: [], future: [],
        saveStatus: 'saved', projectsOpen: false,
      });
    })();
  },
  renameProject: (id, name) => {
    void (async () => {
      const s = get();
      const backend = backendFor(s.backendTab, s.uid);
      const [data, list] = await Promise.all([
        backend.load(id).catch(() => null),
        backend.list().catch(() => [] as ProjectMeta[]),
      ]);
      const prev = list.find((m) => m.id === id);
      if (!prev) return;
      await backend.save(
        { ...prev, name: name.trim() || prev.name, updatedAt: Date.now() },
        data?.entities ?? [],
        data?.scenes ?? DEFAULT_SCENES,
      );
      if (s.currentId === id) set({ currentName: name.trim() || prev.name });
      get().refreshProjects();
    })();
  },
  duplicateProject: (id) => {
    void (async () => {
      const s = get();
      const backend = backendFor(s.backendTab, s.uid);
      const [data, list] = await Promise.all([
        backend.load(id).catch(() => null),
        backend.list().catch(() => [] as ProjectMeta[]),
      ]);
      const prev = list.find((m) => m.id === id);
      if (!prev || data == null) return;
      const now = Date.now();
      const meta: ProjectMeta = {
        ...prev, id: newProjectId(), name: `${prev.name} copy`,
        createdAt: now, updatedAt: now, entityCount: data.entities.length,
      };
      await backend.save(meta, data.entities, data.scenes);
      const fresh = await backend.list().catch(() => [meta]);
      set({ projects: fresh });
    })();
  },
  deleteProject: (id) => {
    void (async () => {
      const s = get();
      const backend = backendFor(s.backendTab, s.uid);
      await backend.remove(id).catch(() => useUI.getState().toast('Delete failed.', 'error'));
      const list = await backend.list().catch(() => [] as ProjectMeta[]);
      set({ projects: list });
      if (s.currentId === id) {
        if (list.length) get().openProject(list[0].id);
        else set({ entities: [], scenes: DEFAULT_SCENES, activeSceneId: 'plan', view: 'plan', currentId: null, currentName: '', past: [], future: [] });
      }
    })();
  },
  uploadToCloud: (id) => {
    void (async () => {
      const s = get();
      if (!s.uid) {
        useUI.getState().toast('Sign in first to upload to cloud.', 'error');
        return;
      }
      const [data, list] = await Promise.all([
        localBackend.load(id).catch(() => null),
        localBackend.list().catch(() => [] as ProjectMeta[]),
      ]);
      const prev = list.find((m) => m.id === id);
      if (!prev || data == null) return;
      await backendFor('cloud', s.uid)
        .save({ ...prev, updatedAt: Date.now() }, data.entities, data.scenes)
        .catch(() => useUI.getState().toast('Upload failed — check connection.', 'error'));
      useUI.getState().toast(`Uploaded "${prev.name}" to cloud — sign in on your other device to open it.`, 'success');
      if (s.backendTab === 'cloud') get().refreshProjects();
    })();
  },
  saveCurrent: () => {
    void persistNow();
  },
}));