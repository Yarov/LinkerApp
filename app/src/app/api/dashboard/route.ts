import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePPPoE, pingHosts, getSystemResource } from "@/lib/mikrotik";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const url = new URL(request.url);
    const quick = url.searchParams.get("quick") === "true";

    // DB queries are fast - always run these
    const [totalClients, activeClients, suspendedClients, monthlyPayments, nodes, recentPayments, allActiveClients] =
      await Promise.all([
        prisma.client.count(),
        prisma.client.count({ where: { status: "ACTIVE" } }),
        prisma.client.count({ where: { status: "SUSPENDED" } }),
        prisma.payment.findMany({ where: { period: currentPeriod } }),
        prisma.node.findMany({
          select: { id: true, name: true, status: true, type: true, ip: true, lastSeen: true },
        }),
        prisma.payment.findMany({
          take: 5,
          orderBy: { createdAt: "desc" },
          include: { client: { select: { name: true } } },
        }),
        prisma.client.findMany({
          where: { status: "ACTIVE" },
          select: { id: true },
        }),
      ]);

    const monthlyRevenue = monthlyPayments.reduce((sum, p) => sum + p.amount, 0);
    const paidClientIds = new Set(monthlyPayments.map((p) => p.clientId));
    const overdueClientsCount = allActiveClients.filter((c) => !paidClientIds.has(c.id)).length;

    // If quick mode, return DB data immediately without MikroTik calls
    if (quick) {
      const nodesOnline = nodes.filter((n) => n.status === "ONLINE").length;
      return NextResponse.json({
        clients: { total: totalClients, active: activeClients, suspended: suspendedClients },
        revenue: { current: monthlyRevenue, period: currentPeriod },
        nodes: { total: nodes.length, online: nodesOnline, list: nodes },
        pppoeActive: 0,
        recentPayments,
        overdueClients: overdueClientsCount,
        mikrotik: null,
      });
    }

    // MikroTik calls run in parallel (not sequential)
    const nodeIps = nodes.filter((n) => n.ip).map((n) => n.ip as string);
    const [pingResults, activePPPoE, rawMk] = await Promise.all([
      nodeIps.length > 0 ? pingHosts(nodeIps) : Promise.resolve({} as Record<string, boolean>),
      getActivePPPoE(),
      getSystemResource(),
    ]);

    // Update node statuses
    const updatedNodes = await Promise.all(
      nodes.map(async (node) => {
        if (node.ip && pingResults[node.ip] !== undefined) {
          const isOnline = pingResults[node.ip];
          const newStatus = isOnline ? "ONLINE" : "OFFLINE";
          if (node.status !== newStatus || isOnline) {
            await prisma.node.update({
              where: { id: node.id },
              data: {
                status: newStatus,
                lastSeen: isOnline ? now : node.lastSeen,
              },
            });
          }
          return { ...node, status: newStatus, lastSeen: isOnline ? now : node.lastSeen };
        }
        return node;
      })
    );

    const nodesOnline = updatedNodes.filter((n) => n.status === "ONLINE").length;

    const mikrotik = rawMk ? {
      uptime: rawMk.uptime,
      version: rawMk.version,
      cpuLoad: rawMk['cpu-load'] || rawMk.cpuLoad || '0',
      freeMemory: rawMk['free-memory'] || rawMk.freeMemory || '0',
      totalMemory: rawMk['total-memory'] || rawMk.totalMemory || '0',
      board: rawMk['board-name'] || rawMk.board || '',
    } : null;

    return NextResponse.json({
      clients: { total: totalClients, active: activeClients, suspended: suspendedClients },
      revenue: { current: monthlyRevenue, period: currentPeriod },
      nodes: { total: updatedNodes.length, online: nodesOnline, list: updatedNodes },
      pppoeActive: activePPPoE.length,
      recentPayments,
      overdueClients: overdueClientsCount,
      mikrotik,
    });
  } catch (error) {
    console.error("GET /api/dashboard error:", error);
    return NextResponse.json({ error: "Failed to fetch dashboard data" }, { status: 500 });
  }
}
