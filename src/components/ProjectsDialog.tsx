import { useState } from 'react';
import { useStore } from '../store';
import { CLOUD_READY, signInWithGoogle, signOutCloud } from '../lib/cloud';
import { backendFor, flushSave } from '../store';

const fmtDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ProjectsDialog() {
    const s = useStore();
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [confirmDel, setConfirmDel] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    if (!s.projectsOpen) return null;

    const onSignIn = async () => {
        setBusy(true);
        try {
            await signInWithGoogle();
            s.setBackendTab('cloud');
        } catch {
            alert('Sign-in failed. Check popups / authorized domains in Firebase console.');
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
            alert('Sign in to create cloud projects.');
            return;
        }
        s.createProject(newName.trim());
        setNewName('');
    };

    return (
        <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            onClick={() => s.setProjectsOpen(false)}
        >
            <div
                style={{ background: 'white', borderRadius: 14, width: 720, maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 16 }}>📁 Projects</strong>
                    <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                        <button onClick={() => s.setBackendTab('local')} style={{ fontWeight: s.backendTab === 'local' ? 700 : 400 }}>💾 This device</button>
                        <button onClick={() => s.setBackendTab('cloud')} style={{ fontWeight: s.backendTab === 'cloud' ? 700 : 400 }} title="Sync across devices via Google sign-in">☁ Cloud</button>
                    </div>
                    <button onClick={() => s.setProjectsOpen(false)} style={{ marginLeft: 'auto' }}>✕</button>
                </div>

                <div style={{ padding: 16, overflowY: 'auto' }}>
                    {s.backendTab === 'cloud' && !CLOUD_READY && (
                        <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>
                            <b>Cloud sync is off.</b> To open projects from any device: create a free Firebase project, enable
                            Firestore + Google sign-in, copy the web config into a <code>.env</code> file (see <code>.env.example</code>),
                            and restart the app. Until then, projects stay on this device.
                        </div>
                    )}
                    {s.backendTab === 'cloud' && CLOUD_READY && !s.uid && (
                        <div style={{ textAlign: 'center', padding: '18px 0' }}>
                            <p style={{ color: '#475569', fontSize: 14 }}>Sign in with Google to sync projects across your devices.</p>
                            <button onClick={onSignIn} disabled={busy} style={{ fontSize: 14, padding: '8px 18px' }}>
                                {busy ? 'Signing in…' : '🔑 Sign in with Google'}
                            </button>
                        </div>
                    )}
                    {(s.backendTab === 'local' || s.uid) && (
                        <>
                            {s.backendTab === 'cloud' && s.uid && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', marginBottom: 10 }}>
                                    <span>Signed in as <b>{s.userEmail}</b> — projects auto-save here and sync to your other devices, even offline.</span>
                                    <button onClick={onSignOut} disabled={busy} style={{ marginLeft: 'auto' }}>Sign out</button>
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                                <input
                                    value={newName} onChange={(e) => setNewName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
                                    placeholder="New project name, e.g. Sharma residence" style={{ flex: 1 }}
                                />
                                <button onClick={create}>+ New project</button>
                            </div>
                            {s.projects.length === 0 && (
                                <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                                    No projects here yet — create one above.
                                    {s.backendTab === 'local' && s.uid && ' Tip: older device-only projects can be uploaded with ⬆ on their cards.'}
                                </div>
                            )}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                                {s.projects.map((p) => (
                                    <div key={p.id} style={{ border: s.currentId === p.id ? '2px solid #2563eb' : '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: p.id === s.currentId ? '#eff6ff' : 'white' }}>
                                        {p.thumbnail
                                            ? <img src={p.thumbnail} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block', background: '#f1f5f9' }} />
                                            : <div style={{ height: 110, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🏠</div>}
                                        <div style={{ padding: 8 }}>
                                            {editingId === p.id ? (
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { s.renameProject(p.id, editName); setEditingId(null); } }} style={{ flex: 1, minWidth: 0 }} autoFocus />
                                                    <button onClick={() => { s.renameProject(p.id, editName); setEditingId(null); }}>✓</button>
                                                </div>
                                            ) : (
                                                <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.name}>
                                                    {p.name} {s.currentId === p.id && <span style={{ color: '#2563eb' }}>• open</span>}
                                                </div>
                                            )}
                                            <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 6px' }}>{p.entityCount} objects • {fmtDate(p.updatedAt)}</div>
                                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                <button onClick={() => s.openProject(p.id)} style={{ fontWeight: 600 }}>Open</button>
                                                <button onClick={() => s.duplicateProject(p.id)} title="Duplicate">⧉</button>
                                                <button onClick={() => { setEditingId(p.id); setEditName(p.name); }} title="Rename">✏️</button>
                                                {s.backendTab === 'local' && s.uid && (
                                                    <button onClick={() => s.uploadToCloud(p.id)} title="Upload a copy to cloud">⬆</button>
                                                )}
                                                {confirmDel === p.id
                                                    ? <button onClick={() => { s.deleteProject(p.id); setConfirmDel(null); }} style={{ color: 'red', fontWeight: 700 }}>Sure?</button>
                                                    : <button onClick={() => { setConfirmDel(p.id); setTimeout(() => setConfirmDel((c) => (c === p.id ? null : c)), 3000); }} title="Delete" style={{ color: 'red' }}>🗑</button>}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    {s.backendTab === 'local' && (
                        <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
                            Stored in this browser ({backendFor('local', null).kind}). Use Import/Export (JSON/DXF) below for backups,
                            or {CLOUD_READY ? 'open the ☁ Cloud tab and sign in to sync across devices.' : 'enable ☁ Cloud sync via Firebase (see .env.example).'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
