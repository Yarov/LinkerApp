import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const VALID_METHODS = ["EFECTIVO", "TRANSFERENCIA", "OTRO"] as const;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const period = searchParams.get("period") || searchParams.get("month");

    const where: Record<string, unknown> = {};
    if (clientId) where.clientId = clientId;
    if (period) where.period = period;

    const payments = await prisma.payment.findMany({
      where,
      include: { client: { select: { id: true, name: true, pppoeUser: true } } },
      orderBy: { paidAt: "desc" },
    });
    return NextResponse.json(payments);
  } catch (error) {
    console.error("GET /api/payments error:", error);
    return NextResponse.json({ error: "Error al obtener pagos" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // --- Input validation ---
    const errors: string[] = [];

    if (!body.clientId || typeof body.clientId !== "string") {
      errors.push("El ID del cliente es requerido");
    }

    if (body.amount === undefined || body.amount === null) {
      errors.push("El monto es requerido");
    } else if (typeof body.amount !== "number" || body.amount <= 0) {
      errors.push("El monto debe ser un número positivo");
    }

    if (!body.period || typeof body.period !== "string") {
      errors.push("El periodo es requerido");
    } else if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period)) {
      errors.push("El periodo debe tener formato YYYY-MM");
    }

    if (!body.method || typeof body.method !== "string") {
      errors.push("El método de pago es requerido");
    } else if (!VALID_METHODS.includes(body.method as typeof VALID_METHODS[number])) {
      errors.push("El método de pago debe ser EFECTIVO, TRANSFERENCIA o OTRO");
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(". ") }, { status: 400 });
    }

    // Verify client exists
    const client = await prisma.client.findUnique({ where: { id: body.clientId } });
    if (!client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const payment = await prisma.payment.create({
      data: {
        clientId: body.clientId,
        amount: body.amount,
        period: body.period,
        method: body.method,
        notes: body.notes || null,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
      },
      include: { client: { select: { id: true, name: true, pppoeUser: true } } },
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    console.error("POST /api/payments error:", error);
    return NextResponse.json({ error: "Error al crear pago" }, { status: 500 });
  }
}
