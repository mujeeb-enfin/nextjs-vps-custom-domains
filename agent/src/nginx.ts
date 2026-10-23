/**
 * Renders and installs per-domain nginx configs. Every change follows:
 *   write tmp → atomic rename → `nginx -t` → reload
 * and on a failed test the previous file is restored (or the new one removed)
 * so a bad config can never take down the other sites on this host.
 */
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { nginxTest, nginxReload } from "./exec.js";
import { assertSafeHostname, certName } from "./hostname.js";
import type { AgentConfig } from "./config.js";

export type VhostMode = "acme" | "https" | "http-external-ssl";

const TEMPLATE_FOR: Record<VhostMode, string> = {
  acme: "acme.conf.tmpl",
  https: "https.conf.tmpl",
  "http-external-ssl": "http-external-ssl.conf.tmpl",
};

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`template variable missing: ${key}`);
    return v;
  });
}

export function vhostPath(cfg: AgentConfig, hostname: string): string {
  return join(cfg.vhostDir, `${certName(hostname, cfg.platformDomains)}.conf`);
}

export function renderVhost(cfg: AgentConfig, hostname: string, mode: VhostMode): string {
  const h = assertSafeHostname(hostname, cfg.platformDomains);
  const tpl = readFileSync(join(cfg.templatesDir, TEMPLATE_FOR[mode]), "utf8");
  return render(tpl, {
    HOSTNAME: h,
    CERT_NAME: certName(h, cfg.platformDomains),
    UPSTREAM: cfg.upstream,
    ACME_WEBROOT: cfg.acmeWebroot,
  });
}

/** Install (or replace) a vhost; rolls back on `nginx -t` failure. */
export async function installVhost(cfg: AgentConfig, hostname: string, mode: VhostMode): Promise<void> {
  const target = vhostPath(cfg, hostname);
  const backup = `${target}.bak`;
  const tmp = `${target}.tmp`;
  const hadPrevious = existsSync(target);
  if (hadPrevious) copyFileSync(target, backup);

  writeFileSync(tmp, renderVhost(cfg, hostname, mode), { mode: 0o644 });
  renameSync(tmp, target);
  try {
    await nginxTest();
  } catch (err) {
    if (hadPrevious) renameSync(backup, target);
    else rmSync(target, { force: true });
    throw err;
  }
  if (hadPrevious) rmSync(backup, { force: true });
  await nginxReload();
}

/** Remove a vhost; restores it if the remaining config fails `nginx -t`. */
export async function removeVhost(cfg: AgentConfig, hostname: string): Promise<void> {
  const target = vhostPath(cfg, hostname);
  if (!existsSync(target)) return;
  const backup = `${target}.bak`;
  renameSync(target, backup);
  try {
    await nginxTest();
  } catch (err) {
    renameSync(backup, target);
    throw err;
  }
  rmSync(backup, { force: true });
  await nginxReload();
}
