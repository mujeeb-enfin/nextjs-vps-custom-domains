"use client";

import { memo, useCallback } from "react";
import { CopyIcon } from "./icons";
import { useToast } from "./Toast";
import { clientLog } from "@/lib/client-log";

export const CopyButton = memo(function CopyButton({ id, text, label }: { id: string; text: string; label: string }) {
  const { push } = useToast();
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(
      () => push({ kind: "success", text: `${label} copied` }),
      (err: unknown) => {
        clientLog.error("clipboard write failed", { err: String(err) });
        push({ kind: "error", text: "Could not copy. Select the text and copy it manually." });
      },
    );
  }, [text, label, push]);
  return (
    <button id={id} type="button" onClick={copy} aria-label={`Copy ${label}`}
      className="rounded p-1 text-muted hover:bg-neutral-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
      <CopyIcon id={`${id}_icon`} />
    </button>
  );
});
