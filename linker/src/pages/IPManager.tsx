import { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  Server,
  Monitor,
  Plus,
  X,
  CheckCircle,
  Radio,
  ExternalLink,
  WifiOff,
  Network,
  Circle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Skeleton from "@/components/Skeleton";

/* ───────── Types ───────── */

interface SubnetInfo {
  network: string;
  gateway: string;
  interface: string;
  is_primary: boolean;
}

interface UsedIP {
  ip: string;
  type: "gateway" | "node" | "node_offline" | "dhcp" | "unknown";
  name: string;
  mac?: string;
  source: string;
  interface?: string;
  node_id?: string;
  dhcp_status?: string;
}

interface IPMapResult {
  connected: boolean;
  error?: string;
  subnets: SubnetInfo[];
  primary_subnet: string;
  primary_gateway: string;
  primary_prefix: string;
  used: UsedIP[];
  next_available: string;
  total_used: number;
  total_free: number;
}

/* ───────── Helpers ───────── */

function ipToLastOctet(ip: string): number {
  return parseInt(ip.split(".").pop() ?? "0", 10);
}

type DeviceType = "gateway" | "node" | "node_offline" | "dhcp" | "unknown";

interface DeviceCard {
  ip: string;
  octet: number;
  type: DeviceType;
  name: string;
  mac: string;
  source: string;
  node_id?: string;
  iface?: string;
}

function sourceLabel(source: string): string {
  switch (source) {
    case "arp+db": return "ARP + DB";
    case "db":     return "Solo DB";
    case "dhcp":   return "DHCP Lease";
    case "arp":    return "Solo ARP";
    case "router": return "Router";
    default:       return source;
  }
}

function statusText(type: DeviceType): string {
  switch (type) {
    case "gateway":      return "En linea";
    case "node":         return "En linea";
    case "node_offline": return "Sin conexion";
    case "dhcp":         return "En linea";
    case "unknown":      return "Detectado";
  }
}

/* ───────── Cell colors ───────── */

const CELL_STYLES: Record<string, { bg: string; text: string; extra?: string }> = {
  gateway:      { bg: "bg-[#006fff]", text: "text-white" },
  node:         { bg: "bg-[#16a34a]", text: "text-white" },
  node_offline: { bg: "bg-[#16a34a]/20", text: "text-[#16a34a]", extra: "border border-dashed border-[#16a34a]/40" },
  dhcp:         { bg: "bg-[#f59e0b]", text: "text-white" },
  unknown:      { bg: "bg-[#8b5cf6]", text: "text-white" },
  reserved:     { bg: "bg-[#fee2e2]", text: "text-[#dc2626]/60" },
  free:         { bg: "bg-[#f8fafc]", text: "text-[#cbd5e1]", extra: "border border-[#f1f5f9]" },
};

const LEGEND_ITEMS: { type: string; color: string; label: string }[] = [
  { type: "gateway", color: "#006fff", label: "Gateway" },
  { type: "node", color: "#16a34a", label: "Nodo" },
  { type: "dhcp", color: "#f59e0b", label: "DHCP" },
  { type: "unknown", color: "#8b5cf6", label: "Desconocido" },
  { type: "free", color: "#e2e8f0", label: "Libre" },
];

const STATUS_DOT_COLORS: Record<DeviceType, string> = {
  gateway: "#006fff",
  node: "#16a34a",
  node_offline: "#94a3b8",
  dhcp: "#f59e0b",
  unknown: "#8b5cf6",
};

const TYPE_LABELS: Record<DeviceType, string> = {
  gateway: "Gateway",
  node: "Nodo",
  node_offline: "Nodo (offline)",
  dhcp: "DHCP",
  unknown: "Desconocido",
};

/* ───────── Range labels for left sidebar ───────── */

interface RangeLabel {
  startRow: number;
  endRow: number;
  label: string;
  sub: string;
}

const RANGE_LABELS: RangeLabel[] = [
  { startRow: 0, endRow: 5, label: "Reservado", sub: ".0 - .95" },
  { startRow: 6, endRow: 11, label: "DHCP", sub: ".96 - .191" },
  { startRow: 12, endRow: 13, label: "Estaticos", sub: ".192 - .223" },
  { startRow: 14, endRow: 15, label: "General", sub: ".224 - .255" },
];

/* ───────── IP Cell Component ───────── */

function IPCell({
  ip,
  octet,
  entry,
  isSelected,
  onClick,
}: {
  ip: string;
  octet: number;
  entry: DeviceCard | undefined;
  isSelected: boolean;
  onClick: (ip: string) => void;
}) {
  const cellType = entry?.type || (octet === 0 || octet === 255 ? "reserved" : "free");
  const style = CELL_STYLES[cellType] || CELL_STYLES.free;

  return (
    <button
      onClick={() => onClick(ip)}
      className={`
        aspect-square w-full rounded-[5px] flex items-center justify-center
        font-mono text-[9px] font-medium transition-all duration-100
        hover:scale-105 hover:shadow-md cursor-pointer select-none
        ${style.bg} ${style.text} ${style.extra || ""}
        ${isSelected ? "ring-2 ring-[#006fff] ring-offset-1 scale-110 z-10 shadow-lg" : ""}
      `}
      title={entry ? `${ip} - ${entry.name || "Sin nombre"}` : ip}
    >
      {octet}
    </button>
  );
}

/* ───────── Component ───────── */

export default function IPManagerPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [ipMap, setIpMap] = useState<IPMapResult | null>(null);
  const [selectedSubnet, setSelectedSubnet] = useState<string>("");
  const [selectedIp, setSelectedIp] = useState<string | null>(null);

  // Assign form
  const [assignIp, setAssignIp] = useState("");
  const [assignName, setAssignName] = useState("");
  const [assignType, setAssignType] = useState("CPE");
  const [assignMac, setAssignMac] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [showAssignModal, setShowAssignModal] = useState(false);

  const fetchMap = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const result = await invoke<IPMapResult>("get_ip_map");
      setIpMap(result);
      if (!selectedSubnet && result.primary_prefix) {
        setSelectedSubnet(result.primary_prefix);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedSubnet]);

  useEffect(() => { fetchMap(); }, []);

  const activePrefix = selectedSubnet || ipMap?.primary_prefix || "192.168.1.";

  // Build device lookup by octet
  const devices = useMemo<DeviceCard[]>(() => {
    if (!ipMap) return [];
    return ipMap.used
      .filter(entry => entry.ip.startsWith(activePrefix))
      .map(entry => ({
        ip: entry.ip,
        octet: ipToLastOctet(entry.ip),
        type: entry.type as DeviceType,
        name: entry.name,
        mac: entry.mac ?? "",
        source: entry.source,
        node_id: entry.node_id,
        iface: entry.interface,
      }))
      .sort((a, b) => a.octet - b.octet);
  }, [ipMap, activePrefix]);

  const deviceMap = useMemo(() => {
    const map = new Map<number, DeviceCard>();
    for (const d of devices) map.set(d.octet, d);
    return map;
  }, [devices]);

  const usedCount = devices.length;
  const freeCount = 254 - usedCount;

  // Selected device detail
  const selectedDevice = useMemo(() => {
    if (!selectedIp) return null;
    const octet = ipToLastOctet(selectedIp);
    return deviceMap.get(octet) || null;
  }, [selectedIp, deviceMap]);

  // Set default assign IP
  useEffect(() => {
    if (ipMap?.next_available) {
      setAssignIp(ipMap.next_available);
    }
  }, [ipMap?.next_available]);

  function openAssignModal(ip?: string, mac?: string) {
    setAssignIp(ip || ipMap?.next_available || "");
    setAssignName("");
    setAssignType("CPE");
    setAssignMac(mac || "");
    setAssignError("");
    setShowAssignModal(true);
  }

  async function handleAssign() {
    const ip = assignIp.trim();
    const name = assignName.trim();
    if (!ip || !name) return;
    setAssigning(true);
    setAssignError("");
    try {
      await invoke("add_antenna", {
        name,
        ip,
        antennaType: assignType,
        parentId: null,
      });
      setShowAssignModal(false);
      setAssignName("");
      setAssignMac("");
      await fetchMap(true);
    } catch (err) {
      setAssignError(String(err));
    } finally {
      setAssigning(false);
    }
  }

  function handleCellClick(ip: string) {
    setSelectedIp(prev => prev === ip ? null : ip);
  }

  const subnetDisplay = ipMap?.primary_subnet ?? "192.168.1.0/24";

  // Build 256 cells
  const cells = useMemo(() => {
    const result: { ip: string; octet: number; entry: DeviceCard | undefined }[] = [];
    for (let i = 0; i < 256; i++) {
      const ip = `${activePrefix}${i}`;
      result.push({ ip, octet: i, entry: deviceMap.get(i) });
    }
    return result;
  }, [activePrefix, deviceMap]);

  /* ── Skeleton loading ── */
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-[600px] w-[60px] rounded-xl" />
          <Skeleton className="h-[600px] flex-1 rounded-xl" />
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (error && !ipMap) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="rounded-2xl border border-[#fee2e2] bg-white p-8 text-center shadow-sm max-w-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fef2f2]">
            <AlertTriangle className="h-6 w-6 text-[#dc2626]" />
          </div>
          <p className="mt-4 text-sm font-medium text-[#0f172a]">Error al cargar el mapa de IPs</p>
          <p className="mt-1 text-xs text-[#64748b]">{error}</p>
          <button
            onClick={() => fetchMap()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-hidden">

      {/* ── Connection warning ── */}
      {ipMap && !ipMap.connected && (
        <div className="flex items-center gap-3 rounded-xl border border-[#fbbf24]/30 bg-[#fffbeb] px-4 py-2 mb-3 shrink-0">
          <WifiOff className="h-4 w-4 text-[#f59e0b] shrink-0" />
          <div>
            <p className="text-xs font-medium text-[#92400e]">Sin conexion al MikroTik</p>
            <p className="text-[10px] text-[#a16207]">Mostrando solo datos locales. {ipMap.error}</p>
          </div>
        </div>
      )}

      {/* ═══════════════════ HEADER ═══════════════════ */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight text-[#0f172a]">Mapa de IPs</h1>
            <span className="font-mono text-xs font-medium text-[#475569] bg-[#f1f5f9] px-2 py-0.5 rounded-md">
              {subnetDisplay}
            </span>
            {ipMap?.connected && (
              <span className="flex items-center gap-1 rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-medium text-[#166534]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a] animate-pulse" />
                Conectado
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-[#64748b]">
              <span className="font-semibold text-[#0f172a]">{usedCount}</span> usadas
              <span className="mx-1.5 text-[#cbd5e1]">&middot;</span>
              <span className="font-semibold text-[#0f172a]">{freeCount}</span> libres
              <span className="mx-1.5 text-[#cbd5e1]">&middot;</span>
              Siguiente: <span className="font-mono font-medium text-[#006fff]">{ipMap?.next_available || "--"}</span>
            </p>
            {/* Legend pills */}
            <div className="flex items-center gap-3 ml-2">
              {LEGEND_ITEMS.map(item => (
                <span key={item.type} className="flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[10px] text-[#94a3b8]">{item.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchMap(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-medium text-[#475569] shadow-sm hover:bg-[#f8fafc] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <button
            onClick={() => openAssignModal()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#006fff] px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-[#0057cc] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Asignar IP
          </button>
        </div>
      </div>

      {/* ═══════════════════ SUBNET TABS ═══════════════════ */}
      {ipMap && ipMap.subnets.length > 1 && (
        <div className="flex items-center gap-1 border-b border-[#e2e8f0] mb-3 shrink-0">
          {ipMap.subnets.map(s => {
            const prefix = s.gateway.split(".").slice(0, 3).join(".") + ".";
            const active = prefix === activePrefix;
            return (
              <button
                key={s.network}
                onClick={() => { setSelectedSubnet(prefix); setSelectedIp(null); }}
                className={`relative px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "text-[#006fff]"
                    : "text-[#64748b] hover:text-[#0f172a]"
                }`}
              >
                {s.network}
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#006fff] rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ═══════════════════ GRID AREA ═══════════════════ */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm flex-1 min-h-0 flex flex-col">
        <div className="flex flex-1 min-h-0 overflow-auto p-4">
          {/* Range labels column */}
          <div className="w-[72px] shrink-0 relative mr-3" style={{ minHeight: "fit-content" }}>
            {RANGE_LABELS.map((range) => {
              const topPercent = (range.startRow / 16) * 100; // percentage based
              const heightPercent = ((range.endRow - range.startRow + 1) / 16) * 100;
              return (
                <div
                  key={range.label}
                  className="absolute left-0 right-0 flex flex-col justify-center px-1"
                  style={{ top: `${topPercent}%`, height: `${heightPercent}%` }}
                >
                  <span className="text-[10px] font-semibold text-[#475569] leading-tight">{range.label}</span>
                  <span className="text-[9px] text-[#94a3b8] font-mono leading-tight">{range.sub}</span>
                </div>
              );
            })}
          </div>

          {/* The 16x16 grid */}
          <div className="flex-1 min-w-0">
            <div className="w-full">
              {/* Column headers */}
              <div
                className="grid mb-1"
                style={{
                  gridTemplateColumns: "repeat(16, 1fr)",
                  gap: "2px",
                }}
              >
                {Array.from({ length: 16 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-4 flex items-center justify-center text-[8px] font-mono text-[#94a3b8] font-medium"
                  >
                    +{i}
                  </div>
                ))}
              </div>

              {/* Grid cells */}
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "repeat(16, 1fr)",
                  gap: "2px",
                }}
              >
                {cells.map(({ ip, octet, entry }) => (
                  <IPCell
                    key={octet}
                    ip={ip}
                    octet={octet}
                    entry={entry}
                    isSelected={selectedIp === ip}
                    onClick={handleCellClick}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════ DETAIL BAR ═══════════════════ */}
        <div
          className={`border-t border-[#e2e8f0] bg-[#fafbfc] transition-all duration-200 overflow-hidden ${
            selectedIp ? "max-h-[120px] py-3 px-5" : "max-h-0 py-0 px-5"
          }`}
        >
          {selectedIp && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* IP */}
                <span className="font-mono text-sm font-bold text-[#0f172a]">{selectedIp}</span>

                {selectedDevice ? (
                  <>
                    {/* Status dot */}
                    <span className="flex items-center gap-1.5">
                      <Circle
                        className="h-2 w-2 fill-current"
                        style={{ color: STATUS_DOT_COLORS[selectedDevice.type] }}
                      />
                      <span className="text-xs text-[#475569]">{statusText(selectedDevice.type)}</span>
                    </span>

                    {/* Type badge */}
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{
                        backgroundColor:
                          selectedDevice.type === "gateway" ? "#eff6ff" :
                          selectedDevice.type === "node" ? "#f0fdf4" :
                          selectedDevice.type === "node_offline" ? "#f8fafc" :
                          selectedDevice.type === "dhcp" ? "#fffbeb" :
                          "#faf5ff",
                        color:
                          selectedDevice.type === "gateway" ? "#1e40af" :
                          selectedDevice.type === "node" ? "#166534" :
                          selectedDevice.type === "node_offline" ? "#475569" :
                          selectedDevice.type === "dhcp" ? "#92400e" :
                          "#6b21a8",
                      }}
                    >
                      {TYPE_LABELS[selectedDevice.type]}
                    </span>

                    {/* Name */}
                    <span className="text-sm font-medium text-[#0f172a]">
                      {selectedDevice.name || "Sin nombre"}
                    </span>

                    {/* MAC */}
                    {selectedDevice.mac && (
                      <span className="font-mono text-xs text-[#94a3b8]">{selectedDevice.mac}</span>
                    )}

                    {/* Source */}
                    <span className="text-[10px] text-[#94a3b8] bg-[#f1f5f9] rounded px-1.5 py-0.5">
                      {sourceLabel(selectedDevice.source)}
                    </span>
                  </>
                ) : (
                  <>
                    {ipToLastOctet(selectedIp) === 0 || ipToLastOctet(selectedIp) === 255 ? (
                      <span className="text-xs text-[#dc2626]/70 font-medium">Direccion reservada</span>
                    ) : (
                      <span className="text-xs text-[#94a3b8]">IP libre - disponible para asignar</span>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Actions based on type */}
                {selectedDevice?.node_id && (
                  <a
                    href={`/nodes/${selectedDevice.node_id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#006fff]/20 bg-[#eff6ff] px-3 py-1.5 text-xs font-medium text-[#006fff] hover:bg-[#dbeafe] transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Ver nodo
                  </a>
                )}

                {selectedDevice?.type === "unknown" && (
                  <button
                    onClick={() => openAssignModal(selectedDevice.ip, selectedDevice.mac)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#8b5cf6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#7c3aed] transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Agregar como nodo
                  </button>
                )}

                {!selectedDevice && ipToLastOctet(selectedIp) !== 0 && ipToLastOctet(selectedIp) !== 255 && (
                  <button
                    onClick={() => openAssignModal(selectedIp)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#006fff] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0057cc] transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Asignar esta IP
                  </button>
                )}

                <button
                  onClick={() => setSelectedIp(null)}
                  className="rounded-lg p-1.5 text-[#94a3b8] hover:text-[#475569] hover:bg-[#f1f5f9] transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════ ASSIGN MODAL ═══════════════════ */}
      {showAssignModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowAssignModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold text-[#0f172a]">Asignar IP</h3>
                <p className="text-xs text-[#94a3b8] mt-0.5">Agregar un nuevo dispositivo a la red</p>
              </div>
              <button
                onClick={() => setShowAssignModal(false)}
                className="rounded-lg p-1.5 text-[#94a3b8] hover:text-[#475569] hover:bg-[#f1f5f9] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* IP */}
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1.5">Direccion IP</label>
                <input
                  type="text"
                  value={assignIp}
                  onChange={e => setAssignIp(e.target.value)}
                  placeholder={ipMap?.next_available || "192.168.1.202"}
                  className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm font-mono text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10 transition-all"
                />
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1.5">Nombre del dispositivo</label>
                <input
                  type="text"
                  value={assignName}
                  onChange={e => setAssignName(e.target.value)}
                  placeholder="AP-Cerro-Norte"
                  className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10 transition-all placeholder:text-[#94a3b8]"
                />
              </div>

              {/* Type selector */}
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1.5">Tipo de dispositivo</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: "CPE", icon: Monitor, label: "CPE" },
                    { value: "AP", icon: Radio, label: "AP" },
                    { value: "BRIDGE", icon: Network, label: "Bridge" },
                    { value: "SWITCH", icon: Server, label: "Switch" },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setAssignType(opt.value)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition-all ${
                        assignType === opt.value
                          ? "border-[#006fff] bg-[#eff6ff] text-[#006fff] ring-1 ring-[#006fff]/20"
                          : "border-[#e2e8f0] bg-white text-[#475569] hover:border-[#cbd5e1] hover:bg-[#f8fafc]"
                      }`}
                    >
                      <opt.icon className="h-5 w-5" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* MAC */}
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1.5">MAC (opcional)</label>
                <input
                  type="text"
                  value={assignMac}
                  onChange={e => setAssignMac(e.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm font-mono focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10 transition-all placeholder:text-[#94a3b8]"
                />
              </div>

              {assignError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-[#dc2626] shrink-0 mt-0.5" />
                  <p className="text-xs text-[#dc2626]">{assignError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="flex-1 rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] hover:bg-[#f8fafc] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAssign}
                  disabled={!assignIp || !assignName || assigning}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#0057cc] disabled:opacity-40 transition-colors"
                >
                  {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Asignar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
