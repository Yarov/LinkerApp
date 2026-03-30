import { NextRequest, NextResponse } from "next/server";
import { createVPNConfig } from "@/lib/vpn";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      vpsIp,
      vpsPort,
      vpsPublicKey,
      localAddress,
      allowedIPs,
    } = body;

    if (!vpsIp || !vpsPort || !vpsPublicKey || !localAddress) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Campos requeridos: vpsIp, vpsPort, vpsPublicKey, localAddress",
        },
        { status: 400 },
      );
    }

    // allowedIPs can come as an array or comma-separated string
    const allowedIPsStr = Array.isArray(allowedIPs)
      ? allowedIPs.join(", ")
      : allowedIPs || "10.10.10.0/24";

    const result = await createVPNConfig({
      vpsIp,
      vpsPort,
      vpsPublicKey,
      localAddress,
      allowedIPs: allowedIPsStr,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      publicKey: result.publicKey,
      message:
        "Configuracion creada. Agrega esta clave publica en el VPS como peer.",
    });
  } catch (error) {
    console.error("POST /api/vpn/setup error:", error);
    return NextResponse.json(
      { success: false, error: "Error al configurar VPN" },
      { status: 500 },
    );
  }
}
