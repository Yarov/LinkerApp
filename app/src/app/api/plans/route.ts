import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createPPPoEProfile } from "@/lib/mikrotik";

export async function GET() {
  try {
    const plans = await prisma.plan.findMany({
      orderBy: { price: "asc" },
    });

    // Enrich plans with client count
    const clientCounts = await prisma.client.groupBy({
      by: ['profileName'],
      _count: true,
    });
    const countMap = Object.fromEntries(clientCounts.map(c => [c.profileName, c._count]));
    const enriched = plans.map(p => ({
      ...p,
      clientCount: countMap[p.profileName] || 0,
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("GET /api/plans error:", error);
    return NextResponse.json({ error: "Error al obtener planes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // --- Input validation ---
    const errors: string[] = [];

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      errors.push("El nombre es requerido");
    }

    if (body.downloadMbps === undefined || body.downloadMbps === null) {
      errors.push("La velocidad de descarga es requerida");
    } else if (!Number.isInteger(body.downloadMbps) || body.downloadMbps <= 0) {
      errors.push("La velocidad de descarga debe ser un entero positivo");
    }

    if (body.uploadMbps === undefined || body.uploadMbps === null) {
      errors.push("La velocidad de subida es requerida");
    } else if (!Number.isInteger(body.uploadMbps) || body.uploadMbps <= 0) {
      errors.push("La velocidad de subida debe ser un entero positivo");
    }

    if (body.price !== undefined && body.price !== null) {
      if (typeof body.price !== "number" || body.price < 0) {
        errors.push("El precio debe ser un número mayor o igual a 0");
      }
    }

    if (!body.profileName || typeof body.profileName !== "string" || body.profileName.trim().length === 0) {
      errors.push("El nombre de perfil es requerido");
    } else if (!/^[a-zA-Z0-9-]+$/.test(body.profileName)) {
      errors.push("El nombre de perfil solo puede contener letras, números y guiones");
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(". ") }, { status: 400 });
    }

    // Check for duplicate profileName
    const existing = await prisma.plan.findUnique({ where: { profileName: body.profileName } });
    if (existing) {
      return NextResponse.json({ error: "El nombre de perfil ya existe" }, { status: 409 });
    }

    // Create PPPoE profile on MikroTik
    const rateLimit = `${body.downloadMbps}M/${body.uploadMbps}M`;
    let mikrotikError: string | null = null;
    try {
      await createPPPoEProfile(body.profileName, rateLimit, body.name);
    } catch (e) {
      mikrotikError = e instanceof Error ? e.message : "Error de MikroTik";
      console.error("Error al crear perfil PPPoE en MikroTik:", e);
    }

    const plan = await prisma.plan.create({
      data: {
        name: body.name.trim(),
        downloadMbps: body.downloadMbps,
        uploadMbps: body.uploadMbps,
        price: body.price ?? 0,
        profileName: body.profileName,
        isActive: body.isActive ?? true,
      },
    });

    return NextResponse.json({ ...plan, mikrotikError }, { status: 201 });
  } catch (error) {
    console.error("POST /api/plans error:", error);
    return NextResponse.json({ error: "Error al crear plan" }, { status: 500 });
  }
}
