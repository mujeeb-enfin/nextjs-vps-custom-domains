"use client";

import { memo } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/icons";
import { DnsRecordsTable } from "./DnsRecordsTable";
import { STATUS_META, TONE_CLASS, type CustomDomain, type DnsCheckResult } from "./types";

export type Busy = "test" | "verify" | "retry" | "remove" | null;

interface Props {
  domain: CustomDomain;
  check: DnsCheckResult | null;
  busy: Busy;
  onTest: (id: string) => void;
  onVerify: (id: string) => void;
  onRetrySsl: (id: string) => void;
  onRemove: (id: string) => void;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not yet";
}

export const DomainCard = memo(function DomainCard({ domain, check, busy, onTest, onVerify, onRetrySsl, onRemove }: Props) {
  const meta = STATUS_META[domain.status];
  const id = domain.id;
  const canVerify = domain.status === "pending_dns" || domain.status === "dns_lost";
  const inProgress = meta.tone === "progress";
  const live = meta.tone === "success";

  return (
    <Card
      id={`cd_card_${id}`}
      testHandle="domain-card"
      title={<span className="font-mono">{domain.hostname}</span>}
      action={<span id={`cd_status_${id}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[meta.tone]}`}>
        {inProgress && <Spinner id={`cd_status_${id}_spinner`} />}{meta.label}
      </span>}
    >
      <div className="space-y-4">
        <p id={`cd_status_text_${id}`} className="text-sm text-muted">{meta.description}</p>

        {domain.lastError && (
          <div id={`cd_error_${id}`} role="alert" className="whitespace-pre-wrap rounded-control border border-danger-line bg-danger-bg p-3 text-xs text-danger-fg">
            {domain.lastError}
          </div>
        )}

        {domain.isApex && !live && (
          <p id={`cd_apex_warning_${id}`} className="rounded-control border border-warning-line bg-warning-bg p-3 text-xs text-warning-fg">
            This is your root domain. Pointing it here moves your whole website. Use a subdomain unless that is intended.
          </p>
        )}

        {!live && (
          <>
            <div>
              <h3 id={`cd_records_title_${id}`} className="text-sm font-semibold text-ink">Add these records at your DNS provider</h3>
              <p id={`cd_records_help_${id}`} className="mt-0.5 text-xs text-muted">
                On Cloudflare, set the CNAME to <strong>DNS only</strong> (grey cloud). Remove any existing A or AAAA records for this name first.
                Changes usually apply within minutes but can take up to 48 hours.
              </p>
            </div>
            <DnsRecordsTable domainId={id} records={domain.records} check={check} />
          </>
        )}

        {live && (
          <dl id={`cd_live_${id}`} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted">Live URL</dt><dd id={`cd_live_url_${id}`} className="font-mono text-xs">https://{domain.hostname}</dd></div>
            <div><dt className="text-xs text-muted">Verified</dt><dd id={`cd_live_verified_${id}`}>{fmt(domain.verifiedAt)}</dd></div>
            {domain.autoSsl && <div><dt className="text-xs text-muted">Certificate valid until</dt><dd id={`cd_live_expiry_${id}`}>{fmt(domain.sslExpiresAt)}</dd></div>}
          </dl>
        )}

        <div id={`cd_actions_${id}`} className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {canVerify && (
            <>
              <Button id={`cd_test_dns_${id}`} variant="secondary" loading={busy === "test"} disabled={busy !== null} onClick={() => onTest(id)}>Test my DNS</Button>
              <Button id={`cd_verify_${id}`} loading={busy === "verify"} disabled={busy !== null} onClick={() => onVerify(id)}>Verify domain</Button>
            </>
          )}
          {domain.status === "ssl_failed" && (
            <Button id={`cd_retry_ssl_${id}`} loading={busy === "retry"} disabled={busy !== null} onClick={() => onRetrySsl(id)}>Retry certificate</Button>
          )}
          {domain.status !== "removing" && (
            <Button id={`cd_remove_${id}`} variant="ghost-danger" className="ml-auto" disabled={busy !== null} onClick={() => onRemove(id)}>Remove domain</Button>
          )}
          {check && (
            <span id={`cd_checked_at_${id}`} className="w-full text-[11px] text-muted">Last checked {fmt(check.checkedAt)} via {check.resolvers.join(", ")}</span>
          )}
        </div>
      </div>
    </Card>
  );
});
