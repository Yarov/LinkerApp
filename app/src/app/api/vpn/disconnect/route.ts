import { NextResponse } from "next/server";
import { disconnectVPN } from "@/lib/vpn";

export async function POST() {
  try {
    const result = await disconnectVPN();

    if (result.success) {
      return NextResponse.json({ success: true, status: "disconnected" });
    }

    const statusCode = result.needsManual ? 403 : 500;
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        needsManual: result.needsManual ?? false,
      },
      { status: statusCode },
    );
  } catch (error) {
    console.error("POST /api/vpn/disconnect error:", error);
    return NextResponse.json(
      { success: false, error: "Error al desconectar VPN" },
      { status: 500 },
    );
  }
}
