import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pingHost } from "@/lib/mikrotik";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const node = await prisma.node.findUnique({
      where: { id },
      include: { children: true, parent: true, clients: true },
    });
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    return NextResponse.json(node);
  } catch (error) {
    console.error("GET /api/nodes/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch node" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.node.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    const newIp = body.ip !== undefined ? body.ip : existing.ip;

    const node = await prisma.node.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        type: body.type ?? existing.type,
        ip: body.ip !== undefined ? body.ip : existing.ip,
        mac: body.mac !== undefined ? body.mac : existing.mac,
        model: body.model !== undefined ? body.model : existing.model,
        firmware: body.firmware !== undefined ? body.firmware : existing.firmware,
        latitude: body.latitude !== undefined ? body.latitude : existing.latitude,
        longitude: body.longitude !== undefined ? body.longitude : existing.longitude,
        parentId: body.parentId !== undefined ? body.parentId : existing.parentId,
        status: body.status ?? existing.status,
        lastSeen: body.lastSeen ? new Date(body.lastSeen) : existing.lastSeen,
      },
    });

    // Ping the IP from MikroTik to validate reachability
    let reachable = false;
    if (newIp) {
      try {
        reachable = await pingHost(newIp);
        await prisma.node.update({
          where: { id },
          data: {
            status: reachable ? "ONLINE" : "OFFLINE",
            lastSeen: reachable ? new Date() : node.lastSeen,
          },
        });
      } catch {
        // MikroTik unreachable - keep existing status
      }
    }

    return NextResponse.json({ ...node, status: reachable ? "ONLINE" : node.status, reachable });
  } catch (error) {
    console.error("PUT /api/nodes/[id] error:", error);
    return NextResponse.json({ error: "Failed to update node" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.node.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    // Check for child nodes
    const childCount = await prisma.node.count({ where: { parentId: id } });
    if (childCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete node: ${childCount} child nodes depend on it` },
        { status: 409 }
      );
    }

    // Check for clients
    const clientCount = await prisma.client.count({ where: { nodeId: id } });
    if (clientCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete node: ${clientCount} clients are connected to it` },
        { status: 409 }
      );
    }

    await prisma.node.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/nodes/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete node" }, { status: 500 });
  }
}
