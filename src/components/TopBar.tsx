import { useRef, useState } from 'react';
import { useStore } from '../store';
import { exportDxf, download, entitiesToSvg, importDxfFile } from '../lib/dxf';
import { parseLenToPx } from '../lib/geometry';
import type { CadEntity } from '../types';

export default function TopBar({ stageShot }: { stageShot: () => string | null }) {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showNewElev, setShowNewElev] = useState(false);
  const [elevName, setElevName] = useState('');
  const [elevW, setElevW] = useState(s.unit === 'ft' ? '12ft' : '3.6m');
  const [elevH, setElevH] = useState(s.unit === 'ft' ? '8ft' : '2.4m');

  const activeScene = s.scenes.find((sc) => sc.id === s.activeSceneId);
  const sceneEntities = s.entities.filter((e) => (e.sceneId ?? 'plan') === s.activeSceneId);

  const newPlan = () => {
    if (!confirm(`Start a new drawing on "${activeScene?.name ?? 'this view'}"? Its contents will be lost (your other scenes are untouched).`)) return;
    s.clear();
  };
  const save = () => { s.saveCurrent(); };

  const openJson = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      if (Array.isArray(j)) {
        // replace only the entities on the CURRENT scene — never touch other scenes
        const tagged = (j as CadEntity[]).map((e) => ({ ...e, sceneId: s.activeSceneId }));
        const others = s.entities.filter((e) => (e.sceneId ?? 'plan') !== s.activeSceneId);
        s.setEntities([...others, ...tagged]);
      }
    } catch { alert('Invalid JSON'); }
  };

  const createElevation = () => {
    const w = parseLenToPx(elevW, s.unit);
    const h = parseLenToPx(elevH, s.unit);
    if (w == null || h == null) {
      alert(`Enter a valid wall width and height, e.g. ${s.unit === 'ft' ? `12ft and 8ft` : `3.6m and 2.4m`}.`);
      return;
    }
    s.addElevationScene(elevName, w, h);
    setShowNewElev(false);
    setElevName('');
  };

  return (
    <div className="no-print">
      <div style={{ height: 52, background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
        <strong style={{ fontSize: 16 }}>🏠 ArcSite Clone</strong>
        <span style={{ fontSize: 12, background: '#eef2ff', color: '#4338ca', padding: '2px 8px', borderRadius: 20 }}>
          {activeScene?.kind === 'elevation' ? `Elevation: ${activeScene.name}` : 'Floor Plan'}
        </span>
        <select
          value={s.activeSceneId}
          onChange={(e) => s.setActiveScene(e.target.value)}
          title="Switch between your floor plan and your elevation views"
          style={{ marginLeft: 4, maxWidth: 170 }}
        >
          {s.scenes.map((sc) => (
            <option key={sc.id} value={sc.id}>{sc.kind === 'plan' ? '📐 ' : '🧱 '}{sc.name}</option>
          ))}
        </select>
        <button onClick={() => setShowNewElev((v) => !v)} title="Create a new elevation view — one wall or one room, drawn to real scale">+ Elevation</button>
        {activeScene && activeScene.kind === 'elevation' && (
          <>
            <button
              onClick={() => { const n = prompt('Rename this elevation', activeScene.name); if (n) s.renameScene(activeScene.id, n); }}
              title="Rename this elevation"
            >✏️</button>
            <button
              onClick={() => { if (confirm(`Delete elevation "${activeScene.name}"? Everything drawn on it will be lost.`)) s.deleteScene(activeScene.id); }}
              title="Delete this elevation" style={{ color: 'red' }}
            >🗑</button>
          </>
        )}
        <button
          onClick={() => { s.refreshProjects(); s.setProjectsOpen(true); }}
          title="Open project manager (multiple projects, cloud sync)"
          style={{ marginLeft: 8, fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          📁 {s.currentName || 'No project'}
        </button>
        <span
          title={s.currentBackend === 'cloud' ? `Cloud project • ${s.userEmail ?? ''} • opens on any signed-in device` : 'Stored in this browser only'}
          style={{ fontSize: 12, background: s.currentBackend === 'cloud' ? '#ede9fe' : '#f1f5f9', color: s.currentBackend === 'cloud' ? '#6d28d9' : '#475569', padding: '2px 8px', borderRadius: 20 }}
        >
          {s.currentBackend === 'cloud' ? '☁ Cloud' : '💾 Device'}
        </span>
        <span
          title="Autosave status"
          style={{ fontSize: 12, color: s.saveStatus === 'saved' ? '#16a34a' : s.saveStatus === 'error' ? '#dc2626' : '#d97706' }}
        >
          ● {s.saveStatus === 'saved' ? 'Saved' : s.saveStatus === 'saving' ? 'Saving…' : s.saveStatus === 'dirty' ? 'Unsaved…' : 'Save failed!'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => s.undo()} disabled={!s.past.length} title="Undo (Ctrl+Z)">↩ Undo</button>
          <button onClick={() => s.redo()} disabled={!s.future.length} title="Redo (Ctrl+Shift+Z)">↪ Redo</button>
          <button onClick={newPlan}>New</button>
          <button onClick={save}>Save</button>
          <button onClick={() => { download('drawing.json', JSON.stringify(sceneEntities, null, 2)); }} title="Exports only the current scene">JSON</button>
          <button onClick={() => {
            const png = stageShot();
            if (png) { const a = document.createElement('a'); a.href = png; a.download = 'drawing.png'; a.click(); }
            else alert('PNG export needs canvas visible');
          }}>PNG</button>
          <button onClick={() => download('drawing.svg', entitiesToSvg(sceneEntities))} title="Exports only the current scene">SVG</button>
          <button onClick={() => download('drawing.dxf', exportDxf(sceneEntities))} title="Exports only the current scene">DXF</button>
          <button onClick={() => window.print()}>PDF/Print</button>
          <button onClick={() => fileRef.current?.click()} title="Imports into the current scene">Import DXF</button>
          <input ref={fileRef} type="file" accept=".dxf,.json" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.name.toLowerCase().endsWith('.dxf')) {
                try {
                  const res = await importDxfFile(f);
                  const ents = res.entities.map((en) => ({ ...en, sceneId: s.activeSceneId }));
                  s.setEntities([...s.entities, ...ents]);
                  alert(`Imported ${ents.length} objects from "${f.name}"\nFile units: ${res.unitsLabel}${res.scale !== 1 ? ` — scaled ×${Math.round(res.scale * 1000) / 1000} to true size` : ' — used as-is (unitless, exact 1:1)'}\nDimensions on canvas now match the CAD file exactly.`);
                } catch { alert('DXF parse failed. Try a DXF R12/R2000 ASCII export. DWG must be converted to DXF first (e.g. Autodesk viewer / ODA File Converter).'); }
              } else openJson(f);
              e.target.value = '';
            }} />
        </div>
      </div>

      {showNewElev && (
        <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 13 }}>
          <strong>New elevation:</strong>
          <input
            value={elevName} onChange={(e) => setElevName(e.target.value)}
            placeholder="e.g. Living Room — North Wall" style={{ width: 240 }}
            onKeyDown={(e) => { if (e.key === 'Enter') createElevation(); if (e.key === 'Escape') setShowNewElev(false); }}
            autoFocus
          />
          <span>Wall width:</span>
          <input value={elevW} onChange={(e) => setElevW(e.target.value)} style={{ width: 80 }}
            onKeyDown={(e) => { if (e.key === 'Enter') createElevation(); }} />
          <span>height:</span>
          <input value={elevH} onChange={(e) => setElevH(e.target.value)} style={{ width: 80 }}
            onKeyDown={(e) => { if (e.key === 'Enter') createElevation(); }} />
          <button onClick={createElevation} style={{ fontWeight: 600 }}>Create ↵</button>
          <button onClick={() => setShowNewElev(false)}>Cancel</button>
          <span style={{ color: '#64748b', marginLeft: 4 }}>
            Draws a to-scale wall-face rectangle you can add windows, doors and furniture to.
          </span>
        </div>
      )}
    </div>
  );
}
