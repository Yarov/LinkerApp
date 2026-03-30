import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enablePPPoESecret, disablePPPoESecret } from "@/lib/mikrotik";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = await prisma.client.findUnique({ where: { id } });

    if (!client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const newStatus = client.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";

    // ATOMIC: First try MikroTik, only then update DB
    try {
      if (newStatus === "SUSPENDED") {
        await disablePPPoESecret(client.pppoeUser);
      } else {
        await enablePPPoESecret(client.pppoeUser);
      }
    } catch (e) {
      const mikrotikError = e instanceof Error ? e.message : "Error de MikroTik";
      console.error("Error al cambiar estado PPPoE:", e);
      return NextResponse.json(
        {
          error: `Error al ${newStatus === "SUSPENDED" ? "suspender" : "activar"} en MikroTik: ${mikrotikError}`,
          currentStatus: client.status,
        },
        { status: 500 }
      );
    }

    // MikroTik succeeded, now update DB
    const updated = await prisma.client.update({
      where: { id },
      data: { status: newStatus },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("POST /api/clients/[id]/toggle error:", error);
    return NextResponse.json({ error: "Error al cambiar estado del cliente" }, { status: 500 });
  }
}
