import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pingHost } from "@/lib/mikrotik";

export async function GET() {
  try {
    const nodes = await prisma.node.findMany({
      include: { children: true, parent: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(nodes);
  } catch (error) {
    console.error("GET /api/nodes error:", error);
    return NextResponse.json({ error: "Failed to fetch nodes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name || !body.type) {
      return NextResponse.json(
        { error: "Missing required fields: name, type" },
        { status: 400 }
      );
    }

    const node = await prisma.node.create({
      data: {
        name: body.name,
        type: body.type,
        ip: body.ip || null,
        mac: body.mac || null,
        model: body.model || null,
        firmware: body.firmware || null,
        latitude: body.latitude || null,
        longitude: body.longitude || null,
        parentId: body.parentId || null,
        status: body.status || "OFFLINE",
      },
    });

    // Ping the IP from MikroTik to validate reachability
    let reachable = false;
    if (node.ip) {
      try {
        reachable = await pingHost(node.ip);
        // Update node status based on ping result
        await prisma.node.update({
          where: { id: node.id },
          data: {
            status: reachable ? "ONLINE" : "OFFLINE",
            lastSeen: reachable ? new Date() : null,
          },
        });
      } catch {
        // MikroTik unreachable - keep default OFFLINE status
      }
    }

    return NextResponse.json(
      { ...node, status: reachable ? "ONLINE" : "OFFLINE", reachable },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/nodes error:", error);
    return NextResponse.json({ error: "Failed to create node" }, { status: 500 });
  }
}
