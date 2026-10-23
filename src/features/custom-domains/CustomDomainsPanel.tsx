"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { clientLog } from "@/lib/client-log";
import { customDomainsApi as api } from "./api";
import { AddDomainForm } from "./AddDomainForm";
import { DomainCard } from "./DomainCard";
import { INITIAL_STATE, panelReducer } from "./state";
import type { StatusEvent } from "./types";

export function CustomDomainsPanel() {
  const { push } = useToast();
  const [state, dispatch] = useReducer(panelReducer, INITIAL_STATE);

  useEffect(() => {
    api.list().then((r) => dispatch(r.ok ? { type: "LOADED", domains: r.data } : { type: "LOAD_FAILED", message: r.message }));
  }, []);

  // Live status pushed by the server (agent results, other tabs). No polling.
  useEffect(() => {
    const source = new EventSource("/api/v1/custom-domains/events");
    source.addEventListener("status", (e) => {
      let event: StatusEvent;
      try {
        event = JSON.parse((e as MessageEvent<string>).data) as StatusEvent;
      } catch (err) {
        clientLog.error("status event parse failed", { err: String(err) });
        return;
      }
      if (event.status !== "removing") dispatch({ type: "STATUS", event });
      // Re-fetch for fields the event does not carry; a 404 means teardown finished.
      api.get(event.domainId).then((r) => {
        if (r.ok) dispatch({ type: "UPSERT", domain: r.data });
        else if (r.status === 404) dispatch({ type: "DELETE", id: event.domainId });
      });
    });
    return () => source.close();
  }, []);

  const add = useCallback(async (hostname: string, autoSsl: boolean) => {
    dispatch({ type: "ADDING", adding: true });
    const r = await api.add(hostname, autoSsl);
    if (!r.ok) { dispatch({ type: "ADDING", adding: false, error: r.message }); return; }
    dispatch({ type: "UPSERT", domain: r.data });
    dispatch({ type: "ADDING", adding: false });
    push({ kind: "success", text: `${r.data.hostname} added. Add the DNS records shown, then verify.` });
  }, [push]);

  const testDns = useCallback(async (id: string) => {
    dispatch({ type: "BUSY", id, busy: "test" });
    const r = await api.testDns(id);
    dispatch({ type: "BUSY", id, busy: null });
    if (!r.ok) { push({ kind: "error", text: r.message }); return; }
    dispatch({ type: "CHECK", id, check: r.data });
    push(r.data.passed
      ? { kind: "success", text: "DNS looks correct. You can verify now." }
      : { kind: "warning", text: "Some records are not ready yet. See the details below." });
  }, [push]);

  const verify = useCallback(async (id: string) => {
    dispatch({ type: "BUSY", id, busy: "verify" });
    const r = await api.verify(id);
    dispatch({ type: "BUSY", id, busy: null });
    if (r.ok) {
      dispatch({ type: "UPSERT", domain: r.data.domain });
      dispatch({ type: "CHECK", id, check: r.data.dnsCheck });
      push({ kind: "success", text: "Domain verified. Connecting it now." });
      return;
    }
    if (r.dnsCheck) dispatch({ type: "CHECK", id, check: r.dnsCheck });
    push({ kind: r.code === "DNS_NOT_READY" ? "warning" : "error", text: r.message });
    const refreshed = await api.get(id);
    if (refreshed.ok) dispatch({ type: "UPSERT", domain: refreshed.data });
  }, [push]);

  const retrySsl = useCallback(async (id: string) => {
    dispatch({ type: "BUSY", id, busy: "retry" });
    const r = await api.retrySsl(id);
    dispatch({ type: "BUSY", id, busy: null });
    if (!r.ok) { push({ kind: "error", text: r.message }); return; }
    dispatch({ type: "UPSERT", domain: r.data });
    push({ kind: "success", text: "Requesting a new certificate." });
  }, [push]);

  // Read through a ref so this callback (passed to every memoised card) stays stable.
  const domainsRef = useRef(state.domains);
  useEffect(() => { domainsRef.current = state.domains; }, [state.domains]);
  const askRemove = useCallback((id: string) => {
    dispatch({ type: "CONFIRM_REMOVE", domain: domainsRef.current.find((d) => d.id === id) ?? null });
  }, []);
  const cancelRemove = useCallback(() => dispatch({ type: "CONFIRM_REMOVE", domain: null }), []);

  const target = state.removeTarget;
  const confirmRemove = useCallback(async () => {
    if (!target) return;
    dispatch({ type: "BUSY", id: target.id, busy: "remove" });
    const r = await api.remove(target.id);
    dispatch({ type: "BUSY", id: target.id, busy: null });
    dispatch({ type: "CONFIRM_REMOVE", domain: null });
    if (!r.ok) { push({ kind: "error", text: r.message }); return; }
    if (r.data.status === "deleted") dispatch({ type: "DELETE", id: target.id });
    else dispatch({ type: "UPSERT", domain: { ...target, status: "removing" } });
    push({ kind: "success", text: r.data.status === "deleted" ? `${target.hostname} removed.` : `Removing ${target.hostname}.` });
  }, [target, push]);

  if (!state.loaded) {
    return <div id="cd_loading" className="flex items-center gap-2 text-sm text-muted"><Spinner id="cd_loading_spinner" /> Loading domains</div>;
  }

  return (
    <div id="cd_panel" className="space-y-6">
      {state.loadError && (
        <div id="cd_load_error" role="alert" className="rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">{state.loadError}</div>
      )}

      {state.domains.map((d) => (
        <DomainCard key={d.id} domain={d} check={state.checks[d.id] ?? null} busy={state.busy[d.id] ?? null}
          onTest={testDns} onVerify={verify} onRetrySsl={retrySsl} onRemove={askRemove} />
      ))}

      <Card id="cd_add_card" title={state.domains.length ? "Add another domain" : "Connect your own domain"}>
        <p id="cd_add_intro" className="mb-4 text-sm text-muted">
          Serve your pages on a domain you own. You add two DNS records at your DNS provider; they are verified and HTTPS is set up for you.
        </p>
        <AddDomainForm submitting={state.adding} error={state.addError} onSubmit={add} />
      </Card>

      <ConfirmDialog
        id="cd_remove_dialog"
        open={target !== null}
        title="Remove custom domain"
        message={`Visitors will no longer reach your pages at ${target?.hostname ?? "this domain"}. Its certificate is deleted. You can add it again later.`}
        confirmLabel="Remove domain"
        loading={target ? state.busy[target.id] === "remove" : false}
        onConfirm={confirmRemove}
        onCancel={cancelRemove}
      />
    </div>
  );
}
