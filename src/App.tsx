import { useEffect } from 'react';
import Toolbar from './components/Toolbar';
import CanvasStage from './components/CanvasStage';
import PropsPanel from './components/PropsPanel';
import TopBar from './components/TopBar';
import ProjectsDialog from './components/ProjectsDialog';
import UIHost from './components/ui/UIHost';
import { useStore, backendFor, flushSave } from './store';
import { useUI } from './lib/ui';
import { CLOUD_READY, watchAuth } from './lib/cloud';
import { newProjectId } from './lib/projects';

export default function App() {
  const entities = useStore((s) => s.entities);
  const currentId = useStore((s) => s.currentId);
  const selectedId = useStore((s) => s.selectedId);
  const railOpen = useUI((s) => s.railOpen);
  const panelOpen = useUI((s) => s.panelOpen);
  const setRailOpen = useUI((s) => s.setRailOpen);
  const setPanelOpen = useUI((s) => s.setPanelOpen);

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
        await local.save(meta, st.entities, st.scenes).catch(() => { });
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

  // on narrow (tablet/phone) layouts, selecting something opens the properties
  // drawer automatically so there's no dead tap between "select" and "edit"
  useEffect(() => {
    if (selectedId && window.matchMedia('(max-width: 1023.98px)').matches) setPanelOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const shot = () => {
    const c = document.querySelector('canvas');
    return c ? c.toDataURL('image/png') : null;
  };

  return (
    <div className="app-shell">
      <TopBar stageShot={shot} onToggleRail={() => setRailOpen(!railOpen)} onTogglePanel={() => setPanelOpen(!panelOpen)} />
      <div className="app-body">
        {railOpen && <div className="drawer-backdrop no-print" onClick={() => setRailOpen(false)} />}
        <Toolbar open={railOpen} onClose={() => setRailOpen(false)} />
        <CanvasStage />
        {panelOpen && <div className="drawer-backdrop no-print" onClick={() => setPanelOpen(false)} />}
        <PropsPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
      </div>
      <div className="app-footer no-print">
        <span>ArcSite — plan + elevation drawing, DXF import/export</span>
        <span className="hint-desktop" style={{ marginLeft: 'auto' }}>DWG? Convert to DXF first (ODA File Converter / Autodesk viewer), then Import DXF. DWF not supported yet.</span>
      </div>
      <ProjectsDialog />
      <UIHost />
    </div>
  );
}