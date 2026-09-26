import { useEffect } from 'react';
import Toolbar from './components/Toolbar';
import CanvasStage from './components/CanvasStage';
import PropsPanel from './components/PropsPanel';
import TopBar from './components/TopBar';
import ProjectsDialog from './components/ProjectsDialog';
import { useStore, backendFor, flushSave } from './store';
import { CLOUD_READY, watchAuth } from './lib/cloud';
import { newProjectId } from './lib/projects';

export default function App() {
  const entities = useStore((s) => s.entities);
  const currentId = useStore((s) => s.currentId);

  // boot: open most recent local project (or adopt the seed canvas as first project)
  useEffect(() => {
    let unwatch: (() => void) | null = null;
    (async () => {
      const st = useStore.getState();
      const local = backendFor('local', null);
      const list = await local.list().catch(() => []);
      if (!list.length) {
        const now = Date.now();
        const meta = {
          id: newProjectId(), name: 'My First Home',
          createdAt: now, updatedAt: now, entityCount: st.entities.length,
        };
        await local.save(meta, st.entities, st.scenes).catch(() => {});
        useStore.setState({
          projects: [meta], currentId: meta.id, currentName: meta.name,
          currentBackend: 'local', saveStatus: 'saved',
        });
      } else {
        useStore.getState().openProject(list[0].id);
      }
      if (CLOUD_READY) {
        unwatch = watchAuth((uid, email) => useStore.getState().setAuth(uid, email));
      }
    })();
    const onUnload = () => {
      void flushSave();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      unwatch?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave current project ~1.5s after last edit
  useEffect(() => {
    if (!currentId) return;
    useStore.setState({ saveStatus: 'dirty' });
    const t = setTimeout(() => useStore.getState().saveCurrent(), 1500);
    return () => clearTimeout(t);
  }, [entities, currentId]);

  const shot = () => {
    const c = document.querySelector('canvas');
    return c ? c.toDataURL('image/png') : null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar stageShot={shot} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Toolbar />
        <CanvasStage />
        <PropsPanel />
      </div>
      <div className="no-print" style={{ height: 26, background: '#0f172a', color: '#cbd5e1', fontSize: 12, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 12 }}>
        <span>ArcSite clone for personal use — plan + elevation, DXF import/export</span>
        <span style={{ marginLeft: 'auto' }}>DWG? Convert to DXF first (ODA File Converter / Autodesk viewer), then Import DXF. DWF not supported yet.</span>
      </div>
      <ProjectsDialog />
    </div>
  );
}
