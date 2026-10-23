import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { checkHostOwnership } from "@/modules/custom-domains/ownership";

export const dynamic = "force-dynamic";

/**
 * The tenant's hosted page, shown at "/" on their custom domain. Replace this
 * with your product's public surface (checkout, storefront, status page...).
 * Pattern to copy: resolve the owner from the Host header via
 * checkHostOwnership(), then load ONLY that owner's data.
 */
export default async function HostedPage() {
  const host = (await headers()).get("host");
  const ownership = await checkHostOwnership(host, null);
  if (!ownership.allowed || !ownership.ownerId) notFound();

  const owner = await db().owner.findUnique({ where: { id: ownership.ownerId }, select: { name: true } });
  if (!owner) notFound();

  return (
    <main id="hosted_page" className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <h1 id="hosted_title" className="text-2xl font-semibold">{owner.name}</h1>
      <p id="hosted_subtitle" className="mt-2 text-sm text-muted">
        You are on <span id="hosted_domain" className="font-mono">{ownership.customDomain}</span>, served over HTTPS.
      </p>
    </main>
  );
}
