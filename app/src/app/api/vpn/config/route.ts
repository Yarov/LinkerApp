import { NextRequest, NextResponse } from "next/server";
import { readVPNConfig, writeVPNConfig, type VPNConfig } from "@/lib/vpn";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await readVPNConfig();
    if (!config) {
      return NextResponse.json(
        { error: "No se encontro archivo de configuracion VPN" },
        { status: 404 },
      );
    }

    // Never expose the private key to the frontend
    return NextResponse.json({
      address: config.address,
      dns: config.dns,
      peerPublicKey: config.peerPublicKey,
      endpoint: config.endpoint,
      allowedIPs: config.allowedIPs,
      persistentKeepalive: config.persistentKeepalive,
      hasPrivateKey: !!config.privateKey,
    });
  } catch (error) {
    console.error("GET /api/vpn/config error:", error);
    return NextResponse.json(
      { error: "Error al leer configuracion VPN" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Read current config so we keep the private key unless explicitly provided
    const current = await readVPNConfig();

    const config: VPNConfig = {
      privateKey: body.privateKey || current?.privateKey || "",
      address: body.address ?? current?.address ?? "",
      dns: body.dns ?? current?.dns ?? "8.8.8.8",
      peerPublicKey: body.peerPublicKey ?? current?.peerPublicKey ?? "",
      endpoint: body.endpoint ?? current?.endpoint ?? "",
      allowedIPs: body.allowedIPs ?? current?.allowedIPs ?? "",
      persistentKeepalive: body.persistentKeepalive ?? current?.persistentKeepalive ?? 25,
    };

    if (!config.privateKey) {
      return NextResponse.json(
        { success: false, error: "Private key is required" },
        { status: 400 },
      );
    }

    const result = await writeVPNConfig(config);
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error) {
    console.error("PUT /api/vpn/config error:", error);
    return NextResponse.json(
      { success: false, error: "Error al guardar configuracion VPN" },
      { status: 500 },
    );
  }
}
