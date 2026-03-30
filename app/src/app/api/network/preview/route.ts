import { NextRequest, NextResponse } from "next/server";
import { RouterOSAPI } from "routeros-api";

export const dynamic = "force-dynamic";

// ─── Explanation mapping (same as rules API) ─────────────────────────────────

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
  "LK: Drop all other input": "Bloquea todo acceso externo al router.",
  "LK: Fwd accept established,related": "Permite trafico de reenvio para conexiones establecidas.",
  "LK: Fwd drop invalid": "Bloquea trafico de reenvio de paquetes malformados.",
  "LK: Fwd accept from LAN": "Permite a los clientes acceder a internet.",
  "LK: Fwd accept ICMP": "Permite ping a traves de la red.",
  "LK: SYN flood detect": "Detecta ataques de inundacion SYN.",
  "LK: Drop SYN flood": "Bloquea IPs con inundacion SYN.",
  "LK: Port scan detect": "Detecta escaneo de puertos.",
  "LK: Drop port scanners": "Bloquea IPs escaneando puertos.",
  "LK: Block DNS amplification": "Bloquea ataques de amplificacion DNS.",
  "LK: Block SNMP abuse": "Bloquea abuso SNMP.",
  "LK: Winbox brute force": "Detecta fuerza bruta contra Winbox.",
  "LK: Drop Winbox brute force": "Bloquea fuerza bruta contra Winbox.",
  "LK: Drop bogon 127.0.0.0/8": "Bloquea trafico con IPs loopback falsificadas.",
  "LK: Drop bogon 224.0.0.0/3": "Bloquea trafico con IPs multicast falsificadas.",
  "LK: Fwd drop all other": "Bloquea todo trafico entrante desde WAN.",
  "LK: Control de bajada global": "Limita ancho de banda total de bajada.",
  "LK: Control de subida global": "Limita ancho de banda total de subida.",
  "LK: PCQ bajada por cliente": "Distribuye bajada equitativamente entre clientes.",
  "LK: PCQ subida por cliente": "Distribuye subida equitativamente entre clientes.",
  "LK: Aislamiento de clientes": "Los clientes no pueden verse entre si.",
  "LK: DDoS SYN flood": "Proteccion contra inundacion SYN.",
  "LK: DDoS drop attackers": "Bloquea atacantes DDoS detectados.",
  "LK: DDoS ICMP flood": "Proteccion contra inundacion ICMP.",
  "LK: DDoS drop ICMP flood": "Bloquea inundacion ICMP.",
  "LK: DDoS UDP flood": "Proteccion contra inundacion UDP.",
  "LK: DDoS drop UDP flood": "Bloquea inundacion UDP.",
};

function getExplanation(comment: string): string {
  return explanationMap[comment] || comment;
}

// ─── Rule definitions per action ─────────────────────────────────────────────

interface PlannedRule {
  chain: string;
  action: string;
  comment: string;
  explanation: string;
}

function getFirewallRules(): PlannedRule[] {
  return [
    { chain: "input", action: "accept", comment: "LK: Accept established,related", explanation: "" },
    { chain: "input", action: "drop", comment: "LK: Drop invalid", explanation: "" },
    { chain: "input", action: "accept", comment: "LK: Accept ICMP", explanation: "" },
    { chain: "input", action: "accept", comment: "LK: Accept DNS from LAN", explanation: "" },
    { chain: "input", action: "accept", comment: "LK: Accept Winbox", explanation: "" },
    { chain: "input", action: "accept", comment: "LK: Accept SSH", explanation: "" },
    { chain: "input", action: "accept", comment: "LK: Accept API", explanation: "" },
    { chain: "input", action: "accept", comment: "LK: Accept PPPoE discovery", explanation: "" },
    { chain: "input", action: "accept", comment: "LK: Accept PPPoE session", explanation: "" },
    { chain: "input", action: "drop", comment: "LK: Drop all other input", explanation: "" },
    { chain: "forward", action: "accept", comment: "LK: Fwd accept established,related", explanation: "" },
    { chain: "forward", action: "drop", comment: "LK: Fwd drop invalid", explanation: "" },
    { chain: "forward", action: "accept", comment: "LK: Fwd accept from LAN", explanation: "" },
    { chain: "forward", action: "accept", comment: "LK: Fwd accept ICMP", explanation: "" },
    { chain: "input", action: "add-src-to-address-list", comment: "LK: SYN flood detect", explanation: "" },
    { chain: "input", action: "drop", comment: "LK: Drop SYN flood", explanation: "" },
    { chain: "input", action: "add-src-to-address-list", comment: "LK: Port scan detect", explanation: "" },
    { chain: "input", action: "drop", comment: "LK: Drop port scanners", explanation: "" },
    { chain: "forward", action: "drop", comment: "LK: Block DNS amplification", explanation: "" },
    { chain: "forward", action: "drop", comment: "LK: Block SNMP abuse", explanation: "" },
    { chain: "input", action: "add-src-to-address-list", comment: "LK: Winbox brute force", explanation: "" },
    { chain: "input", action: "drop", comment: "LK: Drop Winbox brute force", explanation: "" },
    { chain: "forward", action: "drop", comment: "LK: Drop bogon 127.0.0.0/8", explanation: "" },
    { chain: "forward", action: "drop", comment: "LK: Drop bogon 224.0.0.0/3", explanation: "" },
    { chain: "forward", action: "drop", comment: "LK: Fwd drop all other", explanation: "" },
  ].map((r) => ({ ...r, explanation: getExplanation(r.comment) }));
}

function getQoSRules(): PlannedRule[] {
  return [
    { chain: "global", action: "queue", comment: "LK: Control de bajada global", explanation: "" },
    { chain: "global", action: "queue", comment: "LK: Control de subida global", explanation: "" },
    { chain: "Linker-Download", action: "pcq", comment: "LK: PCQ bajada por cliente", explanation: "" },
    { chain: "Linker-Upload", action: "pcq", comment: "LK: PCQ subida por cliente", explanation: "" },
  ].map((r) => ({ ...r, explanation: getExplanation(r.comment) }));
}

function getDNSRules(): PlannedRule[] {
  return [
    {
      chain: "config",
      action: "set",
      comment: "Configuracion DNS",
      explanation: "Activa DNS cache con servidores 8.8.8.8, 1.1.1.1, 208.67.222.222. Cache de 4096KiB.",
    },
  ];
}

function getIsolationRules(): PlannedRule[] {
  return [
    {
      chain: "forward",
      action: "drop",
      comment: "LK: Aislamiento de clientes",
      explanation: "Los clientes no pueden verse entre si. Se aplica a cada bridge.",
    },
  ];
}

function getAntiDDoSRules(): PlannedRule[] {
  return [
    { chain: "prerouting", action: "add-src-to-address-list", comment: "LK: DDoS SYN flood", explanation: "" },
    { chain: "prerouting", action: "drop", comment: "LK: DDoS drop attackers", explanation: "" },
    { chain: "prerouting", action: "add-src-to-address-list", comment: "LK: DDoS ICMP flood", explanation: "" },
    { chain: "prerouting", action: "drop", comment: "LK: DDoS drop ICMP flood", explanation: "" },
    { chain: "prerouting", action: "add-src-to-address-list", comment: "LK: DDoS UDP flood", explanation: "" },
    { chain: "prerouting", action: "drop", comment: "LK: DDoS drop UDP flood", explanation: "" },
  ].map((r) => ({ ...r, explanation: getExplanation(r.comment) }));
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const host = process.env.MIKROTIK_HOST || "10.10.10.3";
  const port = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
  const user = process.env.MIKROTIK_USER || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "";

  let body: { action: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalido" }, { status: 400 });
  }

  const { action } = body;
  if (!action) {
    return NextResponse.json({ error: "Se requiere action" }, { status: 400 });
  }

  // Get planned rules
  let plannedRules: PlannedRule[] = [];
  let mikrotikPath = "";

  switch (action) {
    case "firewall":
      plannedRules = getFirewallRules();
      mikrotikPath = "/ip/firewall/filter";
      break;
    case "qos":
      plannedRules = getQoSRules();
      mikrotikPath = "/queue/tree";
      break;
    case "dns":
      plannedRules = getDNSRules();
      break;
    case "clientIsolation":
      plannedRules = getIsolationRules();
      mikrotikPath = "/interface/bridge/filter";
      break;
    case "antiDdos":
      plannedRules = getAntiDDoSRules();
      mikrotikPath = "/ip/firewall/raw";
      break;
    default:
      return NextResponse.json({ error: `Accion desconocida: ${action}` }, { status: 400 });
  }

  // Try to connect to MikroTik to check existing rules
  const api = new RouterOSAPI({ host, port, user, password, timeout: 10 });

  try {
    await api.connect();

    let existingComments: string[] = [];
    let existingTotal = 0;

    if (mikrotikPath) {
      try {
        const existing = (await api.write(`${mikrotikPath}/print`)) as Record<string, string>[];
        existingTotal = existing.filter((r) => {
          const c = r["comment"] || "";
          return !c.startsWith("LK:") && !c.startsWith("Linker:");
        }).length;
        existingComments = existing.map((r) => r["comment"] || "");
      } catch { /* ignore */ }
    }

    const willCreate: PlannedRule[] = [];
    const willSkip: { comment: string; reason: string }[] = [];

    for (const rule of plannedRules) {
      if (existingComments.includes(rule.comment)) {
        willSkip.push({ comment: rule.comment, reason: "Ya existe" });
      } else {
        willCreate.push(rule);
      }
    }

    api.close();

    return NextResponse.json({
      willCreate,
      willSkip,
      existingRules: existingTotal,
      newRules: willCreate.length,
      totalPlanned: plannedRules.length,
    });
  } catch (error) {
    try { api.close(); } catch { /* ignore */ }

    // If can't connect, return all rules as "will create" with a warning
    return NextResponse.json({
      willCreate: plannedRules,
      willSkip: [],
      existingRules: 0,
      newRules: plannedRules.length,
      totalPlanned: plannedRules.length,
      warning: "No se pudo conectar al MikroTik. Se muestran todas las reglas planificadas.",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
}
