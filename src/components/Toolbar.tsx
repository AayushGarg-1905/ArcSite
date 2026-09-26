import { useStore } from '../store';
import type { ToolId } from '../types';

const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: 'select', label: '⬚ Select', hint: 'Move, drag □ handles to resize, ⟳ handle or R to rotate' },
  { id: 'pan', label: '✋ Pan', hint: 'Drag canvas, wheel = zoom' },
  { id: 'wall', label: '🧱 Wall', hint: 'Click 2 points' },
  { id: 'room', label: '▦ Room', hint: 'Drag 2 corners, auto area' },
  { id: 'door', label: '🚪 Door', hint: 'Click to place + rotation' },
  { id: 'window', label: '🪟 Window', hint: 'Click to place' },
  { id: 'dimension', label: '📏 Dimension', hint: 'Click 2 points' },
  { id: 'autodim', label: '📐 Auto-dim', hint: 'Click a wall/room/opening to pin its measurement — click again to remove, Esc exits' },
  { id: 'line', label: '╱ Line', hint: 'Click 2 points' },
  { id: 'rect', label: '▢ Rect', hint: 'Drag 2 corners' },
  { id: 'circle', label: '◯ Circle', hint: 'Center + radius' },
  { id: 'pen', label: '✏️ Freehand', hint: 'Draw freehand sketch (no snap), release to finish' },
  { id: 'text', label: 'T Text', hint: 'Click to place' },
  { id: 'eraser', label: '⌫ Erase', hint: 'Click entity to delete' },
];

export default function Toolbar() {
  const s = useStore();
  const { tool, setTool } = s;
  return (
    <div className="no-print" style={{ width: 148, background: '#0f172a', color: 'white', display: 'flex', flexDirection: 'column', padding: 8, gap: 4 }}>
      <div style={{ fontSize: 12, opacity: 0.7, padding: '4px 6px' }}>TOOLS</div>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.hint + ' — tap again to put the tool down (like Esc)'}
          onClick={() => {
            if (t.id === tool) {
              // tapping the armed tool again = tablet Esc: disarm + cancel anything in progress
              if (t.id !== 'select') setTool('select');
              else s.setSelected(null);
              s.cancelAll();
            } else setTool(t.id);
          }}
          style={{
            textAlign: 'left', padding: '7px 9px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: tool === t.id ? '#2563eb' : 'transparent', color: 'white', fontSize: 13,
          }}
        >
          {t.label}
        </button>
      ))}
      <div style={{ marginTop: 'auto', fontSize: 11, opacity: 0.6, padding: 6, lineHeight: 1.5 }}>
        Wall: 2 clicks<br />Room: drag corners<br />Pen: draw & release<br />Pinch: zoom, 2-finger: pan<br />Tap armed tool again: exit tool<br />R: rotate selected<br />Ctrl+Z: undo
      </div>
    </div>
  );
}
