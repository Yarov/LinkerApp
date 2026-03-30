import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "crypto";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and auth API routes
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Check for session cookie
  const session = request.cookies.get("lk-session");
  if (!session?.value) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Validate session hash
  const adminPassword = process.env.ADMIN_PASSWORD || "linker2026";
  const expectedHash = createHash("sha256")
    .update(adminPassword)
    .digest("hex");
  if (session.value !== expectedHash) {
    // Invalid session - clear cookie and redirect
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set("lk-session", "", { maxAge: 0 });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
