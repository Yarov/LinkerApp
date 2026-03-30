import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.alert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    const alert = await prisma.alert.update({
      where: { id },
      data: { isRead: true },
    });

    return NextResponse.json(alert);
  } catch (error) {
    console.error("PUT /api/alerts/[id]/read error:", error);
    return NextResponse.json({ error: "Failed to mark alert as read" }, { status: 500 });
  }
}
