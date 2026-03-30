import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createPPPoESecret, getActivePPPoE } from "@/lib/mikrotik";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const clients = await prisma.client.findMany({
      where,
      include: { node: true },
      orderBy: { name: "asc" },
    });

    // Enrich clients with plan data by matching profileName
    const plans = await prisma.plan.findMany();
    const planMap = Object.fromEntries(plans.map(p => [p.profileName, p]));

    // Fetch active PPPoE sessions from MikroTik
    let activeSessions: Array<{ name: string; address: string; uptime: string; "caller-id": string; [key: string]: string }> = [];
    try {
      activeSessions = await getActivePPPoE();
    } catch {
      // MikroTik unreachable - continue without session data
    }
    const sessionMap = Object.fromEntries(
      activeSessions.map(s => [s.name, s])
    );

    const enriched = clients.map(c => {
      const session = sessionMap[c.pppoeUser];
      return {
        ...c,
        plan: planMap[c.profileName] || null,
        assignedIp: session?.address || null,
        isConnected: !!session,
        sessionUptime: session?.uptime || null,
        sessionCallerId: session?.["caller-id"] || null,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("GET /api/clients error:", error);
    return NextResponse.json({ error: "Error al obtener clientes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // --- Input validation ---
    const errors: string[] = [];

    if (!body.name || typeof body.name !== "string" || body.name.trim().length < 2) {
      errors.push("El nombre es requerido y debe tener al menos 2 caracteres");
    } else if (body.name.trim().length > 100) {
      errors.push("El nombre no puede exceder 100 caracteres");
    }

    if (!body.pppoeUser || typeof body.pppoeUser !== "string") {
      errors.push("El usuario PPPoE es requerido");
    } else if (body.pppoeUser.length < 3 || body.pppoeUser.length > 30) {
      errors.push("El usuario PPPoE debe tener entre 3 y 30 caracteres");
    } else if (!/^[a-z0-9-]+$/.test(body.pppoeUser)) {
      errors.push("El usuario PPPoE solo puede contener letras minúsculas, números y guiones");
    }

    if (!body.pppoePassword || typeof body.pppoePassword !== "string" || body.pppoePassword.length < 4) {
      errors.push("La contraseña PPPoE es requerida y debe tener al menos 4 caracteres");
    }

    if (!body.profileName || typeof body.profileName !== "string") {
      errors.push("El perfil es requerido");
    }

    if (!body.address || typeof body.address !== "string" || body.address.trim().length === 0) {
      errors.push("La dirección es requerida");
    }

    if (body.phone !== undefined && body.phone !== null && body.phone !== "") {
      const phoneStr = String(body.phone).replace(/\s/g, "");
      if (!/^\d{10}$/.test(phoneStr)) {
        errors.push("El teléfono debe tener exactamente 10 dígitos");
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(". ") }, { status: 400 });
    }

    // Validate profileName matches an existing plan
    if (body.profileName) {
      const plan = await prisma.plan.findUnique({ where: { profileName: body.profileName } });
      if (!plan) {
        return NextResponse.json(
          { error: "El perfil seleccionado no existe. Debe coincidir con un plan existente." },
          { status: 400 }
        );
      }
    }

    // Check for duplicate pppoeUser
    const existing = await prisma.client.findUnique({ where: { pppoeUser: body.pppoeUser } });
    if (existing) {
      return NextResponse.json({ error: "El usuario PPPoE ya existe" }, { status: 409 });
    }

    // ATOMIC: First create PPPoE secret on MikroTik, then DB
    try {
      await createPPPoESecret(body.pppoeUser, body.pppoePassword, body.profileName, body.name);
    } catch (e) {
      const mikrotikError = e instanceof Error ? e.message : "Error de MikroTik";
      console.error("Error al crear secreto PPPoE en MikroTik:", e);
      return NextResponse.json(
        { error: `Error al crear secreto PPPoE en MikroTik: ${mikrotikError}` },
        { status: 500 }
      );
    }

    // MikroTik succeeded, now create in DB
    const client = await prisma.client.create({
      data: {
        name: body.name.trim(),
        phone: body.phone || null,
        address: body.address.trim(),
        pppoeUser: body.pppoeUser,
        pppoePassword: body.pppoePassword,
        profileName: body.profileName,
        nodeId: body.nodeId || null,
        notes: body.notes || null,
      },
      include: { node: true },
    });

    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    console.error("POST /api/clients error:", error);
    return NextResponse.json({ error: "Error al crear cliente" }, { status: 500 });
  }
}
