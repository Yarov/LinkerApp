import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET: Returns network configuration history
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const [logs, total] = await Promise.all([
      prisma.networkLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.networkLog.count(),
    ]);

    return NextResponse.json({ logs, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message, logs: [], total: 0 }, { status: 500 });
  }
}

// POST: Adds a log entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, status, message, details } = body;

    if (!action || !status || !message) {
      return NextResponse.json(
        { error: "Se requieren action, status y message" },
        { status: 400 }
      );
    }

    const log = await prisma.networkLog.create({
      data: {
        action,
        status,
        message,
        details: details ? (typeof details === "string" ? details : JSON.stringify(details)) : null,
      },
    });

    return NextResponse.json(log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
