import { NextRequest, NextResponse } from "next/server";
import { RouterOSAPI } from "routeros-api";

export const dynamic = "force-dynamic";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RuleInfo {
  id: string;
  category: string;
  chain?: string;
  action: string;
  comment: string;
  isLinker: boolean;
  disabled: boolean;
  details: Record<string, string>;
  explanation: string;
}

interface CategorySummary {
  total: number;
  linker: number;
  existing: number;
  disabled: number;
  rules: RuleInfo[];
}

// ─── Explanation mapping ─────────────────────────────────────────────────────

const explanationMap: Record<string, string> = {
  "LK: Accept established,related": "Permite conexiones ya establecidas. Esencial para que internet funcione.",
  "LK: Drop invalid": "Bloquea paquetes malformados que podrian ser ataques.",
  "LK: Accept ICMP": "Permite ping (necesario para monitoreo de red).",
  "LK: Accept DNS from LAN": "Permite consultas DNS desde tu red local.",
  "LK: Accept Winbox": "Permite acceso a Winbox para administrar el router.",
  "LK: Accept SSH": "Permite acceso SSH al router para administracion remota.",
  "LK: Accept API": "Permite acceso a la API del router (usado por Linker).",
  "LK: Accept PPPoE discovery": "Permite descubrimiento de sesiones PPPoE.",
  "LK: Accept PPPoE session": "Permite sesiones PPPoE para clientes.",
  "LK: Drop all other input": "Bloquea todo acceso externo al router. Solo tu red local puede administrarlo.",
  "LK: Fwd accept established,related": "Permite trafico de reenvio para conexiones ya establecidas.",
  "LK: Fwd drop invalid": "Bloquea trafico de reenvio de paquetes malformados.",
  "LK: Fwd accept from LAN": "Permite a los clientes de tu red acceder a internet.",
  "LK: Fwd accept ICMP": "Permite ping a traves de la red (monitoreo).",
  "LK: SYN flood detect": "Detecta ataques de inundacion SYN. Limita conexiones nuevas por IP.",
  "LK: Drop SYN flood": "Bloquea IPs detectadas haciendo inundacion SYN.",
  "LK: Port scan detect": "Detecta escaneo de puertos y bloquea al atacante.",
  "LK: Drop port scanners": "Bloquea IPs que fueron detectadas escaneando puertos.",
  "LK: Block DNS amplification": "Bloquea ataques de amplificacion DNS desde fuera de tu red.",
  "LK: Block SNMP abuse": "Bloquea abuso del protocolo SNMP.",
  "LK: Winbox brute force": "Detecta intentos de fuerza bruta contra Winbox.",
  "LK: Drop Winbox brute force": "Bloquea IPs que intentan fuerza bruta contra Winbox.",
  "LK: Drop bogon 127.0.0.0/8": "Bloquea trafico con IPs de loopback falsificadas.",
  "LK: Drop bogon 224.0.0.0/3": "Bloquea trafico con IPs multicast/reservadas falsificadas.",
  "LK: Fwd drop all other": "Bloquea todo trafico entrante desde WAN que no sea respuesta.",
  "LK: Control de bajada global": "Limita el ancho de banda total de bajada de la red.",
  "LK: Control de subida global": "Limita el ancho de banda total de subida de la red.",
  "LK: PCQ bajada por cliente": "Distribuye el ancho de banda de bajada equitativamente entre clientes.",
  "LK: PCQ subida por cliente": "Distribuye el ancho de banda de subida equitativamente entre clientes.",
  "LK: Aislamiento de clientes": "Los clientes no pueden verse entre si. Protege la privacidad.",
  "LK: DDoS SYN flood": "Proteccion contra ataques de inundacion SYN. Limita conexiones por IP.",
  "LK: DDoS drop attackers": "Bloquea automaticamente a atacantes DDoS detectados.",
  "LK: DDoS ICMP flood": "Proteccion contra inundacion de pings (ICMP flood).",
  "LK: DDoS drop ICMP flood": "Bloquea IPs que envian demasiados pings.",
  "LK: DDoS UDP flood": "Proteccion contra inundacion UDP.",
  "LK: DDoS drop UDP flood": "Bloquea IPs que envian demasiado trafico UDP.",
};

function getExplanation(comment: string, rule: Record<string, string>): string {
  // Exact match
  if (explanationMap[comment]) return explanationMap[comment];

  // Partial match
  for (const [key, val] of Object.entries(explanationMap)) {
    if (comment.toLowerCase().includes(key.toLowerCase().replace("lk: ", ""))) {
      return val;
    }
  }

  // Generate from fields for Linker rules
  if (comment.startsWith("LK:") || comment.startsWith("Linker:")) {
    const action = rule["action"] || "";
    const chain = rule["chain"] || "";
    const proto = rule["protocol"] || "";
    const dstPort = rule["dst-port"] || "";
    const parts: string[] = [];
    if (action === "accept") parts.push("Permite");
    else if (action === "drop") parts.push("Bloquea");
    else if (action === "fasttrack connection") parts.push("Acelera");
    else parts.push(`Accion: ${action}`);
    if (proto) parts.push(`protocolo ${proto}`);
    if (dstPort) parts.push(`puerto ${dstPort}`);
    if (chain) parts.push(`en cadena ${chain}`);
    return parts.join(" ") + ".";
  }

  return "Regla existente (no gestionada por Linker)";
}

function mapRule(rule: Record<string, string>, category: string): RuleInfo {
  const comment = rule["comment"] || "";
  const isLinker = comment.startsWith("LK:") || comment.startsWith("Linker:");
  const disabled = rule["disabled"] === "true";

  // Build details object (all fields)
  const details: Record<string, string> = {};
  for (const [key, value] of Object.entries(rule)) {
    if (key !== ".id" && key !== "comment" && value && value !== "false" && value !== "") {
      details[key] = value;
    }
  }

  return {
    id: rule[".id"] || "",
    category,
    chain: rule["chain"] || undefined,
    action: rule["action"] || "",
    comment,
    isLinker,
    disabled,
    details,
    explanation: getExplanation(comment, rule),
  };
}

// ─── GET Handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const host = process.env.MIKROTIK_HOST || "10.10.10.3";
  const port = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
  const user = process.env.MIKROTIK_USER || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "";

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "all";

  const api = new RouterOSAPI({ host, port, user, password, timeout: 15 });

  try {
    await api.connect();

    const result: Record<string, CategorySummary> = {};

    const shouldFetch = (cat: string) => type === "all" || type === cat;

    // Firewall filter rules
    if (shouldFetch("firewall")) {
      try {
        const rules = (await api.write("/ip/firewall/filter/print")) as Record<string, string>[];
        const mapped = rules.map((r) => mapRule(r, "firewall"));
        const linker = mapped.filter((r) => r.isLinker);
        const existing = mapped.filter((r) => !r.isLinker);
        const disabled = mapped.filter((r) => r.disabled);
        result.firewall = {
          total: mapped.length,
          linker: linker.length,
          existing: existing.length,
          disabled: disabled.length,
          rules: mapped,
        };
      } catch {
        result.firewall = { total: 0, linker: 0, existing: 0, disabled: 0, rules: [] };
      }
    }

    // QoS: queue trees + queue types + mangle
    if (shouldFetch("qos")) {
      try {
        const queueTrees = (await api.write("/queue/tree/print")) as Record<string, string>[];
        const simpleQueues = (await api.write("/queue/simple/print")) as Record<string, string>[];
        const allQueues = [
          ...queueTrees.map((r) => mapRule(r, "qos")),
          ...simpleQueues.map((r) => ({ ...mapRule(r, "qos"), chain: "simple" })),
        ];
        // Also map queue tree names for better display
        for (const q of allQueues) {
          if (!q.chain && q.details["parent"]) {
            q.chain = q.details["parent"];
          }
          if (!q.action && q.details["max-limit"]) {
            q.action = q.details["max-limit"];
          }
          if (!q.action) q.action = "queue";
        }
        const linker = allQueues.filter((r) => r.isLinker);
        const existing = allQueues.filter((r) => !r.isLinker);
        const disabled = allQueues.filter((r) => r.disabled);
        result.qos = {
          total: allQueues.length,
          linker: linker.length,
          existing: existing.length,
          disabled: disabled.length,
          rules: allQueues,
        };
      } catch {
        result.qos = { total: 0, linker: 0, existing: 0, disabled: 0, rules: [] };
      }
    }

    // DNS
    if (shouldFetch("dns")) {
      try {
        const dnsResult = (await api.write("/ip/dns/print")) as Record<string, string>[];
        const dnsData = dnsResult[0] || {};
        const cacheEnabled = dnsData["allow-remote-requests"] === "true";
        const servers = (dnsData["servers"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
        const cacheSize = dnsData["cache-size"] || "N/A";
        const cacheUsed = dnsData["cache-used"] || "N/A";

        // DNS static entries
        let staticEntries: RuleInfo[] = [];
        try {
          const statics = (await api.write("/ip/dns/static/print")) as Record<string, string>[];
          staticEntries = statics.map((r) => mapRule(r, "dns"));
        } catch { /* ignore */ }

        const dnsRules: RuleInfo[] = [
          {
            id: "dns-config",
            category: "dns",
            chain: "config",
            action: cacheEnabled ? "habilitado" : "deshabilitado",
            comment: "Configuracion DNS",
            isLinker: false,
            disabled: !cacheEnabled,
            details: {
              servers: servers.join(", "),
              "cache-size": cacheSize,
              "cache-used": cacheUsed,
              "allow-remote-requests": cacheEnabled ? "si" : "no",
            },
            explanation: cacheEnabled
              ? `DNS cache activo. Servidores: ${servers.join(", ")}. Tamano de cache: ${cacheSize}.`
              : "DNS cache deshabilitado. Los clientes resuelven DNS directamente.",
          },
          ...staticEntries,
        ];

        result.dns = {
          total: dnsRules.length,
          linker: dnsRules.filter((r) => r.isLinker).length,
          existing: dnsRules.filter((r) => !r.isLinker).length,
          disabled: dnsRules.filter((r) => r.disabled).length,
          rules: dnsRules,
        };
      } catch {
        result.dns = { total: 0, linker: 0, existing: 0, disabled: 0, rules: [] };
      }
    }

    // Client Isolation: bridge filters
    if (shouldFetch("isolation")) {
      try {
        const bridgeFilters = (await api.write("/interface/bridge/filter/print")) as Record<string, string>[];
        const mapped = bridgeFilters.map((r) => mapRule(r, "isolation"));
        const linker = mapped.filter((r) => r.isLinker);
        const existing = mapped.filter((r) => !r.isLinker);
        const disabled = mapped.filter((r) => r.disabled);
        result.isolation = {
          total: mapped.length,
          linker: linker.length,
          existing: existing.length,
          disabled: disabled.length,
          rules: mapped,
        };
      } catch {
        result.isolation = { total: 0, linker: 0, existing: 0, disabled: 0, rules: [] };
      }
    }

    // Anti-DDoS: raw rules
    if (shouldFetch("antiddos")) {
      try {
        const rawRules = (await api.write("/ip/firewall/raw/print")) as Record<string, string>[];
        const mapped = rawRules.map((r) => mapRule(r, "antiddos"));
        const linker = mapped.filter((r) => r.isLinker);
        const existing = mapped.filter((r) => !r.isLinker);
        const disabled = mapped.filter((r) => r.disabled);
        result.antiddos = {
          total: mapped.length,
          linker: linker.length,
          existing: existing.length,
          disabled: disabled.length,
          rules: mapped,
        };
      } catch {
        result.antiddos = { total: 0, linker: 0, existing: 0, disabled: 0, rules: [] };
      }
    }

    api.close();

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
