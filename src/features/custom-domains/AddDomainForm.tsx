"use client";

import { memo, useCallback, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";

interface Props {
  submitting: boolean;
  error: string | null;
  onSubmit: (hostname: string, autoSsl: boolean) => void;
}

/** Validation happens server-side, so the rules live in one place. */
export const AddDomainForm = memo(function AddDomainForm({ submitting, error, onSubmit }: Props) {
  const [hostname, setHostname] = useState("");
  const [autoSsl, setAutoSsl] = useState(true);

  const submit = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (hostname.trim()) onSubmit(hostname.trim(), autoSsl);
  }, [hostname, autoSsl, onSubmit]);

  return (
    <form id="cd_add_form" onSubmit={submit} className="max-w-lg space-y-4" noValidate>
      <div>
        <label id="cd_add_hostname_label" htmlFor="cd_add_hostname" className="block text-sm font-medium text-ink">Your domain</label>
        <input
          id="cd_add_hostname"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="shop.yourcompany.com"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "cd_add_error" : "cd_add_help"}
          className="mt-1.5 w-full rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {error
          ? <p id="cd_add_error" role="alert" className="mt-1.5 text-xs text-danger-fg">{error}</p>
          : <p id="cd_add_help" className="mt-1.5 text-xs text-muted">Use a domain you own. A subdomain such as shop.yourcompany.com keeps your main website unaffected.</p>}
      </div>
      <div id="cd_add_autossl_row" className="flex items-start justify-between gap-4 rounded-control border border-border p-3">
        <div>
          <p id="cd_add_autossl_title" className="text-sm font-medium text-ink">Automatic HTTPS (Let&apos;s Encrypt)</p>
          <p id="cd_add_autossl_help" className="mt-0.5 text-xs text-muted">
            A free certificate is issued and renewed automatically. Turn this off only if you terminate HTTPS on your own proxy.
          </p>
        </div>
        <Toggle id="cd_add_autossl" checked={autoSsl} onChange={setAutoSsl} label="Automatic HTTPS" />
      </div>
      <Button id="cd_add_submit" type="submit" loading={submitting} disabled={!hostname.trim()}>Add domain</Button>
    </form>
  );
});
