import { useState } from 'react';
import { useStore } from '../store';
import {
  fmtLen, roomArea, normalizeAngle, angleOf, rotateSegment, setSegmentLength, pathLen,
  parseLenToPx, parseCoordToPx, parseThicknessToPx, thicknessToUnitNum, thicknessUnitLabel, lenToUnitNum,
} from '../lib/geometry';
import { SYMBOLS, SYMBOL_MAP } from '../lib/symbols';

const SWATCHES = ['#111827', '#b91c1c', '#b45309', '#15803d', '#0369a1', '#7c3aed', '#db2777', '#6b7280'];

function Field({ label, defaultValue, onCommit, width = 80, hint }: {
  label: string; defaultValue: string | number; width?: number; hint?: string;
  onCommit: (v: string) => void;
}) {
  return (
    <label title={hint}>
      {label}:{' '}
      <input
        style={{ width }}
        defaultValue={defaultValue}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onCommit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); }
          e.stopPropagation();
        }}
        onBlur={(e) => onCommit(e.target.value)}
      />
    </label>
  );
}

function ColorRow({ value, onPick }: { value: string; onPick: (c: string, transient: boolean) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {SWATCHES.map((c) => (
        <button
          key={c} title={c} onClick={() => onPick(c, false)}
          style={{ width: 22, height: 22, borderRadius: 6, padding: 0, background: c, border: value === c ? '2px solid #2563eb' : '1px solid #cbd5e1' }}
        />
      ))}
      <input
        type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#111827'}
        title="Custom color"
        onFocus={() => useStore.getState().checkpoint()}
        onChange={(e) => onPick(e.target.value, true)}
        style={{ width: 30, height: 24, padding: 0, border: '1px solid #cbd5e1', borderRadius: 6 }}
      />
    </div>
  );
}

function RotateRow({ value, onSet }: { value: number; onSet: (deg: number, transient?: boolean) => void }) {
  const v = Math.round(normalizeAngle(value));
  return (
    <div>
      <label>
        Rotation:{' '}
        <input
          type="range" min={0} max={359} step={1} value={v}
          onPointerDown={() => useStore.getState().checkpoint()}
          onChange={(e) => onSet(+e.target.value, true)} style={{ width: 110, verticalAlign: 'middle' }}
        />{' '}
        <input
          style={{ width: 52 }} defaultValue={v}
          key={'rot' + v}
          onKeyDown={(e) => { if (e.key === 'Enter') onSet(parseFloat((e.target as HTMLInputElement).value) || 0); e.stopPropagation(); }}
          onBlur={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onSet(n); }}
        />°
      </label>
      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
        {[0, 45, 90, 135, 180, 270].map((a) => (
          <button key={a} onClick={() => onSet(a)} title={`Set ${a}°`} style={v === a ? { background: '#dbeafe' } : {}}>{a}°</button>
        ))}
        <button onClick={() => onSet(v + 15)} title="Rotate +15° (same as R key)">+15°</button>
        <button onClick={() => onSet(v + 180)} title="Flip 180°">Flip</button>
      </div>
    </div>
  );
}

export default function PropsPanel() {
  const s = useStore();
  const sceneEntities = s.entities.filter((e) => (e.sceneId ?? 'plan') === s.activeSceneId);
  const sel = sceneEntities.find((e) => e.id === s.selectedId) ?? null;
  const unitSuffix = s.unit === 'm' ? 'm / cm' : 'ft / in';
  // touch D-pad step: 1px fine nudges, or one grid cell per tap
  const [nudgeBig, setNudgeBig] = useState(false);
  const nudgeStep = nudgeBig ? (s.grid || 10) : 1;
  // furniture library starts collapsed to keep the panel tidy
  const [showFurniture, setShowFurniture] = useState(false);

  const badLen = (v: string) => alert(`Can't parse "${v}". Try e.g. ${s.unit === 'ft' ? `10ft, 10'6", 36in` : '3m, 250cm'}.`);

  return (
    <div className="no-print" style={{ width: 260, flexShrink: 0, minHeight: 0, background: 'white', borderLeft: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', fontSize: 13 }}>
      <div style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Sketch settings</div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ marginBottom: 4, color: '#475569' }}>Pen / line color</div>
          <ColorRow value={s.drawColor} onPick={(c) => s.setDrawColor(c)} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>Unit: <select value={s.unit} onChange={(e) => s.setUnit(e.target.value as 'm' | 'ft')}><option value="ft">feet/in</option><option value="m">meters/cm</option></select></label>
          <label>Pen: <input type="number" value={s.penWidth} min={1} max={20} onChange={(e) => s.setPenWidth(+e.target.value)} style={{ width: 52 }} /> px</label>
        </div>
        <div style={{ marginTop: 6 }}>
          <Field
            label="Wall thickness" width={70} hint={thicknessUnitLabel(s.unit)}
            defaultValue={thicknessToUnitNum(s.wallThickness, s.unit)}
            onCommit={(v) => {
              const n = parseThicknessToPx(v, s.unit);
              if (n == null) return badLen(v);
              s.setWallThickness(Math.round(n * 100) / 100);
            }}
          />
          <span style={{ color: '#64748b', fontSize: 11 }}> {s.unit === 'ft' ? 'inch' : 'cm'} • new walls</span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
          <label><input type="checkbox" checked={s.snap} onChange={(e) => s.setSnap(e.target.checked)} /> Snap</label>
          <label><input type="checkbox" checked={s.showGrid} onChange={(e) => s.setShowGrid(e.target.checked)} /> Grid</label>
        </div>
        <div style={{ marginTop: 6 }}><label>Grid step: <input type="number" value={s.grid} min={1} max={100} onChange={(e) => s.setGrid(+e.target.value)} style={{ width: 60 }} /> px</label></div>
      </div>

      <div style={{ padding: 10, borderBottom: '1px solid #f1f5f9' }}>
        <button
          onClick={() => setShowFurniture((v) => !v)}
          title="Show/hide the furniture library"
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#0f172a', width: '100%', textAlign: 'left' }}
        >
          <span style={{ width: 14 }}>{showFurniture ? '▼' : '▶'}</span>
          <span>🪑 Furniture & Kitchen</span>
          <span style={{ fontWeight: 400, color: '#64748b', fontSize: 11 }}>(click, then click canvas)</span>
        </button>
        {showFurniture && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 6 }}>
          {SYMBOLS.map((sym) => (
            <button
              key={sym.id} title={`${sym.name} — real size ${sym.size}`}
              onClick={() => { s.setTool('select'); s.setPendingSymbol(sym.id); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 2px',
                background: s.pendingSymbol === sym.id ? '#ede9fe' : '#f8fafc',
                border: s.pendingSymbol === sym.id ? '2px solid #7c3aed' : '1px solid #e2e8f0',
              }}
            >
              <span style={{ fontSize: 18 }}>{sym.icon}</span>
              <span style={{ fontSize: 10, lineHeight: 1.2, textAlign: 'center' }}>{sym.name}</span>
            </button>
          ))}
        </div>
        )}
        {s.pendingSymbol && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#6d28d9' }}>
            Placing <b>{SYMBOL_MAP[s.pendingSymbol]?.name}</b> ({SYMBOL_MAP[s.pendingSymbol]?.size}) — click canvas, Esc to stop.{' '}
            <button onClick={() => s.setPendingSymbol(null)}>Done</button>
          </div>
        )}
      </div>

      <div style={{ padding: 10, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Properties {sel ? `— ${sel.type === 'symbol' ? SYMBOL_MAP[sel.symbol ?? '']?.name ?? sel.type : sel.type}` : ''}</div>
        {!sel && <div style={{ color: '#64748b' }}>Select an object to edit exact sizes and colors. Use ✏️ Pen for freehand sketching. Ctrl+Z undo, Ctrl+Shift+Z redo.</div>}
        {sel && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} key={sel.id}>
            {(sel.label !== undefined || sel.type === 'text' || sel.type === 'room') && (
              <label>Label: <input defaultValue={sel.label ?? ''} key={'lb' + (sel.label ?? '')}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }}
                onBlur={(e) => s.updateEntity(sel.id, { label: e.target.value })} style={{ width: '100%' }} /></label>
            )}

            <div>
              <div style={{ marginBottom: 4, color: '#475569' }}>Color</div>
              <ColorRow value={sel.color ?? '#111827'} onPick={(c, t) => s.updateEntity(sel.id, { color: c }, t)} />
            </div>

            {/* position */}
            {(sel.x !== undefined) && (
              <div style={{ display: 'flex', gap: 6 }}>
                <Field label="X" width={64} hint={`Position in ${unitSuffix}`} defaultValue={lenToUnitNum(sel.x, s.unit)}
                  onCommit={(v) => { const n = parseCoordToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { x: Math.round(n * 10) / 10 }); }} />
                <Field label="Y" width={64} hint={`Position in ${unitSuffix}`} defaultValue={lenToUnitNum(sel.y ?? 0, s.unit)}
                  onCommit={(v) => { const n = parseCoordToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { y: Math.round(n * 10) / 10 }); }} />
              </div>
            )}

            {/* linear entities: exact length + angle */}
            {sel.points && sel.points.length === 4 && (
              <>
                <div style={{ color: '#475569' }}>
                  Length: {fmtLen(Math.hypot(sel.points[2] - sel.points[0], sel.points[3] - sel.points[1]), s.unit)}
                  {' '}∠ {Math.round(normalizeAngle(angleOf(sel.points[0], sel.points[1], sel.points[2], sel.points[3])))}°
                </div>
                <Field label={`Length (${unitSuffix})`} width={90} defaultValue={lenToUnitNum(Math.hypot(sel.points[2] - sel.points[0], sel.points[3] - sel.points[1]), s.unit)}
                  onCommit={(v) => { const n = parseLenToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { points: setSegmentLength(sel.points!, Math.round(n * 10) / 10) }); }} />
                <Field label="Angle °" width={64} hint="Absolute angle, rotates about midpoint" defaultValue={Math.round(normalizeAngle(angleOf(sel.points[0], sel.points[1], sel.points[2], sel.points[3])))}
                  onCommit={(v) => { const n = parseFloat(v); if (!Number.isFinite(n)) return; s.updateEntity(sel.id, { points: rotateSegment(sel.points!, n) }); }} />
              </>
            )}

            {/* freehand sketch */}
            {sel.type === 'freehand' && sel.points && (
              <>
                <div style={{ color: '#475569' }}>Sketch length: {fmtLen(pathLen(sel.points), s.unit)}</div>
                <Field label="Stroke px" width={64} defaultValue={sel.thickness ?? 3}
                  onCommit={(v) => { const n = parseFloat(v); if (Number.isFinite(n)) s.updateEntity(sel.id, { thickness: n }); }} />
              </>
            )}

            {/* boxes: exact W/H */}
            {(sel.type === 'room' || sel.type === 'rect' || sel.type === 'symbol') && (
              <>
                {sel.type === 'room' && <div style={{ color: '#475569' }}>Area: {roomArea(sel.width ?? 0, sel.height ?? 0, s.unit)}</div>}
                {sel.type === 'symbol' && <div style={{ color: '#475569' }}>Real size: {SYMBOL_MAP[sel.symbol ?? '']?.size ?? ''} (resize scales drawing)</div>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <Field label={`W (${unitSuffix})`} width={70} defaultValue={lenToUnitNum(sel.width ?? 0, s.unit)}
                    onCommit={(v) => { const n = parseLenToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { width: Math.round(n * 10) / 10 }); }} />
                  <Field label={`H (${unitSuffix})`} width={70} defaultValue={lenToUnitNum(sel.height ?? 0, s.unit)}
                    onCommit={(v) => { const n = parseLenToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { height: Math.round(n * 10) / 10 }); }} />
                </div>
              </>
            )}

            {/* door/window width + height (height matters on elevation views) */}
            {(sel.type === 'door' || sel.type === 'window') && (
              <div style={{ display: 'flex', gap: 6 }}>
                <Field label={`Width (${unitSuffix})`} width={80} defaultValue={lenToUnitNum(sel.width ?? 60, s.unit)}
                  onCommit={(v) => { const n = parseLenToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { width: Math.round(n * 10) / 10 }); }} />
                <Field label={`Height (${unitSuffix})`} width={80} hint="Used when this door/window is drawn on an elevation view"
                  defaultValue={lenToUnitNum(sel.height ?? (sel.type === 'door' ? 105 : 60), s.unit)}
                  onCommit={(v) => { const n = parseLenToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { height: Math.round(n * 10) / 10 }); }} />
              </div>
            )}

            {/* rotation for everything except circle + freehand */}
            {sel.type !== 'circle' && sel.type !== 'freehand' && (
              <RotateRow
                value={sel.points ? angleOf(sel.points[0], sel.points[1], sel.points[2], sel.points[3]) : (sel.rotation ?? 0)}
                onSet={(deg, t) => {
                  if (sel.points) s.updateEntity(sel.id, { points: rotateSegment(sel.points, deg) }, t);
                  else s.updateEntity(sel.id, { rotation: normalizeAngle(deg) }, t);
                }}
              />
            )}

            {/* thickness: walls/lines always editable (imports may not store one — renderer falls back the same way) */}
            {(sel.type === 'wall' || sel.type === 'line' || (sel.thickness !== undefined && sel.type !== 'freehand' && sel.type !== 'dimension')) && (
              <div>
                <Field
                  label="Thickness" width={70} hint={thicknessUnitLabel(s.unit)}
                  defaultValue={thicknessToUnitNum(sel.thickness ?? 6, s.unit)}
                  onCommit={(v) => {
                    const n = parseThicknessToPx(v, s.unit);
                    if (n == null) return badLen(v);
                    s.updateEntity(sel.id, { thickness: Math.round(n * 100) / 100 });
                  }}
                />
                <span style={{ color: '#64748b', fontSize: 11 }}> {s.unit === 'ft' ? 'inch' : 'cm'}</span>
              </div>
            )}
            {sel.type === 'text' && <Field label="Font size" width={64} defaultValue={sel.fontSize ?? 16} onCommit={(v) => { const n = parseFloat(v); if (Number.isFinite(n)) s.updateEntity(sel.id, { fontSize: n }); }} />}
            {/* touch nudge pad: arrow-key nudging for tablets (no keyboard) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ color: '#475569' }}>Nudge</span>
                <button
                  title={nudgeBig ? 'Tap for 1px steps' : `Tap for ${s.grid || 10}px steps`}
                  onClick={() => setNudgeBig((v) => !v)}
                  style={nudgeBig ? { background: '#dbeafe' } : {}}
                >
                  step: {nudgeBig ? `${s.grid || 10}px` : '1px'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <button onClick={() => s.nudge(0, -nudgeStep)} style={{ width: 64 }} title="Nudge up">↑</button>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => s.nudge(-nudgeStep, 0)} style={{ width: 64 }} title="Nudge left">←</button>
                  <button onClick={() => s.nudge(nudgeStep, 0)} style={{ width: 64 }} title="Nudge right">→</button>
                </div>
                <button onClick={() => s.nudge(0, nudgeStep)} style={{ width: 64 }} title="Nudge down">↓</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(sel)); }}>Copy JSON</button>
              <button onClick={() => s.removeEntity(sel.id)} style={{ color: 'red' }}>Delete</button>
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>id: {sel.id} • Tip: drag the ⟳ handle on canvas, or press R (+Shift = 90°)</div>
          </div>
        )}
      </div>
    </div>
  );
}
