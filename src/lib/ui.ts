import { create } from 'zustand';

export type Toast = { id: number; message: string; kind: 'info' | 'success' | 'error' };
type ConfirmReq = { message: string; title?: string; danger?: boolean; confirmLabel?: string } | null;
type PromptReq = { message: string; defaultValue?: string; confirmLabel?: string } | null;

type UIState = {
    toasts: Toast[];
    toast: (message: string, kind?: Toast['kind']) => void;
    dismissToast: (id: number) => void;

    confirmReq: ConfirmReq;
    confirmResolver: ((v: boolean) => void) | null;
    confirm: (message: string, opts?: { title?: string; danger?: boolean; confirmLabel?: string }) => Promise<boolean>;
    resolveConfirm: (v: boolean) => void;

    promptReq: PromptReq;
    promptResolver: ((v: string | null) => void) | null;
    promptText: (message: string, defaultValue?: string, confirmLabel?: string) => Promise<string | null>;
    resolvePrompt: (v: string | null) => void;

    // responsive drawers (tool rail + properties panel) below the 1024px breakpoint
    railOpen: boolean;
    panelOpen: boolean;
    setRailOpen: (v: boolean) => void;
    setPanelOpen: (v: boolean) => void;
};

let seq = 1;

export const useUI = create<UIState>()((set, get) => ({
    toasts: [],
    toast: (message, kind = 'info') => {
        const id = seq++;
        set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
        setTimeout(() => get().dismissToast(id), kind === 'error' ? 5000 : 3200);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    confirmReq: null,
    confirmResolver: null,
    confirm: (message, opts) =>
        new Promise<boolean>((resolve) => {
            set({ confirmReq: { message, ...opts }, confirmResolver: resolve });
        }),
    resolveConfirm: (v) => {
        get().confirmResolver?.(v);
        set({ confirmReq: null, confirmResolver: null });
    },

    promptReq: null,
    promptResolver: null,
    promptText: (message, defaultValue = '', confirmLabel) =>
        new Promise<string | null>((resolve) => {
            set({ promptReq: { message, defaultValue, confirmLabel }, promptResolver: resolve });
        }),
    resolvePrompt: (v) => {
        get().promptResolver?.(v);
        set({ promptReq: null, promptResolver: null });
    },

    railOpen: false,
    panelOpen: false,
    setRailOpen: (v) => set({ railOpen: v }),
    setPanelOpen: (v) => set({ panelOpen: v }),
}));