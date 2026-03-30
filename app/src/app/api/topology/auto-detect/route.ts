import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { RouterOSAPI } from "routeros-api";

interface StationInfo {
  mac: string;
  name: string;
  ip: string;
  signal: number;
}

async function getStationsFromAP(apIp: string): Promise<StationInfo[]> {
  const api = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST || "10.10.10.3",
    port: parseInt(process.env.MIKROTIK_PORT || "8728"),
    user: process.env.MIKROTIK_USER || "admin",
    password: process.env.MIKROTIK_PASSWORD || "",
    timeout: 15,
  });

  try {
    await api.connect();
    const result = await api.write("/system/ssh-exec", [
      `=address=${apIp}`,
      `=user=${process.env.ANTENNA_USER || "ubnt"}`,
      `=password=${process.env.ANTENNA_PASSWORD || "Blaster9615*"}`,
      "=command=wstalist",
    ]);
    api.close();

    const output = (result[0] as Record<string, string>)?.output || "[]";
    const exitCode = (result[0] as Record<string, string>)?.["exit-code"] || "1";
    if (exitCode !== "0") return [];

    const clean = output.replace(/\\n|\n/g, "").trim();
    const stations = JSON.parse(clean);

    return stations.map((s: Record<string, unknown>) => ({
      mac: ((s.mac as string) || "").toUpperCase(),
      name: (s.remote as Record<string, string>)?.hostname || s.name || "",
      ip: ((s.lastip as string) || (s.remote as Record<string, string>)?.ipaddr?.[0] || ""),
      signal: s.signal || 0,
    }));
  } catch (error) {
    console.error(`[Topology] Error getting stations from ${apIp}:`, error instanceof Error ? error.message : error);
    try { api.close(); } catch {}
    return [];
  }
}

export async function POST() {
  try {
    const allNodes = await prisma.node.findMany();
    const changes: Array<{ nodeId: string; nodeName: string; parentId: string | null; parentName: string; reason: string }> = [];
    const errors: string[] = [];

    // Find all AP and DISTRIBUTION type nodes (they have stations connected to them)
    const apNodes = allNodes.filter(
      (n) => n.type === "AP" || n.type === "DISTRIBUTION"
    );

    for (const ap of apNodes) {
      if (!ap.ip) continue;

      try {
        const stations = await getStationsFromAP(ap.ip);

        for (const station of stations) {
          // Find matching node by MAC or IP
          const matchByMac = station.mac
            ? allNodes.find(
                (n) => n.mac && n.mac.toUpperCase() === station.mac.toUpperCase()
              )
            : null;
          const matchByIp = station.ip
            ? allNodes.find((n) => n.ip === station.ip)
            : null;
          const match = matchByMac || matchByIp;

          if (match && match.id !== ap.id) {
            // Check if parent needs to be updated
            if (match.parentId !== ap.id) {
              const oldParent = match.parentId
                ? allNodes.find((n) => n.id === match.parentId)
                : null;

              await prisma.node.update({
                where: { id: match.id },
                data: {
                  parentId: ap.id,
                  status: "ONLINE",
                  lastSeen: new Date(),
                  // Update MAC if we didn't have it
                  ...(station.mac && !match.mac ? { mac: station.mac } : {}),
                },
              });

              changes.push({
                nodeId: match.id,
                nodeName: match.name,
                parentId: ap.id,
                parentName: ap.name,
                reason: oldParent
                  ? `Movido de "${oldParent.name}" a "${ap.name}" (detectado por ${matchByMac ? "MAC" : "IP"})`
                  : `Asignado a "${ap.name}" (detectado por ${matchByMac ? "MAC" : "IP"})`,
              });
            } else {
              // Parent is correct, just update status
              await prisma.node.update({
                where: { id: match.id },
                data: {
                  status: "ONLINE",
                  lastSeen: new Date(),
                  ...(station.mac && !match.mac ? { mac: station.mac } : {}),
                },
              });
            }
          }
        }
      } catch (err) {
        errors.push(`No se pudo consultar ${ap.name} (${ap.ip}): ${err instanceof Error ? err.message : "Error"}`);
      }
    }

    // Set the MikroTik router as parent of all APs that don't have a parent
    const routerNode = allNodes.find((n) => n.type === "ROUTER");
    if (routerNode) {
      const orphanAPs = allNodes.filter(
        (n) => n.type === "AP" && !n.parentId && n.id !== routerNode.id
      );
      for (const ap of orphanAPs) {
        await prisma.node.update({
          where: { id: ap.id },
          data: { parentId: routerNode.id },
        });
        changes.push({
          nodeId: ap.id,
          nodeName: ap.name,
          parentId: routerNode.id,
          parentName: routerNode.name,
          reason: `AP sin padre asignado automaticamente al Router`,
        });
      }
    }

    // Fetch updated topology
    const updatedNodes = await prisma.node.findMany({
      include: { children: true, parent: true },
    });

    return NextResponse.json({
      success: true,
      changes,
      errors,
      topology: updatedNodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        ip: n.ip,
        mac: n.mac,
        status: n.status,
        parent: n.parent ? { id: n.parent.id, name: n.parent.name } : null,
        children: n.children.map((c) => ({ id: c.id, name: c.name, type: c.type })),
      })),
    });
  } catch (error) {
    console.error("POST /api/topology/auto-detect error:", error);
    return NextResponse.json(
      { error: "Error al auto-detectar topologia" },
      { status: 500 }
    );
  }
}
