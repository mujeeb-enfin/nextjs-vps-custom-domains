/**
 * Privileged operations, all through the root-owned /usr/local/sbin/ncd-certctl
 * wrapper (the only command sudoers allows). The wrapper re-validates every
 * argument; the agent also validates hostnames before calling.
 */
import { execFile } from "node:child_process";

export interface ExecResult { stdout: string; stderr: string }

export class CommandError extends Error {
  constructor(public readonly command: string, public readonly code: number | null, public readonly stderr: string) {
    super(`${command} exited with ${code}: ${stderr.trim().slice(0, 1500)}`);
  }
}

const CERTCTL = "/usr/local/sbin/ncd-certctl";

/** Runs the root wrapper through sudo with a fixed argv (no shell). */
function run(args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/sudo", ["-n", CERTCTL, ...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const code = typeof (err as unknown as { code?: unknown }).code === "number" ? (err as unknown as { code: number }).code : null;
        reject(new CommandError(`ncd-certctl ${args[0] ?? ""}`.trim(), code, stderr || err.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export const nginxTest = () => run(["nginx-test"], 30_000);
export const nginxReload = () => run(["nginx-reload"], 30_000);

export const certbotIssue = (opts: { hostname: string; email: string; staging: boolean }) =>
  run(["issue", opts.hostname, opts.email, String(opts.staging)], 180_000);

export const certbotDelete = (hostname: string) => run(["delete", hostname], 60_000);

/** Certificate expiry (ISO), or null when no certificate exists for the hostname. */
export async function certificateNotAfter(hostname: string): Promise<string | null> {
  try {
    const { stdout } = await run(["expiry", hostname], 15_000);
    const m = /notAfter=(.+)/.exec(stdout.trim());
    if (!m?.[1]) throw new Error(`unexpected openssl output: ${stdout.trim()}`);
    return new Date(m[1]).toISOString();
  } catch (err) {
    if (err instanceof CommandError && /no such file|could not open|unable to load/i.test(err.stderr)) return null;
    throw err;
  }
}
