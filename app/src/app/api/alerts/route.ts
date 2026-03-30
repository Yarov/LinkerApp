import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread") === "true";

    const where: Record<string, unknown> = {};
    if (unreadOnly) where.isRead = false;

    const alerts = await prisma.alert.findMany({
      where,
      include: { node: { select: { id: true, name: true, type: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(alerts);
  } catch (error) {
    console.error("GET /api/alerts error:", error);
    return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.type || !body.message) {
      return NextResponse.json(
        { error: "Missing required fields: type, message" },
        { status: 400 }
      );
    }

    const alert = await prisma.alert.create({
      data: {
        nodeId: body.nodeId || null,
        type: body.type,
        message: body.message,
        isRead: false,
      },
    });

    return NextResponse.json(alert, { status: 201 });
  } catch (error) {
    console.error("POST /api/alerts error:", error);
    return NextResponse.json({ error: "Failed to create alert" }, { status: 500 });
  }
}
