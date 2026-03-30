import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getArpTable, getDhcpLeases } from "@/lib/mikrotik";

interface DiscoveredDevice {
  ip: string;
  mac: string;
  hostname: string | null;
  interface: string | null;
  source: string; // "arp" | "dhcp" | "both"
}

export async function GET() {
  try {
    // Fetch ARP table and DHCP leases in parallel
    const [arpEntries, dhcpLeases] = await Promise.all([
      getArpTable(),
      getDhcpLeases(),
    ]);

    // Build a map of discovered devices by IP
    const deviceMap = new Map<string, DiscoveredDevice>();

    for (const arp of arpEntries) {
      if (!arp.address || !arp["mac-address"]) continue;
      // Skip incomplete ARP entries
      if (arp.complete === "false") continue;
      deviceMap.set(arp.address, {
        ip: arp.address,
        mac: arp["mac-address"],
        hostname: null,
        interface: arp.interface || null,
        source: "arp",
      });
    }

    for (const lease of dhcpLeases) {
      if (!lease.address || !lease["mac-address"]) continue;
      const existing = deviceMap.get(lease.address);
      if (existing) {
        existing.hostname = lease["host-name"] || existing.hostname;
        existing.source = "both";
        // Prefer DHCP MAC if available
        if (lease["mac-address"]) existing.mac = lease["mac-address"];
      } else {
        deviceMap.set(lease.address, {
          ip: lease.address,
          mac: lease["mac-address"],
          hostname: lease["host-name"] || null,
          interface: null,
          source: "dhcp",
        });
      }
    }

    const allDevices = Array.from(deviceMap.values());

    // Get all existing nodes from DB
    const existingNodes = await prisma.node.findMany({
      select: { id: true, name: true, type: true, ip: true, mac: true, status: true },
    });

    // Build lookup sets for matching
    const nodeByIp = new Map(
      existingNodes.filter(n => n.ip).map(n => [n.ip!, n])
    );
    const nodeByMac = new Map(
      existingNodes.filter(n => n.mac).map(n => [n.mac!.toLowerCase(), n])
    );

    const known: Array<DiscoveredDevice & { node: typeof existingNodes[0] }> = [];
    const unknown: DiscoveredDevice[] = [];

    for (const device of allDevices) {
      const matchByIp = nodeByIp.get(device.ip);
      const matchByMac = nodeByMac.get(device.mac.toLowerCase());
      const match = matchByIp || matchByMac;

      if (match) {
        known.push({ ...device, node: match });
      } else {
        unknown.push(device);
      }
    }

    // Sort: unknown by IP, known by node name
    unknown.sort((a, b) => {
      const aParts = a.ip.split(".").map(Number);
      const bParts = b.ip.split(".").map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    });
    known.sort((a, b) => a.node.name.localeCompare(b.node.name));

    return NextResponse.json({
      known,
      unknown,
      summary: {
        total: allDevices.length,
        known: known.length,
        unknown: unknown.length,
        arpEntries: arpEntries.length,
        dhcpLeases: dhcpLeases.length,
      },
    });
  } catch (error) {
    console.error("GET /api/discover error:", error);
    return NextResponse.json(
      { error: "Error al escanear la red. Verifica la conexion con MikroTik." },
      { status: 500 }
    );
  }
}
