import { NextResponse } from "next/server";
import { RouterOSAPI } from "routeros-api";

export const dynamic = "force-dynamic";

interface HealthResult {
  firewall: { status: "professional" | "basic" | "none"; ruleCount: number };
  qos: { status: "configured" | "basic" | "none"; queueCount: number };
  dns: { cacheEnabled: boolean; servers: string[] };
  clientIsolation: boolean;
  antiDdos: boolean;
  pppoeServer: { active: boolean; clientCount: number };
  backup: { lastBackup: string | null };
  nat: { masquerade: boolean };
}

export async function GET() {
  const host = process.env.MIKROTIK_HOST || "10.10.10.3";
  const port = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
  const user = process.env.MIKROTIK_USER || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "";

  const api = new RouterOSAPI({ host, port, user, password, timeout: 10 });

  try {
    await api.connect();

    // Firewall rules
    const filterRules = (await api.write("/ip/firewall/filter/print")) as Record<string, string>[];
    const ruleCount = filterRules.length;
    let firewallStatus: HealthResult["firewall"]["status"] = "none";
    if (ruleCount >= 20) firewallStatus = "professional";
    else if (ruleCount > 0) firewallStatus = "basic";

    // Queue trees (QoS)
    const queueTrees = (await api.write("/queue/tree/print")) as Record<string, string>[];
    const simpleQueues = (await api.write("/queue/simple/print")) as Record<string, string>[];
    const totalQueues = queueTrees.length + simpleQueues.length;
    let qosStatus: HealthResult["qos"]["status"] = "none";
    if (totalQueues >= 5) qosStatus = "configured";
    else if (totalQueues > 0) qosStatus = "basic";

    // DNS
    let dnsData: Record<string, string> = {};
    try {
      const dnsResult = (await api.write("/ip/dns/print")) as Record<string, string>[];
      dnsData = dnsResult[0] || {};
    } catch {
      // DNS print may return single object in some versions
    }
    const cacheEnabled = dnsData["allow-remote-requests"] === "true";
    const servers = (dnsData["servers"] || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);

    // Client isolation - check if there are bridge filter rules preventing client-to-client
    let clientIsolation = false;
    try {
      const bridgeFilters = (await api.write("/interface/bridge/filter/print")) as Record<string, string>[];
      clientIsolation = bridgeFilters.some(
        (r) => r["chain"] === "forward" && r["action"] === "drop"
      );
    } catch {
      // Bridge filter may not exist
    }

    // Anti-DDoS - check for rate-limiting rules in raw or filter
    let antiDdos = false;
    try {
      const rawRules = (await api.write("/ip/firewall/raw/print")) as Record<string, string>[];
      antiDdos = rawRules.some(
        (r) =>
          (r["comment"] || "").toLowerCase().includes("ddos") ||
          (r["comment"] || "").toLowerCase().includes("flood") ||
          r["action"] === "drop"
      );
      if (!antiDdos) {
        antiDdos = filterRules.some(
          (r) =>
            (r["comment"] || "").toLowerCase().includes("ddos") ||
            (r["comment"] || "").toLowerCase().includes("flood") ||
            (r["comment"] || "").toLowerCase().includes("syn") ||
            r["connection-limit"] !== undefined
        );
      }
    } catch {
      // Raw table may not exist
    }

    // PPPoE Server
    let pppoeActive = false;
    let pppoeClientCount = 0;
    try {
      const pppoeServer = (await api.write("/interface/pppoe-server/server/print")) as Record<string, string>[];
      pppoeActive = pppoeServer.some((s) => s["disabled"] !== "true");
      const activeSessions = (await api.write("/ppp/active/print")) as Record<string, string>[];
      pppoeClientCount = activeSessions.length;
    } catch {
      // PPPoE may not be configured
    }

    // NAT masquerade
    let masquerade = false;
    try {
      const nat = (await api.write("/ip/firewall/nat/print")) as Record<string, string>[];
      masquerade = nat.some((r) => r["action"] === "masquerade");
    } catch {
      // ignore
    }

    // Backup
    let lastBackup: string | null = null;
    try {
      const files = (await api.write("/file/print")) as Record<string, string>[];
      const backupFiles = files
        .filter((f) => (f["name"] || "").endsWith(".backup") || (f["name"] || "").endsWith(".rsc"))
        .sort((a, b) => (b["creation-time"] || "").localeCompare(a["creation-time"] || ""));
      if (backupFiles.length > 0) {
        lastBackup = backupFiles[0]["creation-time"] || backupFiles[0]["name"] || null;
      }
    } catch {
      // Backup listing may fail
    }

    api.close();

    const result: HealthResult = {
      firewall: { status: firewallStatus, ruleCount },
      qos: { status: qosStatus, queueCount: totalQueues },
      dns: { cacheEnabled, servers },
      clientIsolation,
      antiDdos,
      pppoeServer: { active: pppoeActive, clientCount: pppoeClientCount },
      backup: { lastBackup },
      nat: { masquerade },
    };

    return NextResponse.json(result);
  } catch (error) {
    try { api.close(); } catch { /* ignore */ }
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: `No se pudo conectar al MikroTik: ${message}` },
      { status: 503 }
    );
  }
}
