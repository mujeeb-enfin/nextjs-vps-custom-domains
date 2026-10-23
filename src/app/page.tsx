import { cookies } from "next/headers";
import { authenticate, isAuthFailure, SESSION_COOKIE } from "@/lib/auth";
import { getPlatformConfig } from "@/lib/env";
import { Card } from "@/components/ui/Card";
import { GlobeIcon } from "@/components/ui/icons";
import { CustomDomainsPanel } from "@/features/custom-domains/CustomDomainsPanel";
import { SignInForm, SignOutButton } from "@/features/custom-domains/SignInForm";

export const dynamic = "force-dynamic";

/** Dashboard (platform host only; the proxy never serves it on a custom domain). */
export default async function DashboardPage() {
  const key = (await cookies()).get(SESSION_COOKIE)?.value;
  const actor = key
    ? await authenticate(new Request("http://internal/", { headers: { authorization: `Bearer ${key}` } }), { write: false })
    : null;
  const signedIn = actor !== null && !isAuthFailure(actor);
  const { platformName } = getPlatformConfig();

  return (
    <main id="cd_page" className="mx-auto max-w-4xl px-6 py-10">
      <header id="cd_page_header" className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-brand"><GlobeIcon id="cd_page_logo" /></span>
          <div>
            <h1 id="cd_page_title" className="text-xl font-semibold">Custom domains</h1>
            <p id="cd_page_subtitle" className="text-sm text-muted">Serve your {platformName} pages on a domain you own.</p>
          </div>
        </div>
        {signedIn && <SignOutButton />}
      </header>
      {signedIn ? <CustomDomainsPanel /> : <Card id="cd_signin_card" title="Sign in"><SignInForm /></Card>}
    </main>
  );
}
