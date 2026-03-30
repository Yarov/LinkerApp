import { NextResponse } from "next/server";
import { RouterOSAPI } from "routeros-api";

export const dynamic = "force-dynamic";

interface AuditResult {
  system: {
    identity: string;
    version: string;
    board: string;
    cpu: string;
    cpuCount: number;
    cpuLoad: number;
    totalMemory: number;
    freeMemory: number;
    uptime: string;
    architecture: string;
  };
  pppoe: {
    profiles: Array<{
      name: string;
      rateLimit: string;
      localAddress: string;
      remoteAddress: string;
    }>;
    secrets: Array<{
      name: string;
      profile: string;
      disabled: boolean;
      lastLoggedOut: string;
      comment: string;
    }>;
    active: Array<{
      name: string;
      address: string;
      uptime: string;
      service: string;
    }>;
    totalClients: number;
    totalProfiles: number;
    activeConnections: number;
  };
  firewall: {
    filterRules: Array<{
      chain: string;
      action: string;
      comment: string;
      disabled: boolean;
    }>;
    natRules: Array<{
      chain: string;
      action: string;
      comment: string;
      disabled: boolean;
    }>;
    totalFilterRules: number;
    totalNatRules: number;
    score: number;
    level: "none" | "basic" | "moderate" | "professional";
  };
  qos: {
    simpleQueues: Array<{
      name: string;
      target: string;
      maxLimit: string;
      disabled: boolean;
    }>;
    treeQueues: Array<{
      name: string;
      parent: string;
      maxLimit: string;
      queue: string;
    }>;
    totalSimple: number;
    totalTree: number;
    type: "none" | "simple" | "tree" | "mixed";
  };
  network: {
    addresses: Array<{
      address: string;
      interface: string;
      network: string;
      disabled: boolean;
    }>;
    pools: Array<{
      name: string;
      ranges: string;
    }>;
    dns: {
      servers: string;
      allowRemoteRequests: boolean;
      cacheSize: string;
    };
    interfaces: Array<{
      name: string;
      type: string;
      running: boolean;
      disabled: boolean;
    }>;
  };
  security: {
    users: Array<{
      name: string;
      group: string;
      disabled: boolean;
    }>;
    services: Array<{
      name: string;
      port: number;
      disabled: boolean;
    }>;
    vulnerabilities: string[];
    recommendations: string[];
  };
}

function analyzeFirewall(
  filterRules: Record<string, string>[],
  natRules: Record<string, string>[]
): { score: number; level: AuditResult["firewall"]["level"] } {
  const count = filterRules.length;
  const hasEstablished = filterRules.some(
    (r) =>
      r["connection-state"]?.includes("established") && r.action === "accept"
  );
  const hasDropInvalid = filterRules.some(
    (r) => r["connection-state"]?.includes("invalid") && r.action === "drop"
  );
  const hasDropInput = filterRules.some(
    (r) => r.chain === "input" && r.action === "drop" && !r["connection-state"]
  );
  const hasForwardRules = filterRules.some((r) => r.chain === "forward");
  const hasMasquerade = natRules.some((r) => r.action === "masquerade");

  let score = 0;
  if (hasEstablished) score += 15;
  if (hasDropInvalid) score += 15;
  if (hasDropInput) score += 15;
  if (hasForwardRules) score += 15;
  if (hasMasquerade) score += 10;
  if (count >= 5) score += 10;
  if (count >= 10) score += 10;
  if (count >= 20) score += 10;

  let level: AuditResult["firewall"]["level"] = "none";
  if (score >= 80) level = "professional";
  else if (score >= 50) level = "moderate";
  else if (score > 0) level = "basic";

  return { score, level };
}

function analyzeVulnerabilities(
  users: Record<string, string>[],
  services: Record<string, string>[],
  firewallScore: number
): { vulnerabilities: string[]; recommendations: string[] } {
  const vulnerabilities: string[] = [];
  const recommendations: string[] = [];

  // Check for admin with no password (common in default MikroTik setups)
  const adminUser = users.find((u) => u.name === "admin");
  if (adminUser && adminUser.disabled !== "true") {
    vulnerabilities.push("El usuario 'admin' esta habilitado (posible password vacio)");
  }

  // Check enabled services
  const dangerousServices = ["telnet", "ftp", "www", "api-ssl"];
  for (const svc of services) {
    if (svc.disabled !== "true" && dangerousServices.includes(svc.name)) {
      if (svc.name === "telnet") {
        vulnerabilities.push("Telnet esta habilitado (no es seguro, usa SSH)");
      } else if (svc.name === "ftp") {
        vulnerabilities.push("FTP esta habilitado (datos sin encriptar)");
      } else if (svc.name === "www") {
        recommendations.push("HTTP esta habilitado. Considera usar solo HTTPS o deshabilitarlo");
      }
    }
  }

  // Firewall recommendations
  if (firewallScore < 30) {
    vulnerabilities.push("Firewall casi sin reglas. Tu red esta expuesta");
    recommendations.push("Aplica un firewall profesional con reglas de INPUT y FORWARD");
  } else if (firewallScore < 60) {
    recommendations.push("Tu firewall es basico. Agrega reglas de proteccion avanzada");
  }

  // General recommendations
  const sshService = services.find((s) => s.name === "ssh");
  if (sshService && sshService.disabled !== "true" && sshService.port === "22") {
    recommendations.push("Considera cambiar el puerto SSH del predeterminado (22)");
  }

  return { vulnerabilities, recommendations };
}

export async function GET() {
  const host = process.env.MIKROTIK_HOST || "10.10.10.3";
  const port = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
  const user = process.env.MIKROTIK_USER || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "";

  const api = new RouterOSAPI({ host, port, user, password, timeout: 30 });

  try {
    await api.connect();

    // Fetch all data in parallel where possible
    const [
      resourceResult,
      identityResult,
      profilesResult,
      secretsResult,
      activeResult,
      filterResult,
      natResult,
      simpleQueueResult,
      treeQueueResult,
      addressResult,
      poolResult,
      dnsResult,
      interfaceResult,
      userResult,
      serviceResult,
    ] = await Promise.all([
      api.write("/system/resource/print").catch(() => []),
      api.write("/system/identity/print").catch(() => []),
      api.write("/ppp/profile/print").catch(() => []),
      api.write("/ppp/secret/print").catch(() => []),
      api.write("/ppp/active/print").catch(() => []),
      api.write("/ip/firewall/filter/print").catch(() => []),
      api.write("/ip/firewall/nat/print").catch(() => []),
      api.write("/queue/simple/print").catch(() => []),
      api.write("/queue/tree/print").catch(() => []),
      api.write("/ip/address/print").catch(() => []),
      api.write("/ip/pool/print").catch(() => []),
      api.write("/ip/dns/print").catch(() => []),
      api.write("/interface/print").catch(() => []),
      api.write("/user/print").catch(() => []),
      api.write("/ip/service/print").catch(() => []),
    ]);

    api.close();

    const resources = (resourceResult as Record<string, string>[])[0] || {};
    const identity = (identityResult as Record<string, string>[])[0] || {};
    const profiles = profilesResult as Record<string, string>[];
    const secrets = secretsResult as Record<string, string>[];
    const active = activeResult as Record<string, string>[];
    const filterRules = filterResult as Record<string, string>[];
    const natRules = natResult as Record<string, string>[];
    const simpleQueues = simpleQueueResult as Record<string, string>[];
    const treeQueues = treeQueueResult as Record<string, string>[];
    const addresses = addressResult as Record<string, string>[];
    const pools = poolResult as Record<string, string>[];
    const dnsConfig = (dnsResult as Record<string, string>[])[0] || {};
    const interfaces = interfaceResult as Record<string, string>[];
    const users = userResult as Record<string, string>[];
    const services = serviceResult as Record<string, string>[];

    const { score: firewallScore, level: firewallLevel } = analyzeFirewall(filterRules, natRules);
    const { vulnerabilities, recommendations } = analyzeVulnerabilities(users, services, firewallScore);

    let qosType: AuditResult["qos"]["type"] = "none";
    if (treeQueues.length > 0 && simpleQueues.length > 0) qosType = "mixed";
    else if (treeQueues.length > 0) qosType = "tree";
    else if (simpleQueues.length > 0) qosType = "simple";

    const audit: AuditResult = {
      system: {
        identity: identity.name || "MikroTik",
        version: resources.version || "-",
        board: resources["board-name"] || "-",
        cpu: resources.cpu || "-",
        cpuCount: parseInt(resources["cpu-count"] || "1", 10),
        cpuLoad: parseInt(resources["cpu-load"] || "0", 10),
        totalMemory: parseInt(resources["total-memory"] || "0", 10),
        freeMemory: parseInt(resources["free-memory"] || "0", 10),
        uptime: resources.uptime || "-",
        architecture: resources["architecture-name"] || "-",
      },
      pppoe: {
        profiles: profiles
          .filter((p) => p.name !== "default" && p.name !== "default-encryption")
          .map((p) => ({
            name: p.name,
            rateLimit: p["rate-limit"] || "sin limite",
            localAddress: p["local-address"] || "-",
            remoteAddress: p["remote-address"] || "-",
          })),
        secrets: secrets.map((s) => ({
          name: s.name,
          profile: s.profile || "default",
          disabled: s.disabled === "true",
          lastLoggedOut: s["last-logged-out"] || "-",
          comment: s.comment || "",
        })),
        active: active.map((a) => ({
          name: a.name,
          address: a.address || "-",
          uptime: a.uptime || "-",
          service: a.service || "-",
        })),
        totalClients: secrets.length,
        totalProfiles: profiles.filter((p) => p.name !== "default" && p.name !== "default-encryption").length,
        activeConnections: active.length,
      },
      firewall: {
        filterRules: filterRules.map((r) => ({
          chain: r.chain || "",
          action: r.action || "",
          comment: r.comment || "",
          disabled: r.disabled === "true",
        })),
        natRules: natRules.map((r) => ({
          chain: r.chain || "",
          action: r.action || "",
          comment: r.comment || "",
          disabled: r.disabled === "true",
        })),
        totalFilterRules: filterRules.length,
        totalNatRules: natRules.length,
        score: firewallScore,
        level: firewallLevel,
      },
      qos: {
        simpleQueues: simpleQueues.map((q) => ({
          name: q.name || "",
          target: q.target || "",
          maxLimit: q["max-limit"] || "",
          disabled: q.disabled === "true",
        })),
        treeQueues: treeQueues.map((q) => ({
          name: q.name || "",
          parent: q.parent || "",
          maxLimit: q["max-limit"] || "",
          queue: q.queue || "",
        })),
        totalSimple: simpleQueues.length,
        totalTree: treeQueues.length,
        type: qosType,
      },
      network: {
        addresses: addresses.map((a) => ({
          address: a.address || "",
          interface: a.interface || "",
          network: a.network || "",
          disabled: a.disabled === "true",
        })),
        pools: pools.map((p) => ({
          name: p.name || "",
          ranges: p.ranges || "",
        })),
        dns: {
          servers: dnsConfig.servers || "",
          allowRemoteRequests: dnsConfig["allow-remote-requests"] === "true",
          cacheSize: dnsConfig["cache-size"] || "0",
        },
        interfaces: interfaces.map((i) => ({
          name: i.name || "",
          type: i.type || "",
          running: i.running === "true",
          disabled: i.disabled === "true",
        })),
      },
      security: {
        users: users.map((u) => ({
          name: u.name || "",
          group: u.group || "",
          disabled: u.disabled === "true",
        })),
        services: services.map((s) => ({
          name: s.name || "",
          port: parseInt(s.port || "0", 10),
          disabled: s.disabled === "true",
        })),
        vulnerabilities,
        recommendations,
      },
    };

    return NextResponse.json(audit);
  } catch (error) {
    try {
      api.close();
    } catch {
      /* ignore */
    }
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: `No se pudo conectar al MikroTik: ${message}` },
      { status: 503 }
    );
  }
}
