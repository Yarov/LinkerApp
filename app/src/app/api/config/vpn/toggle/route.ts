import { NextRequest, NextResponse } from "next/server";

/**
 * @deprecated Use /api/vpn/connect or /api/vpn/disconnect instead.
 * This route proxies to the new endpoints for backwards compatibility.
 */
export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();
    const url = new URL(request.url);
    const target =
      action === "up"
        ? `${url.origin}/api/vpn/connect`
        : `${url.origin}/api/vpn/disconnect`;

    const res = await fetch(target, { method: "POST" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("POST /api/config/vpn/toggle error:", error);
    return NextResponse.json(
      { success: false, error: "Error al cambiar estado de VPN" },
      { status: 500 },
    );
  }
}
