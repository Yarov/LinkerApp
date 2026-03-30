import { NextResponse } from "next/server";
import { testVPNConnection } from "@/lib/vpn";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await testVPNConnection();
    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/vpn/test error:", error);
    return NextResponse.json(
      {
        vps: { reachable: false, latency: 0 },
        mikrotik: { reachable: false, latency: 0 },
        error: "Error al probar conexion VPN",
      },
      { status: 500 },
    );
  }
}
