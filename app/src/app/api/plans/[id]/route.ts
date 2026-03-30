import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { updatePPPoEProfile, deletePPPoEProfile } from "@/lib/mikrotik";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    return NextResponse.json(plan);
  } catch (error) {
    console.error("GET /api/plans/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch plan" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Update PPPoE profile on MikroTik if rate changed
    let mikrotikError: string | null = null;
    const dlChanged = body.downloadMbps && body.downloadMbps !== existing.downloadMbps;
    const ulChanged = body.uploadMbps && body.uploadMbps !== existing.uploadMbps;

    if (dlChanged || ulChanged) {
      const dl = body.downloadMbps ?? existing.downloadMbps;
      const ul = body.uploadMbps ?? existing.uploadMbps;
      const rateLimit = `${dl}M/${ul}M`;
      try {
        await updatePPPoEProfile(existing.profileName, rateLimit, body.name ?? existing.name);
      } catch (e) {
        mikrotikError = e instanceof Error ? e.message : "MikroTik error";
        console.error("Failed to update PPPoE profile:", e);
      }
    }

    const plan = await prisma.plan.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        downloadMbps: body.downloadMbps ?? existing.downloadMbps,
        uploadMbps: body.uploadMbps ?? existing.uploadMbps,
        price: body.price ?? existing.price,
        isActive: body.isActive ?? existing.isActive,
      },
    });

    return NextResponse.json({ ...plan, mikrotikError });
  } catch (error) {
    console.error("PUT /api/plans/[id] error:", error);
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Check if any clients use this plan
    const clientCount = await prisma.client.count({ where: { profileName: existing.profileName } });
    if (clientCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete plan: ${clientCount} clients are using it` },
        { status: 409 }
      );
    }

    let mikrotikError: string | null = null;
    try {
      await deletePPPoEProfile(existing.profileName);
    } catch (e) {
      mikrotikError = e instanceof Error ? e.message : "MikroTik error";
      console.error("Failed to delete PPPoE profile:", e);
    }

    await prisma.plan.delete({ where: { id } });

    return NextResponse.json({ success: true, mikrotikError });
  } catch (error) {
    console.error("DELETE /api/plans/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete plan" }, { status: 500 });
  }
}
