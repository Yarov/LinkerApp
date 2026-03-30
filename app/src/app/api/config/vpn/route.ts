import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * @deprecated Use /api/vpn/status instead.
 * This route redirects to the new VPN status endpoint.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const newUrl = `${url.origin}/api/vpn/status`;
  return NextResponse.redirect(newUrl, 308);
}
