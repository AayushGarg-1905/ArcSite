import { useState } from 'react';
import { useStore } from '../store';
import { useUI } from '../lib/ui';
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
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button
          key={c} title={c} onClick={() => onPick(c, false)}
          className={`swatch${value === c ? ' active' : ''}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#111827'}
        title="Custom color"
        onFocus={() => useStore.getState().checkpoint()}
        onChange={(e) => onPick(e.target.value, true)}
        style={{ width: 30, height: 26, padding: 0, borderRadius: 6 }}
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
      <div className="field-row" style={{ marginTop: 4 }}>
        {[0, 45, 90, 135, 180, 270].map((a) => (
          <button key={a} className="btn-sm" onClick={() => onSet(a)} title={`Set ${a}°`} style={v === a ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' } : {}}>{a}°</button>
        ))}
        <button className="btn-sm" onClick={() => onSet(v + 15)} title="Rotate +15° (same as R key)">+15°</button>
        <button className="btn-sm" onClick={() => onSet(v + 180)} title="Flip 180°">Flip</button>
      </div>
    </div>
  );
}

export default function PropsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const ui = useUI();
  const sceneEntities = s.entities.filter((e) => (e.sceneId ?? 'plan') === s.activeSceneId);
  const sel = sceneEntities.find((e) => e.id === s.selectedId) ?? null;
  const unitSuffix = s.unit === 'm' ? 'm / cm' : 'ft / in';
  // touch D-pad step: 1px fine nudges, or one grid cell per tap
  const [nudgeBig, setNudgeBig] = useState(false);
  const nudgeStep = nudgeBig ? (s.grid || 10) : 1;
  // furniture library starts collapsed to keep the panel tidy
  const [showFurniture, setShowFurniture] = useState(false);

  const badLen = (v: string) => ui.toast(`Can't parse "${v}". Try e.g. ${s.unit === 'ft' ? `10ft, 10'6", 36in` : '3m, 250cm'}.`, 'error');

  return (
    <div className={`panel no-print${open ? ' open' : ''}`}>
      <div className="panel-section">
        <div className="panel-head-row">
          <div className="panel-title" style={{ marginBottom: 0 }}>Sketch settings</div>
          <button className="panel-close btn-icon btn-ghost" onClick={onClose} aria-label="Close properties">✕</button>
        </div>
        <div style={{ margin: '10px 0 6px' }}>
          <div style={{ marginBottom: 4, color: 'var(--text-muted)' }}>Pen / line color</div>
          <ColorRow value={s.drawColor} onPick={(c) => s.setDrawColor(c)} />
        </div>
        <div className="field-row">
          <label>Unit: <select value={s.unit} onChange={(e) => s.setUnit(e.target.value as 'm' | 'ft')}><option value="ft">feet/in</option><option value="m">meters/cm</option></select></label>
          <label>Pen: <input type="number" value={s.penWidth} min={1} max={20} onChange={(e) => s.setPenWidth(+e.target.value)} style={{ width: 52 }} /> px</label>
        </div>
        <div style={{ marginTop: 8 }}>
          <Field
            label="Wall thickness" width={70} hint={thicknessUnitLabel(s.unit)}
            defaultValue={thicknessToUnitNum(s.wallThickness, s.unit)}
            onCommit={(v) => {
              const n = parseThicknessToPx(v, s.unit);
              if (n == null) return badLen(v);
              s.setWallThickness(Math.round(n * 100) / 100);
            }}
          />
          <span className="field-sub"> {s.unit === 'ft' ? 'inch' : 'cm'} • new walls</span>
        </div>
        <div className="field-row" style={{ marginTop: 8 }}>
          <label><input type="checkbox" checked={s.snap} onChange={(e) => s.setSnap(e.target.checked)} /> Snap</label>
          <label><input type="checkbox" checked={s.showGrid} onChange={(e) => s.setShowGrid(e.target.checked)} /> Grid</label>
        </div>
        <div style={{ marginTop: 8 }}><label>Grid step: <input type="number" value={s.grid} min={1} max={100} onChange={(e) => s.setGrid(+e.target.value)} style={{ width: 60 }} /> px</label></div>
      </div>

      <div className="panel-section">
        <button className="collapse-trigger" onClick={() => setShowFurniture((v) => !v)} title="Show/hide the furniture library">
          <span className="chev">{showFurniture ? '▼' : '▶'}</span>
          <span>🪑 Furniture &amp; Kitchen</span>
          <span className="muted">(click, then click canvas)</span>
        </button>
        {showFurniture && (
          <div className="symbol-grid">
            {SYMBOLS.map((sym) => (
              <button
                key={sym.id} title={`${sym.name} — real size ${sym.size}`}
                onClick={() => { s.setTool('select'); s.setPendingSymbol(sym.id); }}
                className={`symbol-tile${s.pendingSymbol === sym.id ? ' active' : ''}`}
              >
                <span className="icon">{sym.icon}</span>
                <span>{sym.name}</span>
              </button>
            ))}
          </div>
        )}
        {s.pendingSymbol && (
          <div className="field-row" style={{ marginTop: 8, fontSize: 12, color: '#6d28d9' }}>
            <span>Placing <b>{SYMBOL_MAP[s.pendingSymbol]?.name}</b> ({SYMBOL_MAP[s.pendingSymbol]?.size}) — click canvas, Esc to stop.</span>
            <button className="btn-sm" onClick={() => s.setPendingSymbol(null)}>Done</button>
          </div>
        )}
      </div>

      <div className="panel-scroll">
        <div className="panel-title">Properties {sel ? `— ${sel.type === 'symbol' ? SYMBOL_MAP[sel.symbol ?? '']?.name ?? sel.type : sel.type}` : ''}</div>
        {!sel && (
          <div className="panel-empty">
            Select an object on the canvas to edit exact sizes and colors.{' '}
            Use ✏️ Pen for freehand sketching. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo.
          </div>
        )}
        {sel && (
          <div className="field-col" key={sel.id}>
            {(sel.label !== undefined || sel.type === 'text' || sel.type === 'room') && (
              <label>Label: <input defaultValue={sel.label ?? ''} key={'lb' + (sel.label ?? '')}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }}
                onBlur={(e) => s.updateEntity(sel.id, { label: e.target.value })} style={{ width: '100%' }} /></label>
            )}

            <div>
              <div style={{ marginBottom: 4, color: 'var(--text-muted)' }}>Color</div>
              <ColorRow value={sel.color ?? '#111827'} onPick={(c, t) => s.updateEntity(sel.id, { color: c }, t)} />
            </div>

            {/* position */}
            {(sel.x !== undefined) && (
              <div className="field-row">
                <Field label="X" width={64} hint={`Position in ${unitSuffix}`} defaultValue={lenToUnitNum(sel.x, s.unit)}
                  onCommit={(v) => { const n = parseCoordToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { x: Math.round(n * 10) / 10 }); }} />
                <Field label="Y" width={64} hint={`Position in ${unitSuffix}`} defaultValue={lenToUnitNum(sel.y ?? 0, s.unit)}
                  onCommit={(v) => { const n = parseCoordToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { y: Math.round(n * 10) / 10 }); }} />
              </div>
            )}

            {/* linear entities: exact length + angle */}
            {sel.points && sel.points.length === 4 && (
              <>
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {fmtLen(Math.hypot(sel.points[2] - sel.points[0], sel.points[3] - sel.points[1]), s.unit)}
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
                <div className="field-sub">Sketch length: {fmtLen(pathLen(sel.points), s.unit)}</div>
                <Field label="Stroke px" width={64} defaultValue={sel.thickness ?? 3}
                  onCommit={(v) => { const n = parseFloat(v); if (Number.isFinite(n)) s.updateEntity(sel.id, { thickness: n }); }} />
              </>
            )}

            {/* boxes: exact W/H */}
            {(sel.type === 'room' || sel.type === 'rect' || sel.type === 'symbol') && (
              <>
                {sel.type === 'room' && <div className="field-sub">Area: {roomArea(sel.width ?? 0, sel.height ?? 0, s.unit)}</div>}
                {sel.type === 'symbol' && <div className="field-sub">Real size: {SYMBOL_MAP[sel.symbol ?? '']?.size ?? ''} (resize scales drawing)</div>}
                <div className="field-row">
                  <Field label={`W (${unitSuffix})`} width={70} defaultValue={lenToUnitNum(sel.width ?? 0, s.unit)}
                    onCommit={(v) => { const n = parseLenToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { width: Math.round(n * 10) / 10 }); }} />
                  <Field label={`H (${unitSuffix})`} width={70} defaultValue={lenToUnitNum(sel.height ?? 0, s.unit)}
                    onCommit={(v) => { const n = parseLenToPx(v, s.unit); if (n == null) return badLen(v); s.updateEntity(sel.id, { height: Math.round(n * 10) / 10 }); }} />
                </div>
              </>
            )}

            {/* door/window width + height (height matters on elevation views) */}
            {(sel.type === 'door' || sel.type === 'window') && (
              <div className="field-row">
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
                <span className="field-sub"> {s.unit === 'ft' ? 'inch' : 'cm'}</span>
              </div>
            )}
            {sel.type === 'text' && <Field label="Font size" width={64} defaultValue={sel.fontSize ?? 16} onCommit={(v) => { const n = parseFloat(v); if (Number.isFinite(n)) s.updateEntity(sel.id, { fontSize: n }); }} />}
            {/* touch nudge pad: arrow-key nudging for tablets (no keyboard) */}
            <div>
              <div className="field-row" style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--text-muted)' }}>Nudge</span>
                <button
                  className="btn-sm"
                  title={nudgeBig ? 'Tap for 1px steps' : `Tap for ${s.grid || 10}px steps`}
                  onClick={() => setNudgeBig((v) => !v)}
                  style={nudgeBig ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' } : {}}
                >
                  step: {nudgeBig ? `${s.grid || 10}px` : '1px'}
                </button>
              </div>
              <div className="nudge-pad">
                <button onClick={() => s.nudge(0, -nudgeStep)} title="Nudge up">↑</button>
                <div className="row">
                  <button onClick={() => s.nudge(-nudgeStep, 0)} title="Nudge left">←</button>
                  <button onClick={() => s.nudge(nudgeStep, 0)} title="Nudge right">→</button>
                </div>
                <button onClick={() => s.nudge(0, nudgeStep)} title="Nudge down">↓</button>
              </div>
            </div>
            <div className="field-row" style={{ marginTop: 4 }}>
              <button className="btn-sm" onClick={() => { navigator.clipboard.writeText(JSON.stringify(sel)); ui.toast('Copied entity JSON to clipboard', 'success'); }}>Copy JSON</button>
              <button className="btn-sm btn-danger" onClick={() => s.removeEntity(sel.id)}>Delete</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>id: {sel.id} • Tip: drag the ⟳ handle on canvas, or press R (+Shift = 90°)</div>
          </div>
        )}
      </div>
    </div>
  );
}