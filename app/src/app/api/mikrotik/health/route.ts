import { NextResponse } from "next/server";
import { RouterOSAPI } from "routeros-api";

export async function GET() {
  const host = process.env.MIKROTIK_HOST || "10.10.10.3";
  const port = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
  const user = process.env.MIKROTIK_USER || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "";

  const start = Date.now();

  try {
    const api = new RouterOSAPI({
      host,
      port,
      user,
      password,
      timeout: 3,
    });

    await api.connect();
    api.close();

    const latency = Date.now() - start;

    return NextResponse.json({ connected: true, latency });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json({
      connected: false,
      error: message.includes("Timeout") ? "timeout" : message,
    });
  }
}
