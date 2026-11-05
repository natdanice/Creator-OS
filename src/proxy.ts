import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, SESSION_COOKIE, verifySession } from "@/lib/auth";

/** Optimistic login check: every page and API needs a session when APP_PASSWORD is set. */
export async function proxy(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const url = new URL("/login", req.url);
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Open: the login page, Next.js assets, the icon, the cron job (own secret) and platform webhooks (own signatures).
  matcher: ["/((?!login|_next/|icon\\.svg|favicon\\.ico|api/cron/|api/webhooks/).*)"],
};
