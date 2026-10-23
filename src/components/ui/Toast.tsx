"use client";

/**
 * Toasts are dismissed by the user or replaced by the next one; there are no
 * auto-dismiss timers. The context value is stable, so pushing a toast never
 * re-renders consumers.
 */
import { createContext, memo, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ToastKind = "success" | "warning" | "error";
interface Toast { id: number; kind: ToastKind; text: string }
interface ToastApi { push: (t: { kind: ToastKind; text: string }) => void }

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE = 3;

const KIND_CLASS: Record<ToastKind, string> = {
  success: "border-success-line bg-success-bg text-success-fg",
  warning: "border-warning-line bg-warning-bg text-warning-fg",
  error: "border-danger-line bg-danger-bg text-danger-fg",
};

const ToastStack = memo(function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div id="ui_toast_stack" aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} id={`ui_toast_${t.id}`} role={t.kind === "error" ? "alert" : "status"}
          className={`flex items-start justify-between gap-3 rounded-control border px-4 py-3 text-sm shadow-md ${KIND_CLASS[t.kind]}`}>
          <span id={`ui_toast_${t.id}_text`}>{t.text}</span>
          <button id={`ui_toast_${t.id}_dismiss`} type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="opacity-70 hover:opacity-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: { kind: ToastKind; text: string }) => {
    setToasts((prev) => [...prev, { ...t, id: nextId++ }].slice(-MAX_VISIBLE));
  }, []);
  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const api = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
