import { useState } from 'react';
import { useStore } from '../store';
import { useUI } from '../lib/ui';
import { CLOUD_READY, signInWithGoogle, signOutCloud } from '../lib/cloud';
import { backendFor, flushSave } from '../store';

const fmtDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ProjectsDialog() {
    const s = useStore();
    const ui = useUI();
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [busy, setBusy] = useState(false);

    if (!s.projectsOpen) return null;

    const onSignIn = async () => {
        setBusy(true);
        try {
            await signInWithGoogle();
            s.setBackendTab('cloud');
        } catch {
            ui.toast('Sign-in failed. Check popups / authorized domains in Firebase console.', 'error');
        }
        setBusy(false);
    };

    const onSignOut = async () => {
        setBusy(true);
        try {
            await flushSave(); // uid still set here, so cloud work is saved first
            await signOutCloud();
            useStore.setState({ currentBackend: 'local', backendTab: 'local' });
            s.refreshProjects();
            s.saveCurrent(); // persist the canvas as a local copy going forward
        } finally {
            setBusy(false);
        }
    };

    const create = () => {
        if (!newName.trim()) return;
        if (s.backendTab === 'cloud' && !s.uid) {
            ui.toast('Sign in to create cloud projects.', 'error');
            return;
        }
        s.createProject(newName.trim());
        setNewName('');
    };

    const del = async (id: string, name: string) => {
        const ok = await ui.confirm(`"${name}" and everything drawn in it will be permanently deleted.`, {
            title: 'Delete this project?', danger: true, confirmLabel: 'Delete',
        });
        if (ok) s.deleteProject(id);
    };

    return (
        <div className="modal-overlay no-print" onClick={() => s.setProjectsOpen(false)}>
            <div className="modal" style={{ width: 720, maxWidth: '100%' }} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <span className="modal-title">📁 Projects</span>
                    <div className="tabs" style={{ marginLeft: 8 }}>
                        <button className={`tab-btn${s.backendTab === 'local' ? ' active' : ''}`} onClick={() => s.setBackendTab('local')}>💾 This device</button>
                        <button className={`tab-btn${s.backendTab === 'cloud' ? ' active' : ''}`} onClick={() => s.setBackendTab('cloud')} title="Sync across devices via Google sign-in">☁ Cloud</button>
                    </div>
                    <button className="btn-icon btn-ghost" onClick={() => s.setProjectsOpen(false)} style={{ marginLeft: 'auto' }} aria-label="Close">✕</button>
                </div>

                <div className="modal-body">
                    {s.backendTab === 'cloud' && !CLOUD_READY && (
                        <div className="notice notice-warn">
                            <b>Cloud sync is off.</b> To open projects from any device: create a free Firebase project, enable
                            Firestore + Google sign-in, copy the web config into a <code>.env</code> file (see <code>.env.example</code>),
                            and restart the app. Until then, projects stay on this device.
                        </div>
                    )}
                    {s.backendTab === 'cloud' && CLOUD_READY && !s.uid && (
                        <div className="empty-block">
                            <p style={{ color: 'var(--text-muted)' }}>Sign in with Google to sync projects across your devices.</p>
                            <button className="btn-primary" onClick={onSignIn} disabled={busy}>
                                {busy ? 'Signing in…' : '🔑 Sign in with Google'}
                            </button>
                        </div>
                    )}
                    {(s.backendTab === 'local' || s.uid) && (
                        <>
                            {s.backendTab === 'cloud' && s.uid && (
                                <div className="field-row" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
                                    <span>Signed in as <b>{s.userEmail}</b> — projects auto-save here and sync to your other devices, even offline.</span>
                                    <button className="btn-ghost" onClick={onSignOut} disabled={busy} style={{ marginLeft: 'auto' }}>Sign out</button>
                                </div>
                            )}
                            <div className="field-row" style={{ marginBottom: 12, flexWrap: 'nowrap' }}>
                                <input
                                    value={newName} onChange={(e) => setNewName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
                                    placeholder="New project name, e.g. Sharma residence" style={{ flex: 1 }}
                                />
                                <button className="btn-primary" onClick={create}>+ New project</button>
                            </div>
                            {s.projects.length === 0 && (
                                <div className="empty-block">
                                    No projects here yet — create one above.
                                    {s.backendTab === 'local' && s.uid && ' Tip: older device-only projects can be uploaded with ⬆ on their cards.'}
                                </div>
                            )}
                            <div className="project-grid">
                                {s.projects.map((p) => (
                                    <div key={p.id} className={`project-card${s.currentId === p.id ? ' current' : ''}`}>
                                        <div className="project-thumb">
                                            {p.thumbnail ? <img src={p.thumbnail} alt="" /> : '🏠'}
                                        </div>
                                        <div className="project-meta">
                                            {editingId === p.id ? (
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { s.renameProject(p.id, editName); setEditingId(null); } }} style={{ flex: 1, minWidth: 0 }} autoFocus />
                                                    <button className="btn-icon" onClick={() => { s.renameProject(p.id, editName); setEditingId(null); }}>✓</button>
                                                </div>
                                            ) : (
                                                <div className="project-name" title={p.name}>
                                                    {p.name} {s.currentId === p.id && <span style={{ color: 'var(--accent)' }}>• open</span>}
                                                </div>
                                            )}
                                            <div className="project-sub">{p.entityCount} objects • {fmtDate(p.updatedAt)}</div>
                                            <div className="project-actions">
                                                <button className="btn-sm" style={{ fontWeight: 600 }} onClick={() => s.openProject(p.id)}>Open</button>
                                                <button className="btn-sm btn-icon" onClick={() => s.duplicateProject(p.id)} title="Duplicate">⧉</button>
                                                <button className="btn-sm btn-icon" onClick={() => { setEditingId(p.id); setEditName(p.name); }} title="Rename">✏️</button>
                                                {s.backendTab === 'local' && s.uid && (
                                                    <button className="btn-sm btn-icon" onClick={() => s.uploadToCloud(p.id)} title="Upload a copy to cloud">⬆</button>
                                                )}
                                                <button className="btn-sm btn-icon btn-danger" onClick={() => del(p.id, p.name)} title="Delete">🗑</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    {s.backendTab === 'local' && (
                        <div className="notice notice-info" style={{ marginTop: 12, marginBottom: 0 }}>
                            Stored in this browser ({backendFor('local', null).kind}). Use Import/Export (JSON/DXF) for backups,
                            or {CLOUD_READY ? 'open the ☁ Cloud tab and sign in to sync across devices.' : 'enable ☁ Cloud sync via Firebase (see .env.example).'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}