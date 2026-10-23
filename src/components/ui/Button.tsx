"use client";

import { memo, type ButtonHTMLAttributes } from "react";
import { Spinner } from "./icons";

type Variant = "primary" | "secondary" | "ghost-danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong",
  secondary: "border border-border bg-surface text-ink hover:bg-neutral-bg",
  "ghost-danger": "text-danger-fg hover:bg-danger-bg",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  id: string;
  variant?: Variant;
  loading?: boolean;
}

export const Button = memo(function Button({ id, variant = "primary", loading = false, disabled, className = "", children, type = "button", ...rest }: Props) {
  return (
    <button
      id={id}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-control px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner id={`${id}_spinner`} />}
      {children}
    </button>
  );
});
