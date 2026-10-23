/** OTEL-structured JSON logs (same shape as the app's serverLogger). */
import { appendFileSync } from "node:fs";

type Severity = "INFO" | "WARN" | "ERROR";
const SEVERITY_NUMBER: Record<Severity, number> = { INFO: 9, WARN: 13, ERROR: 17 };

let logFile: string | null = null;

export function initLog(path: string): void {
  logFile = path;
}

function write(severity: Severity, body: string, attributes: Record<string, unknown>, stack?: string): void {
  const now = new Date().toISOString();
  const record = {
    Timestamp: now,
    ObservedTimestamp: now,
    SeverityText: severity,
    SeverityNumber: SEVERITY_NUMBER[severity],
    Body: body,
    Resource: { "service.name": "ncd-agent", "service.version": "1.0.0" },
    Attributes: { ...attributes, ...(stack ? { "exception.stacktrace": stack } : {}) },
    TraceId: "",
    SpanId: "",
  };
  const line = JSON.stringify(record);
  // stdout → journald; file → log shipping. A failed file write must not be silent.
  process.stdout.write(`${line}\n`);
  if (logFile) {
    try {
      appendFileSync(logFile, `${line}\n`);
    } catch (err) {
      process.stderr.write(`log file write failed (${logFile}): ${String(err)}\n`);
    }
  }
}

export const log = {
  info: (body: string, attrs: Record<string, unknown> = {}) => write("INFO", body, attrs),
  warn: (body: string, attrs: Record<string, unknown> = {}) => write("WARN", body, attrs),
  error: (body: string, attrs: Record<string, unknown> = {}, err?: unknown) =>
    write("ERROR", body, { ...attrs, ...(err ? { "exception.message": err instanceof Error ? err.message : String(err) } : {}) },
      err instanceof Error ? err.stack : undefined),
};
