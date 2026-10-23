"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { customDomainsApi as api } from "./api";

/** Signs the dashboard in with an API key (stored only as an httpOnly cookie). */
export function SignInForm() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const r = await api.signIn(apiKey.trim());
    setSubmitting(false);
    if (!r.ok) { setError(r.message); return; }
    router.refresh();
  }, [apiKey, router]);

  return (
    <form id="cd_signin_form" onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label id="cd_signin_key_label" htmlFor="cd_signin_key" className="block text-sm font-medium text-ink">API key</label>
        <input id="cd_signin_key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off" spellCheck={false} placeholder="ncd_..."
          aria-invalid={error ? true : undefined} aria-describedby={error ? "cd_signin_error" : "cd_signin_help"}
          className="mt-1.5 w-full rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        {error
          ? <p id="cd_signin_error" role="alert" className="mt-1.5 text-xs text-danger-fg">{error}</p>
          : <p id="cd_signin_help" className="mt-1.5 text-xs text-muted">Create one with <code className="font-mono">npm run owner:create</code>.</p>}
      </div>
      <Button id="cd_signin_submit" type="submit" loading={submitting} disabled={!apiKey.trim()}>Sign in</Button>
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = useCallback(async () => {
    setBusy(true);
    await api.signOut();
    router.refresh();
  }, [router]);
  return <Button id="cd_signout" variant="secondary" loading={busy} onClick={signOut}>Sign out</Button>;
}
