/**
 * Pre-issuance DNS re-check. Let's Encrypt HTTP-01 fails (and burns rate limit)
 * if the hostname does not reach this server, so confirm first with public
 * resolvers.
 *
 * Tenants CNAME to the platform routing hostname, so "points here" means the
 * hostname resolves to exactly the routing target's addresses (this also covers
 * apex CNAME flattening). Messages never name server IPs.
 */
import { Resolver } from "node:dns/promises";

function sameSet(a: string[], b: string[]): boolean {
  const x = new Set(a), y = new Set(b);
  return x.size > 0 && x.size === y.size && [...x].every((v) => y.has(v));
}

export async function pointsHere(hostname: string, cnameTarget: string, resolvers: string[]): Promise<{ ok: boolean; error?: string }> {
  const r = new Resolver({ timeout: 3000, tries: 2 });
  r.setServers(resolvers);
  try {
    const [own, target] = await Promise.all([
      r.resolve4(hostname).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOTFOUND" || err.code === "ENODATA") return [] as string[];
        throw err;
      }),
      r.resolve4(cnameTarget),
    ]);
    return { ok: sameSet(own, target) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    return { ok: false, error: `${code}: ${(err as Error).message}` };
  }
}
