"use client";

/** Browser-side error reporting: records go to /api/client-logs (server log + error log file). */
function send(severity: "WARN" | "ERROR", message: string, attributes: Record<string, unknown>): void {
  void fetch("/api/client-logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ severity, message, attributes: { ...attributes, "url.path": window.location.pathname } }),
    keepalive: true,
  }).catch((err: unknown) => {
    // The log endpoint itself is unreachable; the browser console is the only place left.
    console.error("client log delivery failed", message, err);
  });
}

export const clientLog = {
  warn: (message: string, attributes: Record<string, unknown> = {}) => send("WARN", message, attributes),
  error: (message: string, attributes: Record<string, unknown> = {}) => send("ERROR", message, attributes),
};
