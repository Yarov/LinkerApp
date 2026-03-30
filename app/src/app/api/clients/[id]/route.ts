import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { updatePPPoESecret, deletePPPoESecret, getActivePPPoE } from "@/lib/mikrotik";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        node: true,
        payments: { orderBy: { paidAt: "desc" } },
      },
    });

    if (!client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Enrich with plan data
    const plan = await prisma.plan.findUnique({ where: { profileName: client.profileName } });

    // Fetch active PPPoE session for this client
    let assignedIp: string | null = null;
    let isConnected = false;
    let sessionUptime: string | null = null;
    let sessionCallerId: string | null = null;

    try {
      const sessions = await getActivePPPoE();
      const session = sessions.find(s => s.name === client.pppoeUser);
      if (session) {
        assignedIp = session.address || null;
        isConnected = true;
        sessionUptime = session.uptime || null;
        sessionCallerId = session["caller-id"] || null;
      }
    } catch {
      // MikroTik unreachable - continue without session data
    }

    return NextResponse.json({
      ...client,
      plan: plan || null,
      assignedIp,
      isConnected,
      sessionUptime,
      sessionCallerId,
    });
  } catch (error) {
    console.error("GET /api/clients/[id] error:", error);
    return NextResponse.json({ error: "Error al obtener cliente" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Update PPPoE secret on MikroTik if relevant fields changed
    let mikrotikError: string | null = null;
    const pppoeChanged =
      (body.pppoePassword && body.pppoePassword !== existing.pppoePassword) ||
      (body.profileName && body.profileName !== existing.profileName);

    if (pppoeChanged) {
      try {
        await updatePPPoESecret(existing.pppoeUser, {
          password: body.pppoePassword || undefined,
          profile: body.profileName || undefined,
        });
      } catch (e) {
        mikrotikError = e instanceof Error ? e.message : "Error de MikroTik";
        console.error("Error al actualizar secreto PPPoE:", e);
      }
    }

    const client = await prisma.client.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        phone: body.phone !== undefined ? body.phone : existing.phone,
        address: body.address ?? existing.address,
        pppoePassword: body.pppoePassword ?? existing.pppoePassword,
        profileName: body.profileName ?? existing.profileName,
        nodeId: body.nodeId !== undefined ? body.nodeId : existing.nodeId,
        notes: body.notes !== undefined ? body.notes : existing.notes,
      },
      include: { node: true },
    });

    return NextResponse.json({ ...client, mikrotikError });
  } catch (error) {
    console.error("PUT /api/clients/[id] error:", error);
    return NextResponse.json({ error: "Error al actualizar cliente" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // ATOMIC: First delete from MikroTik, then from DB
    try {
      await deletePPPoESecret(existing.pppoeUser);
    } catch (e) {
      // If the secret doesn't exist on MikroTik, that's fine - continue with DB deletion
      const errorMsg = e instanceof Error ? e.message : "";
      const isNotFound =
        errorMsg.toLowerCase().includes("not found") ||
        errorMsg.toLowerCase().includes("no such item");
      if (!isNotFound) {
        console.error("Error al eliminar secreto PPPoE:", e);
        return NextResponse.json(
          { error: `Error al eliminar secreto PPPoE en MikroTik: ${errorMsg || "Error de MikroTik"}` },
          { status: 500 }
        );
      }
      // Secret already gone from MikroTik, proceed with DB deletion
      console.warn(`Secreto PPPoE '${existing.pppoeUser}' no encontrado en MikroTik, continuando con eliminación en BD`);
    }

    await prisma.client.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/clients/[id] error:", error);
    return NextResponse.json({ error: "Error al eliminar cliente" }, { status: 500 });
  }
}
