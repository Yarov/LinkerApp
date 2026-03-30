import { NextRequest, NextResponse } from "next/server";
import { RouterOSAPI } from "routeros-api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ActionResult {
  success: boolean;
  message: string;
}

interface ApplyBody {
  actions: string[];
  totalBandwidthDown?: number;
  totalBandwidthUp?: number;
}

// Helper: safely run a command, ignoring "already exists" errors
async function safeAdd(api: RouterOSAPI, path: string, args: string[]): Promise<void> {
  try {
    await api.write(path, args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already have") || msg.includes("failure: already")) {
      // Rule already exists, skip
      return;
    }
    throw err;
  }
}

// ─── Firewall Professional Rules ─────────────────────────────────────────────

async function applyFirewall(api: RouterOSAPI): Promise<ActionResult> {
  try {
    const rules: { chain: string; action: string; comment: string; extra?: string[] }[] = [
      // Input chain - protect router
      { chain: "input", action: "accept", comment: "LK: Accept established,related", extra: ["=connection-state=established,related"] },
      { chain: "input", action: "drop", comment: "LK: Drop invalid", extra: ["=connection-state=invalid"] },
      { chain: "input", action: "accept", comment: "LK: Accept ICMP", extra: ["=protocol=icmp"] },
      { chain: "input", action: "accept", comment: "LK: Accept DNS from LAN", extra: ["=protocol=udp", "=dst-port=53", "=in-interface-list=LAN"] },
      { chain: "input", action: "accept", comment: "LK: Accept Winbox", extra: ["=protocol=tcp", "=dst-port=8291"] },
      { chain: "input", action: "accept", comment: "LK: Accept SSH", extra: ["=protocol=tcp", "=dst-port=22"] },
      { chain: "input", action: "accept", comment: "LK: Accept API", extra: ["=protocol=tcp", "=dst-port=8728"] },
      { chain: "input", action: "accept", comment: "LK: Accept PPPoE discovery", extra: ["=protocol=17", "=dst-port=8863"] },
      { chain: "input", action: "accept", comment: "LK: Accept PPPoE session", extra: ["=protocol=17", "=dst-port=8864"] },
      { chain: "input", action: "drop", comment: "LK: Drop all other input" },

      // Forward chain - protect network
      { chain: "forward", action: "accept", comment: "LK: Fwd accept established,related", extra: ["=connection-state=established,related"] },
      { chain: "forward", action: "drop", comment: "LK: Fwd drop invalid", extra: ["=connection-state=invalid"] },
      { chain: "forward", action: "accept", comment: "LK: Fwd accept from LAN", extra: ["=in-interface-list=LAN"] },
      { chain: "forward", action: "accept", comment: "LK: Fwd accept ICMP", extra: ["=protocol=icmp"] },

      // SYN flood protection
      { chain: "input", action: "add-src-to-address-list", comment: "LK: SYN flood detect", extra: ["=protocol=tcp", "=tcp-flags=syn", "=connection-limit=100,32", "=address-list=syn-flood", "=address-list-timeout=1d"] },
      { chain: "input", action: "drop", comment: "LK: Drop SYN flood", extra: ["=src-address-list=syn-flood"] },

      // Port scan protection
      { chain: "input", action: "add-src-to-address-list", comment: "LK: Port scan detect", extra: ["=protocol=tcp", "=tcp-flags=fin,!syn,!rst,!psh,!ack,!urg", "=address-list=port-scanners", "=address-list-timeout=2w"] },
      { chain: "input", action: "drop", comment: "LK: Drop port scanners", extra: ["=src-address-list=port-scanners"] },

      // Block common attack ports
      { chain: "forward", action: "drop", comment: "LK: Block DNS amplification", extra: ["=protocol=udp", "=dst-port=53", "=src-address-list=!LAN"] },
      { chain: "forward", action: "drop", comment: "LK: Block SNMP abuse", extra: ["=protocol=udp", "=dst-port=161,162"] },

      // Brute force protection - Winbox
      { chain: "input", action: "add-src-to-address-list", comment: "LK: Winbox brute force", extra: ["=protocol=tcp", "=dst-port=8291", "=connection-limit=5,32", "=address-list=winbox-blocked", "=address-list-timeout=1d"] },
      { chain: "input", action: "drop", comment: "LK: Drop Winbox brute force", extra: ["=src-address-list=winbox-blocked", "=protocol=tcp", "=dst-port=8291"] },

      // BOGON networks
      { chain: "forward", action: "drop", comment: "LK: Drop bogon 127.0.0.0/8", extra: ["=src-address=127.0.0.0/8"] },
      { chain: "forward", action: "drop", comment: "LK: Drop bogon 224.0.0.0/3", extra: ["=src-address=224.0.0.0/3"] },

      // Final forward drop
      { chain: "forward", action: "drop", comment: "LK: Fwd drop all other", extra: ["=connection-state=new", "=in-interface-list=WAN"] },
    ];

    // First, create interface lists if they don't exist
    try {
      await safeAdd(api, "/interface/list/add", ["=name=LAN"]);
    } catch { /* may already exist */ }
    try {
      await safeAdd(api, "/interface/list/add", ["=name=WAN"]);
    } catch { /* may already exist */ }

    // Remove existing Linker rules to avoid duplicates
    const existing = (await api.write("/ip/firewall/filter/print")) as Record<string, string>[];
    const linkerRules = existing.filter((r) => {
      const c = r["comment"] || "";
      return c.startsWith("LK:") || c.startsWith("Linker:");
    });
    for (const rule of linkerRules.reverse()) {
      try {
        await api.write("/ip/firewall/filter/remove", [`=.id=${rule[".id"]}`]);
      } catch { /* ignore */ }
    }

    // Add all rules
    let added = 0;
    for (const rule of rules) {
      try {
        const args = [
          `=chain=${rule.chain}`,
          `=action=${rule.action}`,
          `=comment=${rule.comment}`,
          ...(rule.extra || []),
        ];
        await api.write("/ip/firewall/filter/add", args);
        added++;
      } catch {
        // Skip rules that can't be added (missing interface list, etc.)
      }
    }

    return { success: true, message: `${added} reglas de firewall aplicadas` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Error aplicando firewall" };
  }
}

// ─── QoS (Queue Trees) ──────────────────────────────────────────────────────

async function applyQoS(
  api: RouterOSAPI,
  totalDown: number,
  totalUp: number
): Promise<ActionResult> {
  try {
    if (!totalDown || !totalUp) {
      return { success: false, message: "Se requiere ancho de banda total (bajada y subida)" };
    }

    // Remove existing Linker queue trees
    const existing = (await api.write("/queue/tree/print")) as Record<string, string>[];
    const linkerQueues = existing.filter((q) => {
      const c = q["comment"] || "";
      const n = q["name"] || "";
      return c.startsWith("LK:") || c.startsWith("Linker:") || n.startsWith("Linker-");
    });
    for (const q of linkerQueues.reverse()) {
      try {
        await api.write("/queue/tree/remove", [`=.id=${q[".id"]}`]);
      } catch { /* ignore */ }
    }

    // Create parent queue trees for bandwidth management
    const downLimit = `${totalDown}M`;
    const upLimit = `${totalUp}M`;

    // Global download queue
    await safeAdd(api, "/queue/tree/add", [
      "=name=Linker-Download",
      "=parent=global",
      `=max-limit=${downLimit}`,
      "=comment=LK: Control de bajada global",
    ]);

    // Global upload queue
    await safeAdd(api, "/queue/tree/add", [
      "=name=Linker-Upload",
      "=parent=global",
      `=max-limit=${upLimit}`,
      "=comment=LK: Control de subida global",
    ]);

    // Per-client fair queue (PCQ) for download
    try {
      await safeAdd(api, "/queue/type/add", [
        "=name=Linker-PCQ-Down",
        "=kind=pcq",
        "=pcq-rate=0",
        "=pcq-classifier=dst-address",
        "=pcq-total-limit=2000KiB",
      ]);
    } catch { /* may exist */ }

    // Per-client fair queue (PCQ) for upload
    try {
      await safeAdd(api, "/queue/type/add", [
        "=name=Linker-PCQ-Up",
        "=kind=pcq",
        "=pcq-rate=0",
        "=pcq-classifier=src-address",
        "=pcq-total-limit=2000KiB",
      ]);
    } catch { /* may exist */ }

    // Child queues using PCQ
    await safeAdd(api, "/queue/tree/add", [
      "=name=Linker-PCQ-Download",
      "=parent=Linker-Download",
      "=queue=Linker-PCQ-Down",
      `=max-limit=${downLimit}`,
      "=comment=LK: PCQ bajada por cliente",
    ]);

    await safeAdd(api, "/queue/tree/add", [
      "=name=Linker-PCQ-Upload",
      "=parent=Linker-Upload",
      "=queue=Linker-PCQ-Up",
      `=max-limit=${upLimit}`,
      "=comment=LK: PCQ subida por cliente",
    ]);

    return { success: true, message: `Queue trees configurados (${totalDown}M/${totalUp}M)` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Error configurando QoS" };
  }
}

// ─── DNS Cache ───────────────────────────────────────────────────────────────

async function applyDNS(api: RouterOSAPI): Promise<ActionResult> {
  try {
    await api.write("/ip/dns/set", [
      "=allow-remote-requests=yes",
      "=servers=8.8.8.8,1.1.1.1,208.67.222.222",
      "=cache-size=4096KiB",
      "=max-udp-packet-size=4096",
      "=max-concurrent-queries=200",
    ]);

    return { success: true, message: "DNS cache habilitado con servidores optimizados" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Error configurando DNS" };
  }
}

// ─── Client Isolation ────────────────────────────────────────────────────────

async function applyClientIsolation(api: RouterOSAPI): Promise<ActionResult> {
  try {
    // Remove existing Linker bridge filters
    try {
      const existing = (await api.write("/interface/bridge/filter/print")) as Record<string, string>[];
      const linkerFilters = existing.filter((f) => {
        const c = f["comment"] || "";
        return c.startsWith("LK:") || c.startsWith("Linker:");
      });
      for (const f of linkerFilters.reverse()) {
        await api.write("/interface/bridge/filter/remove", [`=.id=${f[".id"]}`]);
      }
    } catch { /* ignore */ }

    // Get bridges
    const bridges = (await api.write("/interface/bridge/print")) as Record<string, string>[];
    if (bridges.length === 0) {
      return { success: true, message: "No hay bridges configurados. Aislamiento no es necesario" };
    }

    // Add forward drop rule for each bridge (prevents client-to-client traffic)
    let count = 0;
    for (const bridge of bridges) {
      try {
        await api.write("/interface/bridge/filter/add", [
          "=chain=forward",
          "=action=drop",
          `=in-bridge=${bridge["name"]}`,
          `=out-bridge=${bridge["name"]}`,
          "=comment=LK: Aislamiento de clientes",
        ]);
        count++;
      } catch { /* may not support filters */ }
    }

    // Also enable PPPoE isolation if PPPoE is being used
    try {
      const pppoeServers = (await api.write("/interface/pppoe-server/server/print")) as Record<string, string>[];
      for (const server of pppoeServers) {
        await api.write("/interface/pppoe-server/server/set", [
          `=.id=${server[".id"]}`,
          "=one-session-per-host=yes",
        ]);
      }
    } catch { /* ignore */ }

    return { success: true, message: `Aislamiento configurado en ${count} bridge(s)` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Error configurando aislamiento" };
  }
}

// ─── Anti-DDoS ───────────────────────────────────────────────────────────────

async function applyAntiDdos(api: RouterOSAPI): Promise<ActionResult> {
  try {
    // Remove existing Linker raw rules
    try {
      const existing = (await api.write("/ip/firewall/raw/print")) as Record<string, string>[];
      const linkerRaw = existing.filter((r) => {
        const c = r["comment"] || "";
        return c.startsWith("LK:") || c.startsWith("Linker:");
      });
      for (const r of linkerRaw.reverse()) {
        await api.write("/ip/firewall/raw/remove", [`=.id=${r[".id"]}`]);
      }
    } catch { /* ignore */ }

    const rawRules: { chain: string; action: string; comment: string; extra: string[] }[] = [
      // SYN flood protection via raw table (more efficient)
      {
        chain: "prerouting",
        action: "add-src-to-address-list",
        comment: "LK: DDoS SYN flood",
        extra: ["=protocol=tcp", "=tcp-flags=syn", "=connection-limit=50,32", "=address-list=ddos-attackers", "=address-list-timeout=1h"],
      },
      {
        chain: "prerouting",
        action: "drop",
        comment: "LK: DDoS drop attackers",
        extra: ["=src-address-list=ddos-attackers"],
      },
      // ICMP flood protection
      {
        chain: "prerouting",
        action: "add-src-to-address-list",
        comment: "LK: DDoS ICMP flood",
        extra: ["=protocol=icmp", "=limit=50/5s,2:packet", "=address-list=icmp-flood", "=address-list-timeout=1h"],
      },
      {
        chain: "prerouting",
        action: "drop",
        comment: "LK: DDoS drop ICMP flood",
        extra: ["=src-address-list=icmp-flood"],
      },
      // UDP flood protection
      {
        chain: "prerouting",
        action: "add-src-to-address-list",
        comment: "LK: DDoS UDP flood",
        extra: ["=protocol=udp", "=connection-limit=100,32", "=address-list=udp-flood", "=address-list-timeout=1h"],
      },
      {
        chain: "prerouting",
        action: "drop",
        comment: "LK: DDoS drop UDP flood",
        extra: ["=src-address-list=udp-flood"],
      },
    ];

    let added = 0;
    for (const rule of rawRules) {
      try {
        await api.write("/ip/firewall/raw/add", [
          `=chain=${rule.chain}`,
          `=action=${rule.action}`,
          `=comment=${rule.comment}`,
          ...rule.extra,
        ]);
        added++;
      } catch { /* skip on error */ }
    }

    return { success: true, message: `${added} reglas anti-DDoS aplicadas` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Error configurando anti-DDoS" };
  }
}

// ─── Backup ──────────────────────────────────────────────────────────────────

async function applyBackup(api: RouterOSAPI): Promise<ActionResult> {
  try {
    const date = new Date().toISOString().split("T")[0];
    const backupName = `linker-backup-${date}`;

    // Binary backup
    await api.write("/system/backup/save", [
      `=name=${backupName}`,
      "=dont-encrypt=yes",
    ]);

    // Also export RSC (text) for good measure
    try {
      await api.write("/export", [`=file=${backupName}`]);
    } catch {
      // Export may not be available via API in some versions
    }

    return { success: true, message: `Backup creado: ${backupName}.backup` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Error creando backup" };
  }
}

// ─── Main POST Handler ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const host = process.env.MIKROTIK_HOST || "10.10.10.3";
  const port = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
  const user = process.env.MIKROTIK_USER || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "";

  let body: ApplyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalido" }, { status: 400 });
  }

  const { actions = [], totalBandwidthDown = 50, totalBandwidthUp = 50 } = body;
  if (!Array.isArray(actions) || actions.length === 0) {
    return NextResponse.json({ error: "Se requiere al menos una accion" }, { status: 400 });
  }

  const api = new RouterOSAPI({ host, port, user, password, timeout: 30 });

  try {
    await api.connect();

    const isAll = actions.includes("all");
    const results: Record<string, ActionResult> = {};
    const errors: string[] = [];

    const shouldApply = (action: string) => isAll || actions.includes(action);

    const actionLabels: Record<string, string> = {
      firewall: "Firewall",
      qos: "QoS",
      dns: "DNS Cache",
      clientIsolation: "Aislamiento de Clientes",
      antiDdos: "Anti-DDoS",
      backup: "Backup",
    };

    async function logAction(action: string, result: ActionResult) {
      try {
        await prisma.networkLog.create({
          data: {
            action,
            status: result.success ? "success" : "error",
            message: result.message,
            details: JSON.stringify({ label: actionLabels[action] || action }),
          },
        });
      } catch (logErr) {
        console.error("[NetworkLog] Error saving log:", logErr);
      }
    }

    if (shouldApply("firewall")) {
      console.log("[Network Wizard] Aplicando firewall profesional...");
      results.firewall = await applyFirewall(api);
      await logAction("firewall", results.firewall);
      if (!results.firewall.success) errors.push(`Firewall: ${results.firewall.message}`);
    }

    if (shouldApply("qos")) {
      console.log("[Network Wizard] Configurando QoS...");
      results.qos = await applyQoS(api, totalBandwidthDown, totalBandwidthUp);
      await logAction("qos", results.qos);
      if (!results.qos.success) errors.push(`QoS: ${results.qos.message}`);
    }

    if (shouldApply("dns")) {
      console.log("[Network Wizard] Configurando DNS cache...");
      results.dns = await applyDNS(api);
      await logAction("dns", results.dns);
      if (!results.dns.success) errors.push(`DNS: ${results.dns.message}`);
    }

    if (shouldApply("clientIsolation")) {
      console.log("[Network Wizard] Configurando aislamiento de clientes...");
      results.clientIsolation = await applyClientIsolation(api);
      await logAction("clientIsolation", results.clientIsolation);
      if (!results.clientIsolation.success) errors.push(`Aislamiento: ${results.clientIsolation.message}`);
    }

    if (shouldApply("antiDdos")) {
      console.log("[Network Wizard] Aplicando proteccion anti-DDoS...");
      results.antiDdos = await applyAntiDdos(api);
      await logAction("antiDdos", results.antiDdos);
      if (!results.antiDdos.success) errors.push(`Anti-DDoS: ${results.antiDdos.message}`);
    }

    if (shouldApply("backup")) {
      console.log("[Network Wizard] Creando backup...");
      results.backup = await applyBackup(api);
      await logAction("backup", results.backup);
      if (!results.backup.success) errors.push(`Backup: ${results.backup.message}`);
    }

    api.close();

    return NextResponse.json({ results, errors });
  } catch (error) {
    try { api.close(); } catch { /* ignore */ }
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: `No se pudo conectar al MikroTik: ${message}`, results: {}, errors: [message] },
      { status: 503 }
    );
  }
}
