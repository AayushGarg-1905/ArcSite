import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useUI } from '../lib/ui';
import { exportDxf, download, entitiesToSvg, importDxfFile } from '../lib/dxf';
import { parseLenToPx } from '../lib/geometry';
import type { CadEntity } from '../types';

export default function TopBar({ stageShot, onToggleRail, onTogglePanel }: {
  stageShot: () => string | null;
  onToggleRail: () => void;
  onTogglePanel: () => void;
}) {
  const s = useStore();
  const ui = useUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showNewElev, setShowNewElev] = useState(false);
  const [elevName, setElevName] = useState('');
  const [elevW, setElevW] = useState(s.unit === 'ft' ? '12ft' : '3.6m');
  const [elevH, setElevH] = useState(s.unit === 'ft' ? '8ft' : '2.4m');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const activeScene = s.scenes.find((sc) => sc.id === s.activeSceneId);
  const sceneEntities = s.entities.filter((e) => (e.sceneId ?? 'plan') === s.activeSceneId);

  const newPlan = async () => {
    const ok = await ui.confirm(
      `Start a new drawing on "${activeScene?.name ?? 'this view'}"? Its contents will be lost (your other scenes are untouched).`,
      { title: 'Start new drawing', danger: true, confirmLabel: 'Clear it' },
    );
    if (ok) s.clear();
  };
  const save = () => { s.saveCurrent(); ui.toast('Saved', 'success'); };

  const openJson = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      if (Array.isArray(j)) {
        // replace only the entities on the CURRENT scene — never touch other scenes
        const tagged = (j as CadEntity[]).map((e) => ({ ...e, sceneId: s.activeSceneId }));
        const others = s.entities.filter((e) => (e.sceneId ?? 'plan') !== s.activeSceneId);
        s.setEntities([...others, ...tagged]);
        ui.toast('Drawing imported', 'success');
      }
    } catch { ui.toast('That JSON file could not be read.', 'error'); }
  };

  const createElevation = () => {
    const w = parseLenToPx(elevW, s.unit);
    const h = parseLenToPx(elevH, s.unit);
    if (w == null || h == null) {
      ui.toast(`Enter a valid wall width and height, e.g. ${s.unit === 'ft' ? `12ft and 8ft` : `3.6m and 2.4m`}.`, 'error');
      return;
    }
    s.addElevationScene(elevName, w, h);
    setShowNewElev(false);
    setElevName('');
  };

  const renameElevation = async () => {
    if (!activeScene) return;
    const n = await ui.promptText('Rename this elevation', activeScene.name);
    if (n) s.renameScene(activeScene.id, n);
  };
  const deleteElevation = async () => {
    if (!activeScene) return;
    const ok = await ui.confirm(`Everything drawn on "${activeScene.name}" will be lost.`, { title: `Delete elevation "${activeScene.name}"?`, danger: true, confirmLabel: 'Delete' });
    if (ok) s.deleteScene(activeScene.id);
  };

  const runExport = (fn: () => void) => { fn(); setMenuOpen(false); };

  const statusLabel = s.saveStatus === 'saved' ? 'Saved' : s.saveStatus === 'saving' ? 'Saving…' : s.saveStatus === 'dirty' ? 'Unsaved…' : 'Save failed';
  const statusClass = `status-${s.saveStatus}`;

  return (
    <div className="no-print">
      <div className="topbar">
        <button className="btn-icon btn-ghost drawer-toggle" onClick={onToggleRail} title="Tools" aria-label="Open tools">☰</button>

        <div className="brand">
          <span className="brand-mark">🏠</span>
          <span className="brand-text">ArcSite</span>
        </div>
        <span className="scene-pill">{activeScene?.kind === 'elevation' ? `Elevation: ${activeScene.name}` : 'Floor Plan'}</span>
        <select
          className="scene-select"
          value={s.activeSceneId}
          onChange={(e) => s.setActiveScene(e.target.value)}
          title="Switch between your floor plan and your elevation views"
        >
          {s.scenes.map((sc) => (
            <option key={sc.id} value={sc.id}>{sc.kind === 'plan' ? '📐 ' : '🧱 '}{sc.name}</option>
          ))}
        </select>
        <button className="btn-icon btn-ghost" onClick={() => setShowNewElev((v) => !v)} title="Create a new elevation view — one wall or one room, drawn to real scale">+</button>
        {activeScene && activeScene.kind === 'elevation' && (
          <>
            <button className="btn-icon btn-ghost" onClick={renameElevation} title="Rename this elevation">✏️</button>
            <button className="btn-icon btn-ghost btn-danger" onClick={deleteElevation} title="Delete this elevation">🗑</button>
          </>
        )}

        <div className="topbar-actions">
          <button
            className="project-btn btn-ghost"
            onClick={() => { s.refreshProjects(); s.setProjectsOpen(true); }}
            title="Open project manager (multiple projects, cloud sync)"
          >
            📁 {s.currentName || 'No project'}
          </button>
          <span className={`backend-pill ${s.currentBackend}`} title={s.currentBackend === 'cloud' ? `Cloud project • ${s.userEmail ?? ''} • opens on any signed-in device` : 'Stored in this browser only'}>
            {s.currentBackend === 'cloud' ? '☁ Cloud' : '💾 Device'}
          </span>
          <span className={`status-pill ${statusClass}`} title="Autosave status">
            <span className="status-dot" /> {statusLabel}
          </span>

          <div className="topbar-divider" />
          <button className="btn-icon btn-ghost" onClick={() => s.undo()} disabled={!s.past.length} title="Undo (Ctrl+Z)">↩</button>
          <button className="btn-icon btn-ghost" onClick={() => s.redo()} disabled={!s.future.length} title="Redo (Ctrl+Shift+Z)">↪</button>
          <button className="btn-ghost" onClick={newPlan}>New</button>
          <button className="btn-primary" onClick={save}>Save</button>

          <div className="overflow-menu" ref={menuRef}>
            <button className="btn-ghost" onClick={() => setMenuOpen((v) => !v)} title="Export & import">⋯</button>
            {menuOpen && (
              <div className="overflow-panel">
                <button onClick={() => runExport(() => download('drawing.json', JSON.stringify(sceneEntities, null, 2)))} title="Exports only the current scene">Export JSON</button>
                <button onClick={() => runExport(() => {
                  const png = stageShot();
                  if (png) { const a = document.createElement('a'); a.href = png; a.download = 'drawing.png'; a.click(); }
                  else ui.toast('PNG export needs the canvas visible.', 'error');
                })}>Export PNG</button>
                <button onClick={() => runExport(() => download('drawing.svg', entitiesToSvg(sceneEntities)))} title="Exports only the current scene">Export SVG</button>
                <button onClick={() => runExport(() => download('drawing.dxf', exportDxf(sceneEntities)))} title="Exports only the current scene">Export DXF</button>
                <button onClick={() => runExport(() => window.print())}>Print / PDF</button>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 2px' }} />
                <button onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} title="Imports into the current scene">Import DXF / JSON</button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".dxf,.json" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.name.toLowerCase().endsWith('.dxf')) {
                try {
                  const res = await importDxfFile(f);
                  const ents = res.entities.map((en) => ({ ...en, sceneId: s.activeSceneId }));
                  s.setEntities([...s.entities, ...ents]);
                  ui.toast(`Imported ${ents.length} objects from "${f.name}" — file units: ${res.unitsLabel}${res.scale !== 1 ? `, scaled ×${Math.round(res.scale * 1000) / 1000} to true size` : ', used as-is'}.`, 'success');
                } catch { ui.toast('DXF parse failed. Try a DXF R12/R2000 ASCII export. DWG must be converted to DXF first.', 'error'); }
              } else openJson(f);
              e.target.value = '';
            }} />

          <button className="btn-icon btn-ghost drawer-toggle" onClick={onTogglePanel} title="Properties" aria-label="Open properties">▤</button>
        </div>
      </div>

      {showNewElev && (
        <div className="elev-bar">
          <strong>New elevation:</strong>
          <input
            value={elevName} onChange={(e) => setElevName(e.target.value)}
            placeholder="e.g. Living Room — North Wall" style={{ width: 220 }}
            onKeyDown={(e) => { if (e.key === 'Enter') createElevation(); if (e.key === 'Escape') setShowNewElev(false); }}
            autoFocus
          />
          <span>Wall width:</span>
          <input value={elevW} onChange={(e) => setElevW(e.target.value)} style={{ width: 76 }}
            onKeyDown={(e) => { if (e.key === 'Enter') createElevation(); }} />
          <span>height:</span>
          <input value={elevH} onChange={(e) => setElevH(e.target.value)} style={{ width: 76 }}
            onKeyDown={(e) => { if (e.key === 'Enter') createElevation(); }} />
          <button className="btn-primary" onClick={createElevation}>Create ↵</button>
          <button className="btn-ghost" onClick={() => setShowNewElev(false)}>Cancel</button>
          <span className="hint">Draws a to-scale wall-face rectangle you can add windows, doors and furniture to.</span>
        </div>
      )}
    </div>
  );
}