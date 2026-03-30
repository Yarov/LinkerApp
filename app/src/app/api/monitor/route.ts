import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pingHosts } from "@/lib/mikrotik";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // 1. Get all nodes with IPs
    const nodes = await prisma.node.findMany({
      select: { id: true, name: true, ip: true, status: true, lastSeen: true },
    });

    // 2. Ping all nodes from MikroTik
    const nodeIps = nodes.filter((n) => n.ip).map((n) => n.ip as string);
    const pingResults = nodeIps.length > 0 ? await pingHosts(nodeIps) : {};

    // 3. Update statuses and generate link alerts
    const statusChanges: { nodeId: string; name: string; from: string; to: string }[] = [];

    await Promise.all(
      nodes.map(async (node) => {
        if (!node.ip || pingResults[node.ip] === undefined) return;

        const isOnline = pingResults[node.ip];
        const newStatus = isOnline ? "ONLINE" : "OFFLINE";
        const oldStatus = node.status;

        // Update status and lastSeen
        await prisma.node.update({
          where: { id: node.id },
          data: {
            status: newStatus,
            lastSeen: isOnline ? now : node.lastSeen,
          },
        });

        // Detect status changes
        if (oldStatus !== newStatus) {
          statusChanges.push({
            nodeId: node.id,
            name: node.name,
            from: oldStatus,
            to: newStatus,
          });

          // Generate LINK_DOWN or LINK_UP alert
          if (newStatus === "OFFLINE" && oldStatus === "ONLINE") {
            await prisma.alert.create({
              data: {
                nodeId: node.id,
                type: "LINK_DOWN",
                message: `Nodo "${node.name}" paso a OFFLINE (IP: ${node.ip})`,
                isRead: false,
              },
            });
          } else if (newStatus === "ONLINE" && oldStatus === "OFFLINE") {
            await prisma.alert.create({
              data: {
                nodeId: node.id,
                type: "LINK_UP",
                message: `Nodo "${node.name}" volvio a estar ONLINE (IP: ${node.ip})`,
                isRead: false,
              },
            });
          }
        }
      })
    );

    // 4. Check overdue payments
    const activeClients = await prisma.client.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, nodeId: true },
    });

    const paymentsThisMonth = await prisma.payment.findMany({
      where: { period: currentPeriod },
      select: { clientId: true },
    });

    const paidClientIds = new Set(paymentsThisMonth.map((p) => p.clientId));
    const overdueClients = activeClients.filter((c) => !paidClientIds.has(c.id));

    // Generate PAYMENT_DUE alerts (only if not already created for this period)
    let newPaymentAlerts = 0;
    for (const client of overdueClients) {
      const existingAlert = await prisma.alert.findFirst({
        where: {
          type: "PAYMENT_DUE",
          message: { contains: client.id },
          createdAt: {
            gte: new Date(now.getFullYear(), now.getMonth(), 1),
          },
        },
      });

      if (!existingAlert) {
        await prisma.alert.create({
          data: {
            nodeId: client.nodeId,
            type: "PAYMENT_DUE",
            message: `Pago pendiente: ${client.name} no ha pagado en ${currentPeriod} [${client.id}]`,
            isRead: false,
          },
        });
        newPaymentAlerts++;
      }
    }

    // 5. Summary
    const onlineCount = nodes.filter((n) => {
      if (!n.ip) return n.status === "ONLINE";
      return pingResults[n.ip!] === true;
    }).length;

    return NextResponse.json({
      timestamp: now.toISOString(),
      nodes: {
        total: nodes.length,
        online: onlineCount,
        offline: nodes.length - onlineCount,
      },
      statusChanges,
      overdueClients: overdueClients.length,
      newPaymentAlerts,
    });
  } catch (error) {
    console.error("GET /api/monitor error:", error);
    return NextResponse.json(
      { error: "Monitor check failed" },
      { status: 500 }
    );
  }
}
