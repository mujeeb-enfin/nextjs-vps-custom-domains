"use client";

import { memo, useEffect, useRef } from "react";
import { Button } from "./Button";

interface Props {
  id: string;
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Native <dialog>: focus trapping, Escape and the backdrop come from the browser. */
export const ConfirmDialog = memo(function ConfirmDialog({ id, open, title, message, confirmLabel, loading, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog id={id} ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby={`${id}_title`}
      className="m-auto w-[28rem] max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40">
      <div className="p-6">
        <h2 id={`${id}_title`} className="text-base font-semibold">{title}</h2>
        <p id={`${id}_message`} className="mt-2 text-sm text-muted">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button id={`${id}_cancel`} variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button id={`${id}_confirm`} variant="primary" className="bg-danger-fg hover:bg-danger-fg/90" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
});
