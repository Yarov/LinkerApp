import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  try {
    await prisma.alert.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/alerts/read-all error:", error);
    return NextResponse.json({ error: "Failed to mark all as read" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const result = await prisma.alert.deleteMany({
      where: { isRead: true },
    });
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (error) {
    console.error("DELETE /api/alerts/read-all error:", error);
    return NextResponse.json({ error: "Failed to delete read alerts" }, { status: 500 });
  }
}
