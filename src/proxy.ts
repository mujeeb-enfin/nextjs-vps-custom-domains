/**
 * Request proxy (Next.js 16 "proxy", formerly middleware).
 *
 * On a tenant's custom domain only the allow-listed public surfaces are
 * served; the dashboard and private APIs return 404 there. The root path is
 * rewritten to the tenant's hosted page.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isPlatformHostEdge, isAllowedOnCustomHost, HOSTED_ROOT } from "@/modules/custom-domains/edge-allowlist";

export function proxy(request: NextRequest): NextResponse {
  const host = request.headers.get("host") ?? "";
  if (isPlatformHostEdge(host)) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (!isAllowedOnCustomHost(pathname)) {
    return new NextResponse("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = HOSTED_ROOT;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
