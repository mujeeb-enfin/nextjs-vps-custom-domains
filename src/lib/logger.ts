/**
 * OpenTelemetry-shaped JSON logs (one record per line on stdout).
 * ERROR records are also appended to NCD_ERROR_LOG_FILE when it is set, so
 * error logs can be checked after an E2E run. A failed file write is reported
 * on stderr, never swallowed.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Severity = "DEBUG" | "INFO" | "WARN" | "ERROR";
const SEVERITY_NUMBER: Record<Severity, number> = { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 };

function write(severity: Severity, body: string, attributes: Record<string, unknown>, stack?: string, source = "server"): void {
  const now = new Date().toISOString();
  const line = JSON.stringify({
    Timestamp: now,
    ObservedTimestamp: now,
    SeverityText: severity,
    SeverityNumber: SEVERITY_NUMBER[severity],
    Body: body,
    Resource: { "service.name": "nextjs-vps-custom-domains", "log.source": source },
    Attributes: { ...attributes, ...(stack ? { "exception.stacktrace": stack } : {}) },
  });
  process.stdout.write(`${line}\n`);

  const file = process.env.NCD_ERROR_LOG_FILE;
  if (severity === "ERROR" && file) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${line}\n`);
    } catch (err) {
      process.stderr.write(`error log write failed (${file}): ${String(err)}\n`);
    }
  }
}

function errorAttrs(err: unknown): { attrs: Record<string, unknown>; stack?: string } {
  if (err === undefined) return { attrs: {} };
  if (err instanceof Error) return { attrs: { "exception.type": err.name, "exception.message": err.message }, stack: err.stack };
  return { attrs: { "exception.message": String(err) } };
}

export const logger = {
  debug: (body: string, attrs: Record<string, unknown> = {}) => write("DEBUG", body, attrs),
  info: (body: string, attrs: Record<string, unknown> = {}) => write("INFO", body, attrs),
  warn: (body: string, attrs: Record<string, unknown> = {}) => write("WARN", body, attrs),
  error: (body: string, attrs: Record<string, unknown> = {}, err?: unknown) => {
    const e = errorAttrs(err);
    write("ERROR", body, { ...attrs, ...e.attrs }, e.stack);
  },
  /** Records reported by the browser through /api/client-logs. */
  client: (severity: "WARN" | "ERROR", body: string, attrs: Record<string, unknown>) => write(severity, body, attrs, undefined, "client"),
};
