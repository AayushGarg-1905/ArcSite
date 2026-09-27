import { useStore } from '../store';
import type { ToolId } from '../types';

const TOOLS: { id: ToolId; label: string; icon: string; hint: string }[] = [
  { id: 'select', label: 'Select', icon: '⬚', hint: 'Move, drag □ handles to resize, ⟳ handle or R to rotate' },
  { id: 'pan', label: 'Pan', icon: '✋', hint: 'Drag canvas, wheel = zoom' },
  { id: 'wall', label: 'Wall', icon: '🧱', hint: 'Click 2 points' },
  { id: 'room', label: 'Room', icon: '▦', hint: 'Drag 2 corners, auto area' },
  { id: 'door', label: 'Door', icon: '🚪', hint: 'Click to place + rotation' },
  { id: 'window', label: 'Window', icon: '🪟', hint: 'Click to place' },
  { id: 'dimension', label: 'Dimension', icon: '📏', hint: 'Click 2 points' },
  { id: 'autodim', label: 'Auto-dim', icon: '📐', hint: 'Click a wall/room/opening to pin its measurement — click again to remove, Esc exits' },
  { id: 'line', label: 'Line', icon: '╱', hint: 'Click 2 points' },
  { id: 'rect', label: 'Rect', icon: '▢', hint: 'Drag 2 corners' },
  { id: 'circle', label: 'Circle', icon: '◯', hint: 'Center + radius' },
  { id: 'pen', label: 'Freehand', icon: '✏️', hint: 'Draw freehand sketch (no snap), release to finish' },
  { id: 'text', label: 'Text', icon: 'T', hint: 'Click to place' },
  { id: 'eraser', label: 'Erase', icon: '⌫', hint: 'Click entity to delete' },
];

export default function Toolbar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const { tool, setTool } = s;
  return (
    <div className={`rail no-print${open ? ' open' : ''}`} role="toolbar" aria-label="Drawing tools">
      <div className="rail-header">
        <span className="rail-section-label" style={{ padding: 0 }}>TOOLS</span>
        <button className="rail-close btn-icon btn-ghost" onClick={onClose} aria-label="Close tools" style={{ color: 'var(--text-on-ink)' }}>✕</button>
      </div>
      <div className="rail-section-label desktop-only">TOOLS</div>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`rail-btn${tool === t.id ? ' active' : ''}`}
          title={t.hint + ' — tap again to put the tool down (like Esc)'}
          onClick={() => {
            if (t.id === tool) {
              // tapping the armed tool again = tablet Esc: disarm + cancel anything in progress
              if (t.id !== 'select') setTool('select');
              else s.setSelected(null);
              s.cancelAll();
            } else setTool(t.id);
            if (window.matchMedia('(max-width: 1023.98px)').matches) onClose();
          }}
        >
          <span className="ic">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
      <div className="rail-footer">
        Wall: 2 clicks<br />Room: drag corners<br />Pen: draw &amp; release<br />Pinch: zoom, 2-finger: pan<br />
        Tap armed tool again: exit tool<br />
        <kbd>R</kbd> rotate selected · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
      </div>
    </div>
  );
}