import { useEffect, useRef, useState } from 'react';
import { useUI } from '../../lib/ui';

export default function UIHost() {
    const { toasts, dismissToast, confirmReq, resolveConfirm, promptReq, resolvePrompt } = useUI();
    return (
        <>
            <div className="toast-stack no-print" aria-live="polite">
                {toasts.map((t) => (
                    <div key={t.id} className={`toast ${t.kind}`}>
                        <span className="ic">{t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : 'ℹ'}</span>
                        <span>{t.message}</span>
                        <button className="toast-dismiss" onClick={() => dismissToast(t.id)} aria-label="Dismiss">✕</button>
                    </div>
                ))}
            </div>

            {confirmReq && (
                <div className="modal-overlay" onClick={() => resolveConfirm(false)}>
                    <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
                        <div className="modal-header">
                            <span className="modal-title">{confirmReq.title ?? 'Are you sure?'}</span>
                        </div>
                        <div className="modal-body" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{confirmReq.message}</div>
                        <div className="modal-footer">
                            <button onClick={() => resolveConfirm(false)}>Cancel</button>
                            <button
                                autoFocus
                                className={confirmReq.danger ? 'btn-danger' : 'btn-primary'}
                                onClick={() => resolveConfirm(true)}
                            >
                                {confirmReq.confirmLabel ?? (confirmReq.danger ? 'Delete' : 'Confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {promptReq && <PromptModal req={promptReq} onResolve={resolvePrompt} />}
        </>
    );
}

function PromptModal({ req, onResolve }: { req: { message: string; defaultValue?: string; confirmLabel?: string }; onResolve: (v: string | null) => void }) {
    const [val, setVal] = useState(req.defaultValue ?? '');
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
    return (
        <div className="modal-overlay" onClick={() => onResolve(null)}>
            <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="modal-header"><span className="modal-title">{req.message}</span></div>
                <div className="modal-body">
                    <input
                        ref={ref} value={val} onChange={(e) => setVal(e.target.value)} style={{ width: '100%' }}
                        onKeyDown={(e) => { if (e.key === 'Enter') onResolve(val); if (e.key === 'Escape') onResolve(null); }}
                    />
                </div>
                <div className="modal-footer">
                    <button onClick={() => onResolve(null)}>Cancel</button>
                    <button className="btn-primary" onClick={() => onResolve(val)}>{req.confirmLabel ?? 'Save'}</button>
                </div>
            </div>
        </div>
    );
}