import { NextResponse } from "next/server";
import { getActivePPPoE } from "@/lib/mikrotik";

export async function GET() {
  try {
    const sessions = await getActivePPPoE();

    return NextResponse.json(
      sessions.map((s) => ({
        name: s.name,
        service: s.service,
        callerId: s["caller-id"] || s.callerId,
        address: s.address,
        uptime: s.uptime,
        encoding: s.encoding,
      }))
    );
  } catch (error) {
    console.error("GET /api/mikrotik/pppoe error:", error);
    return NextResponse.json({ error: "Failed to fetch PPPoE sessions" }, { status: 500 });
  }
}
