"use client";

import { memo } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import type { DnsCheckResult, RecordCheck, RequiredRecord } from "./types";

const CHECK_LABEL: Record<RecordCheck["status"], string> = { ok: "Found", missing: "Not found", mismatch: "Wrong value", error: "Lookup failed" };
const CHECK_CLASS: Record<RecordCheck["status"], string> = {
  ok: "border-success-line bg-success-bg text-success-fg",
  missing: "border-warning-line bg-warning-bg text-warning-fg",
  mismatch: "border-danger-line bg-danger-bg text-danger-fg",
  error: "border-danger-line bg-danger-bg text-danger-fg",
};

interface Props {
  domainId: string;
  records: RequiredRecord[];
  check: DnsCheckResult | null;
}

/** The records to add at the DNS provider, with copy buttons and the latest check per record. */
export const DnsRecordsTable = memo(function DnsRecordsTable({ domainId, records, check }: Props) {
  const problems = check?.records.filter((r) => r.status !== "ok") ?? [];
  return (
    <div id={`cd_records_${domainId}`} className="space-y-3">
      <div className="overflow-x-auto rounded-control border border-border">
        <table id={`cd_records_table_${domainId}`} className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-left text-xs font-medium text-muted">
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Host / Name</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => {
              const result = check?.records.find((r) => r.kind === rec.id);
              const rowId = `cd_record_${rec.id}_${domainId}`;
              return (
                <tr key={rec.id} id={rowId} className="border-t border-border align-top">
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold">{rec.type}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <code id={`${rowId}_host`} className="break-all font-mono text-xs">{rec.host}</code>
                      <CopyButton id={`${rowId}_host_copy`} text={rec.host} label={`${rec.type} host`} />
                    </div>
                    <p className="mt-0.5 break-all text-[11px] text-muted">{rec.name}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <code id={`${rowId}_value`} className="break-all font-mono text-xs">{rec.value}</code>
                      <CopyButton id={`${rowId}_value_copy`} text={rec.value} label={`${rec.type} value`} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">{rec.purpose}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    {result ? (
                      <span id={`${rowId}_status`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${CHECK_CLASS[result.status]}`}>
                        {result.status === "ok" ? <CheckIcon id={`${rowId}_status_icon`} /> : <AlertIcon id={`${rowId}_status_icon`} />}
                        {CHECK_LABEL[result.status]}
                      </span>
                    ) : (
                      <span id={`${rowId}_status`} className="text-xs text-muted">Not checked</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {problems.length > 0 && (
        <ul id={`cd_check_messages_${domainId}`} className="space-y-1.5">
          {problems.map((r) => (
            <li key={r.kind} id={`cd_check_msg_${r.kind}_${domainId}`} className="flex gap-2 text-xs text-ink">
              <span className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${CHECK_CLASS[r.status]}`}>
                <AlertIcon id={`cd_check_msg_${r.kind}_${domainId}_icon`} />
              </span>
              <span>
                {r.message}
                {r.found.length > 0 && (
                  <span className="block text-muted">Currently returns: <code className="font-mono">{r.found.join(", ")}</code></span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
