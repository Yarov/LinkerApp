import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { statSync } from "fs";
import path from "path";

export async function GET() {
  try {
    // Database file size
    let dbSizeBytes = 0;
    try {
      const dbPath = path.resolve(process.cwd(), "dev.db");
      const stat = statSync(dbPath);
      dbSizeBytes = stat.size;
    } catch {
      // DB file not found
    }

    // Counts
    const [nodeCount, clientCount, planCount, alertCount] = await Promise.all([
      prisma.node.count(),
      prisma.client.count(),
      prisma.plan.count(),
      prisma.alert.count(),
    ]);

    // Last monitoring: most recent node lastSeen or most recent alert
    let lastMonitoring: string | null = null;
    try {
      const latestAlert = await prisma.alert.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const latestNode = await prisma.node.findFirst({
        where: { lastSeen: { not: null } },
        orderBy: { lastSeen: "desc" },
        select: { lastSeen: true },
      });

      const dates = [
        latestAlert?.createdAt,
        latestNode?.lastSeen,
      ].filter(Boolean) as Date[];

      if (dates.length > 0) {
        lastMonitoring = new Date(
          Math.max(...dates.map((d) => d.getTime()))
        ).toISOString();
      }
    } catch {
      // ignore
    }

    return NextResponse.json({
      version: "0.1.0",
      database: {
        type: "SQLite",
        sizeBytes: dbSizeBytes,
        sizeMB: (dbSizeBytes / (1024 * 1024)).toFixed(2),
      },
      counts: {
        nodes: nodeCount,
        clients: clientCount,
        plans: planCount,
        alerts: alertCount,
      },
      lastMonitoring,
    });
  } catch (error) {
    console.error("GET /api/config/system error:", error);
    return NextResponse.json(
      { error: "Error al obtener info del sistema" },
      { status: 500 }
    );
  }
}
