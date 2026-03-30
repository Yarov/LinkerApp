import { NextResponse } from "next/server";
import { getSystemResource, getInterfaces } from "@/lib/mikrotik";

export async function GET() {
  try {
    const [resource, interfaces] = await Promise.all([
      getSystemResource(),
      getInterfaces(),
    ]);

    if (!resource) {
      return NextResponse.json(
        { error: "Cannot connect to MikroTik router" },
        { status: 503 }
      );
    }

    // Filter to running interfaces with useful info
    const runningInterfaces = interfaces.filter(
      (i) => i.running === "true" && i.disabled !== "true"
    );

    return NextResponse.json({
      resource: {
        uptime: resource.uptime,
        cpuLoad: resource["cpu-load"] || resource.cpuLoad,
        freeMemory: resource["free-memory"] || resource.freeMemory,
        totalMemory: resource["total-memory"] || resource.totalMemory,
        architecture: resource["architecture-name"] || resource.architecture,
        board: resource["board-name"] || resource.board,
        version: resource.version,
      },
      interfaces: runningInterfaces.map((i) => ({
        name: i.name,
        type: i.type,
        txBytes: i["tx-byte"],
        rxBytes: i["rx-byte"],
      })),
    });
  } catch (error) {
    console.error("GET /api/mikrotik/status error:", error);
    return NextResponse.json({ error: "Failed to fetch MikroTik status" }, { status: 500 });
  }
}
