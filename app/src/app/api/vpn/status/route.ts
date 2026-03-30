import { NextResponse } from "next/server";
import { getVPNStatus } from "@/lib/vpn";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getVPNStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("GET /api/vpn/status error:", error);
    return NextResponse.json(
      {
        connected: false,
        interface: null,
        peers: [],
        error: "Error al verificar estado de VPN",
      },
      { status: 500 },
    );
  }
}
