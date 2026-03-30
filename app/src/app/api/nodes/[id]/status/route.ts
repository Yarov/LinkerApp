import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getSystemResource,
  getInterfaces,
  getActivePPPoE,
} from "@/lib/mikrotik";

// Use MikroTik as SSH proxy to reach antennas (they are not directly reachable)
async function getAntennaStatusViaMikrotik(
  antennaIp: string
): Promise<Record<string, string>> {
  const { RouterOSAPI } = await import("routeros-api");
  const api = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST || "10.10.10.3",
    port: parseInt(process.env.MIKROTIK_PORT || "8728"),
    user: process.env.MIKROTIK_USER || "admin",
    password: process.env.MIKROTIK_PASSWORD || "",
    timeout: 15,
  });

  try {
    await api.connect();

    // Get mca-status and wstalist via MikroTik SSH exec
    const result = await api.write("/system/ssh-exec", [
      `=address=${antennaIp}`,
      `=user=${process.env.ANTENNA_USER || "ubnt"}`,
      `=password=${process.env.ANTENNA_PASSWORD || "Blaster9615*"}`,
      "=command=mca-status | head -30; echo '---STATIONS---'; wstalist",
    ]);

    api.close();

    const output =
      (result[0] as Record<string, string>)?.output ||
      (result[0] as Record<string, string>)?.ret ||
      "";
    const exitCode =
      (result[0] as Record<string, string>)?.["exit-code"] || "1";

    if (exitCode !== "0" || !output) return {};

    // Parse mca-status (key=value format) and wstalist (JSON)
    const parts = output.split("---STATIONS---");
    const statusPart = parts[0] || "";
    const stationsPart = parts[1] || "[]";

    // Parse key=value pairs from mca-status
    const status: Record<string, string> = {};
    for (const line of statusPart.split(/\\n|\n/)) {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        const key = line.substring(0, eqIdx).trim();
        const value = line.substring(eqIdx + 1).trim();
        if (key) status[key] = value;
      }
    }

    // Parse stations JSON
    let stations: unknown[] = [];
    try {
      const cleanJson = stationsPart.replace(/\\n|\n/g, "").trim();
      if (cleanJson) stations = JSON.parse(cleanJson);
      if (!Array.isArray(stations)) stations = [];
    } catch {
      stations = [];
    }

    return { ...status, _stations: JSON.stringify(stations) };
  } catch (error) {
    console.error(
      "[AntennaStatus] Error:",
      error instanceof Error ? error.message : error
    );
    try {
      api.close();
    } catch {
      // ignore close errors
    }
    return {};
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatRate(rateStr: string | undefined): string {
  if (!rateStr) return "-";
  const num = parseFloat(rateStr);
  if (isNaN(num)) return rateStr;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)} Mbps`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)} Kbps`;
  return `${num} bps`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const node = await prisma.node.findUnique({ where: { id } });

    if (!node) {
      return NextResponse.json({ error: "Nodo no encontrado" }, { status: 404 });
    }

    if (!node.ip) {
      return NextResponse.json(
        { error: "El nodo no tiene direccion IP" },
        { status: 400 }
      );
    }

    // ── ROUTER type: get data via RouterOS API ──────────────────────────
    if (node.type === "ROUTER") {
      try {
        const [resource, interfaces, activePPPoE] = await Promise.all([
          getSystemResource(),
          getInterfaces(),
          getActivePPPoE(),
        ]);

        if (!resource) {
          return NextResponse.json({
            node: { id: node.id, name: node.name, type: node.type, ip: node.ip },
            error: "Sin conexion al router",
          });
        }

        const runningInterfaces = interfaces.filter(
          (i) => i.running === "true" && i.disabled !== "true"
        );

        const totalMem = parseInt(resource["total-memory"] || "0", 10);
        const freeMem = parseInt(resource["free-memory"] || "0", 10);
        const memUsagePercent =
          totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0;

        // Update node status
        await prisma.node.update({
          where: { id },
          data: { status: "ONLINE", lastSeen: new Date() },
        });

        return NextResponse.json({
          node: { id: node.id, name: node.name, type: node.type, ip: node.ip },
          uptime: resource.uptime || "",
          cpuLoad: resource["cpu-load"] || "0",
          memoryUsage: `${memUsagePercent}%`,
          totalMemory: totalMem,
          freeMemory: freeMem,
          version: resource.version || "",
          board: resource["board-name"] || "",
          interfaces: runningInterfaces.map((i) => ({
            name: i.name,
            type: i.type,
            txBytes: i["tx-byte"],
            rxBytes: i["rx-byte"],
          })),
          pppoeActive: activePPPoE.length,
          connectedClients: activePPPoE.map((s) => ({
            name: s.name,
            ip: s.address,
            uptime: s.uptime,
            callerId: s["caller-id"],
          })),
        });
      } catch (error) {
        console.error("[RouterStatus] Error:", error);
        return NextResponse.json({
          node: { id: node.id, name: node.name, type: node.type, ip: node.ip },
          error: "Sin conexion al router",
        });
      }
    }

    // ── ANTENNA type (AP / CPE): get data via MikroTik SSH proxy ────────
    let mcaData: Record<string, string> = {};
    let sshError: string | null = null;

    try {
      mcaData = await getAntennaStatusViaMikrotik(node.ip);
    } catch (e) {
      sshError = e instanceof Error ? e.message : "Error de conexion SSH";
      console.error(
        `[NodeStatus] Failed to get status for ${node.name} (${node.ip}):`,
        e
      );
    }

    const hasData = Object.keys(mcaData).length > 0;

    // Parse stations from the embedded JSON
    let stations: Array<Record<string, unknown>> = [];
    if (mcaData._stations) {
      try {
        stations = JSON.parse(mcaData._stations);
      } catch {
        stations = [];
      }
      delete mcaData._stations;
    }

    // Build connected clients from wstalist stations
    const connectedClients = stations.map((s) => ({
      name: (s.name as string) || (s.hostname as string) || "-",
      mac: (s.mac as string) || "-",
      signal: s.signal != null ? String(s.signal) : "-",
      ip: (s.lastip as string) || (s.remote as string) || "-",
      txRate: formatRate(s.tx != null ? String(s.tx) : (s.txRate as string)),
      rxRate: formatRate(s.rx != null ? String(s.rx) : (s.rxRate as string)),
      ccq: s.ccq != null ? String(s.ccq) : undefined,
      uptime: s.uptime != null ? String(s.uptime) : undefined,
    }));

    // Update node status in DB
    const newStatus = hasData ? "ONLINE" : sshError ? "OFFLINE" : node.status;
    if (newStatus !== node.status || hasData) {
      await prisma.node.update({
        where: { id },
        data: {
          status: newStatus,
          lastSeen: hasData ? new Date() : node.lastSeen,
        },
      });
    }

    // Also update child nodes status if we have station data
    if (stations.length > 0) {
      const childNodes = await prisma.node.findMany({
        where: { parentId: id },
      });
      for (const child of childNodes) {
        // Match child by MAC or IP to stations
        const matchedStation = stations.find(
          (s) =>
            (child.mac &&
              (s.mac as string)?.toLowerCase() === child.mac.toLowerCase()) ||
            (child.ip && (s.lastip as string) === child.ip)
        );
        if (matchedStation) {
          await prisma.node.update({
            where: { id: child.id },
            data: { status: "ONLINE", lastSeen: new Date() },
          });
        }
      }
    }

    // Parse numeric values from mca-status
    const signalVal = mcaData.signal ? parseInt(mcaData.signal, 10) : null;
    const noiseVal =
      mcaData.noise || mcaData.noiseFloor
        ? parseInt(mcaData.noise || mcaData.noiseFloor || "0", 10)
        : null;
    const uptimeSeconds = mcaData.uptime ? parseInt(mcaData.uptime, 10) : null;

    return NextResponse.json({
      node: { id: node.id, name: node.name, type: node.type, ip: node.ip },
      signal: signalVal != null && !isNaN(signalVal) ? signalVal : null,
      noiseFloor: noiseVal != null && !isNaN(noiseVal) ? noiseVal : null,
      frequency: mcaData.freq || null,
      channelWidth: mcaData.chanbw || null,
      txRate: formatRate(mcaData.txrate),
      rxRate: formatRate(mcaData.rxrate),
      uptime:
        uptimeSeconds != null && !isNaN(uptimeSeconds)
          ? formatUptime(uptimeSeconds)
          : null,
      distance: mcaData.distance || null,
      ccq: mcaData.ccq || null,
      deviceName: mcaData.deviceName || mcaData.hostname || null,
      stations,
      connectedClients,
      error: hasData ? null : sshError || "Sin datos",
    });
  } catch (error) {
    console.error("GET /api/nodes/[id]/status error:", error);
    return NextResponse.json(
      { error: "Error al obtener estado del nodo" },
      { status: 500 }
    );
  }
}
