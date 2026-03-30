import { NextResponse } from "next/server";
import { connectVPN } from "@/lib/vpn";

export async function POST() {
  try {
    const result = await connectVPN();

    if (result.success) {
      return NextResponse.json({ success: true, status: "connected" });
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
    console.error("POST /api/vpn/connect error:", error);
    return NextResponse.json(
      { success: false, error: "Error al conectar VPN" },
      { status: 500 },
    );
  }
}
