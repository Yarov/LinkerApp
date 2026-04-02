import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Network as NetworkIcon,
  ChevronRight,
  AlertTriangle,
  Pencil,
  Trash2,
  Search,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Loader2,
  Server,
  Monitor,
  X,
  Radio,
  ExternalLink,
  WifiOff,
  Circle,
  Wifi,
  Share2,
  Home,
  Cable,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import StatusBadge from "@/components/StatusBadge";
import Skeleton from "@/components/Skeleton";
import TableSkeleton from "@/components/skeletons/TableSkeleton";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useMikrotikStore } from "@/stores/useMikrotikStore";
import { useAppStore, type NodeData } from "@/stores/useAppStore";

/* ═══════════════════ SHARED TYPES ═══════════════════ */

interface NodeForm { name: string; type: string; ip: string; parentId: string; }
const emptyNodeForm: NodeForm = { name: "", type: "CPE", ip: "", parentId: "" };

type TabKey = "topology" | "ips" | "discover";

/* ═══════════════════ IP MAP TYPES ═══════════════════ */

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

/* ═══════════════════ IP MAP HELPERS ═══════════════════ */

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

/* ═══════════════════ DISCOVER TYPES ═══════════════════ */

interface DiscoveredDevice { ip: string; responsive: boolean; }
interface DiscoverResult { subnet: string; found: number; devices: DiscoveredDevice[]; }

/* ═══════════════════ IP CELL COMPONENT ═══════════════════ */

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

/* ═══════════════════ MAIN COMPONENT ═══════════════════ */

export default function RedPage() {
  const navigate = useNavigate();
  const mikrotikConnected = useMikrotikStore(s => s.connected);

  // ── Store: Nodes ──
  const nodes = useAppStore(s => s.nodes);
  const nodesLoaded = useAppStore(s => s.nodesLoaded);
  const nodesLoading = useAppStore(s => s.nodesLoading);
  const nodesError = useAppStore(s => s.nodesError);
  const storeFetchNodes = useAppStore(s => s.fetchNodes);
  const invalidateNodes = useAppStore(s => s.invalidateNodes);
  const invalidateDashboard = useAppStore(s => s.invalidateDashboard);
  const loading = nodesLoading && !nodesLoaded;
  const error = nodesError;

  // ── Tab state ──
  const [tab, setTab] = useState<TabKey>("topology");

  // ── Topology state ──
  const [view, setView] = useState<"table" | "tree">("table");
  const [showAddForm, setShowAddForm] = useState(false);
  const [nodeForm, setNodeForm] = useState<NodeForm>(emptyNodeForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [editingNode, setEditingNode] = useState<NodeData | null>(null);
  const [deletingNode, setDeletingNode] = useState<NodeData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "warning" } | null>(null);
  const [detecting, setDetecting] = useState(false);

  // ── IP Map state ──
  const [ipLoading, setIpLoading] = useState(false);
  const [ipRefreshing, setIpRefreshing] = useState(false);
  const [ipError, setIpError] = useState("");
  const [ipMap, setIpMap] = useState<IPMapResult | null>(null);
  const [selectedSubnet, setSelectedSubnet] = useState<string>("");
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [assignIp, setAssignIp] = useState("");
  const [assignName, setAssignName] = useState("");
  const [assignType, setAssignType] = useState("CPE");
  const [assignMac, setAssignMac] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [ipMapLoaded, setIpMapLoaded] = useState(false);

  // ── Discover state ──
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState("");
  const [subnet, setSubnet] = useState("10.10.10");
  const [adding, setAdding] = useState<string | null>(null);
  const [addedIps, setAddedIps] = useState<Set<string>>(new Set());

  // ── Fetch nodes (shared via store) ──
  const fetchNodes = useCallback(() => {
    invalidateNodes();
    storeFetchNodes();
  }, [invalidateNodes, storeFetchNodes]);

  useEffect(() => {
    if (!nodesLoaded && !nodesLoading) storeFetchNodes();
  }, [nodesLoaded, nodesLoading, storeFetchNodes]);

  // ── Fetch IP map (lazy on first tab visit) ──
  const fetchMap = useCallback(async (isRefresh = false) => {
    if (isRefresh) setIpRefreshing(true);
    else setIpLoading(true);
    setIpError("");
    try {
      const result = await invoke<IPMapResult>("get_ip_map");
      setIpMap(result);
      if (!selectedSubnet && result.primary_prefix) {
        setSelectedSubnet(result.primary_prefix);
      }
    } catch (err) {
      setIpError(String(err));
    } finally {
      setIpLoading(false);
      setIpRefreshing(false);
      setIpMapLoaded(true);
    }
  }, [selectedSubnet]);

  // Load IP map on first tab switch
  useEffect(() => {
    if (tab === "ips" && !ipMapLoaded && !ipLoading) {
      fetchMap();
    }
  }, [tab, ipMapLoaded, ipLoading, fetchMap]);

  const onlineCount = nodes.filter(n => (n.status ?? "").toUpperCase() === "ONLINE").length;
  const isEditing = !!editingNode;

  // ── IP Map computed values ──
  const activePrefix = selectedSubnet || ipMap?.primary_prefix || "192.168.1.";

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

  const selectedDevice = useMemo(() => {
    if (!selectedIp) return null;
    const octet = ipToLastOctet(selectedIp);
    return deviceMap.get(octet) || null;
  }, [selectedIp, deviceMap]);

  useEffect(() => {
    if (ipMap?.next_available) {
      setAssignIp(ipMap.next_available);
    }
  }, [ipMap?.next_available]);

  const cells = useMemo(() => {
    const result: { ip: string; octet: number; entry: DeviceCard | undefined }[] = [];
    for (let i = 0; i < 256; i++) {
      const ip = `${activePrefix}${i}`;
      result.push({ ip, octet: i, entry: deviceMap.get(i) });
    }
    return result;
  }, [activePrefix, deviceMap]);

  // ── Handlers ──
  const handleNodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodeForm.name || !nodeForm.ip) { setFormError("Nombre e IP son obligatorios."); return; }
    setSaving(true); setFormError("");
    try {
      if (isEditing) {
        await invoke("update_node", {
          id: editingNode.id,
          name: nodeForm.name,
          nodeType: nodeForm.type,
          ip: nodeForm.ip || null,
          mac: null, model: null, firmware: null,
          latitude: null, longitude: null,
          parentId: nodeForm.parentId || null,
        });
      } else {
        await invoke("create_node", {
          name: nodeForm.name,
          nodeType: nodeForm.type,
          ip: nodeForm.ip || null,
          mac: null, model: null, firmware: null,
          latitude: null, longitude: null,
          parentId: nodeForm.parentId || null,
        });
      }
      setShowAddForm(false); setEditingNode(null); setNodeForm(emptyNodeForm); invalidateDashboard(); fetchNodes();
      setTimeout(() => setToast(null), 6000);
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); }
  };

  const handleDeleteNode = async () => {
    if (!deletingNode) return; setDeleting(true);
    try { await invoke("delete_node", { id: deletingNode.id }); setDeletingNode(null); invalidateDashboard(); fetchNodes(); } catch (err) { alert(err instanceof Error ? err.message : String(err)); } finally { setDeleting(false); }
  };

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
        name, ip, antennaType: assignType, parentId: null,
      });
      setShowAssignModal(false);
      setAssignName("");
      setAssignMac("");
      await fetchMap(true);
      fetchNodes();
    } catch (err) {
      setAssignError(String(err));
    } finally {
      setAssigning(false);
    }
  }

  function handleCellClick(ip: string) {
    setSelectedIp(prev => prev === ip ? null : ip);
  }

  const handleScan = async () => {
    setDiscoverLoading(true); setDiscoverError(""); setDiscoverResult(null);
    try {
      const data = await invoke<DiscoverResult>("discover_devices", { subnet: subnet || undefined });
      setDiscoverResult(data);
    } catch (err) { setDiscoverError(String(err)); } finally { setDiscoverLoading(false); }
  };

  const handleAddNode = async (device: DiscoveredDevice) => {
    setAdding(device.ip);
    try {
      await invoke("create_node", {
        name: `Dispositivo ${device.ip}`,
        nodeType: "CPE",
        ip: device.ip,
        mac: null, model: null, firmware: null,
        latitude: null, longitude: null, parentId: null,
      });
      setAddedIps(prev => new Set(prev).add(device.ip));
      fetchNodes();
    } catch (err) { alert(String(err)); } finally { setAdding(null); }
  };

  const inputClass = "w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30";

  const subnetDisplay = ipMap?.primary_subnet ?? "192.168.1.0/24";

  /* ── Loading state ── */
  if (loading) return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><Skeleton className="h-7 w-16" /><Skeleton className="mt-2 h-4 w-32" /></div>
      </div>
      <TableSkeleton rows={5} columns={6} />
    </div>
  );

  /* ── Error state ── */
  if (error) return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
        <p className="mt-4 text-sm text-[#dc2626]">{error}</p>
        <button onClick={() => { fetchNodes(); }} className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white">Reintentar</button>
      </div>
    </div>
  );

  /* ═══════════════════ RENDER ═══════════════════ */
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-hidden">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Red</h1>
          <p className="mt-1 text-sm text-[#475569]">{onlineCount}/{nodes.length} nodos en linea</p>
        </div>

        <div className="flex items-center gap-3">
          {/* ── Tab pills ── */}
          <div className="flex overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
            <button
              onClick={() => setTab("topology")}
              className={`px-4 py-2 text-xs font-medium transition-colors ${tab === "topology" ? "bg-[#eff6ff] text-[#006fff]" : "text-[#94a3b8] hover:text-[#475569]"}`}
            >
              Topologia
            </button>
            <button
              onClick={() => setTab("ips")}
              className={`px-4 py-2 text-xs font-medium transition-colors ${tab === "ips" ? "bg-[#eff6ff] text-[#006fff]" : "text-[#94a3b8] hover:text-[#475569]"}`}
            >
              Mapa IPs
            </button>
            <button
              onClick={() => setTab("discover")}
              className={`px-4 py-2 text-xs font-medium transition-colors ${tab === "discover" ? "bg-[#eff6ff] text-[#006fff]" : "text-[#94a3b8] hover:text-[#475569]"}`}
            >
              Descubrir
            </button>
          </div>

          {/* ── Topology sub-view toggle ── */}
          {tab === "topology" && (
            <div className="flex overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
              <button onClick={() => setView("table")} className={`px-4 py-2 text-xs font-medium ${view === "table" ? "bg-[#eff6ff] text-[#006fff]" : "text-[#94a3b8]"}`}>Tabla</button>
              <button onClick={() => setView("tree")} className={`px-4 py-2 text-xs font-medium ${view === "tree" ? "bg-[#eff6ff] text-[#006fff]" : "text-[#94a3b8]"}`}>Arbol</button>
            </div>
          )}

          {/* ── Auto-detect (always visible) ── */}
          <button
            onClick={async () => {
              setDetecting(true);
              try {
                await invoke("auto_detect_topology");
                setToast({ message: "Topologia verificada", type: "success" });
                fetchNodes();
                setTimeout(() => setToast(null), 6000);
              } catch {
                setToast({ message: "Error al auto-detectar", type: "warning" });
              } finally { setDetecting(false); }
            }}
            disabled={detecting || !mikrotikConnected}
            className="flex items-center gap-2 rounded-xl border border-[#16a34a]/30 bg-[#f0fdf4] px-4 py-2.5 text-sm font-medium text-[#16a34a] hover:bg-[#dcfce7] disabled:opacity-50"
          >
            <NetworkIcon className={`h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
            {detecting ? "Detectando..." : "Auto-detectar"}
          </button>

          {/* ── Context-sensitive action button ── */}
          {tab === "topology" && (
            <button
              onClick={() => { setEditingNode(null); setNodeForm(emptyNodeForm); setFormError(""); setShowAddForm(true); }}
              className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc]"
            >
              <Plus className="h-4 w-4" />Nuevo Nodo
            </button>
          )}

          {tab === "ips" && (
            <>
              <button
                onClick={() => fetchMap(true)}
                disabled={ipRefreshing}
                className="flex items-center gap-1.5 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] hover:bg-[#f5f7fa] disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${ipRefreshing ? "animate-spin" : ""}`} />
                Actualizar
              </button>
              <button
                onClick={() => openAssignModal()}
                className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc]"
              >
                <Plus className="h-4 w-4" />Asignar IP
              </button>
            </>
          )}

          {tab === "discover" && (
            <button
              onClick={handleScan}
              disabled={discoverLoading || !mikrotikConnected}
              className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc] disabled:opacity-50"
            >
              <Search className={`h-4 w-4 ${discoverLoading ? "animate-spin" : ""}`} />
              {discoverLoading ? "Escaneando..." : "Escanear"}
            </button>
          )}
        </div>
      </div>

      {/* ═══════════════════ TAB: TOPOLOGIA ═══════════════════ */}
      {tab === "topology" && view === "tree" && (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 shadow-sm min-w-fit">
            {nodes.length === 0 ? (
              <p className="py-12 text-center text-sm text-[#94a3b8]">No hay nodos registrados</p>
            ) : (
              <div className="flex justify-center">
                {(() => {
                  const rootNodes = nodes.filter(n => !n.parentId);
                  const childMap = new Map<string, NodeData[]>();
                  for (const n of nodes) {
                    if (n.parentId) {
                      const arr = childMap.get(n.parentId) || [];
                      arr.push(n);
                      childMap.set(n.parentId, arr);
                    }
                  }

                  const nodeTypeConfig: Record<string, { bg: string; border: string; icon: typeof Server }> = {
                    ROUTER: { bg: "#eff6ff", border: "#006fff", icon: Server },
                    AP: { bg: "#f0fdf4", border: "#16a34a", icon: Radio },
                    STATION: { bg: "#f0fdf4", border: "#22c55e", icon: Wifi },
                    DISTRIBUTION: { bg: "#fefce8", border: "#f59e0b", icon: Share2 },
                    CPE: { bg: "#f5f3ff", border: "#8b5cf6", icon: Home },
                    SWITCH: { bg: "#fef3c7", border: "#d97706", icon: Cable },
                  };

                  function NodeCard({ node }: { node: NodeData }) {
                    const isOnline = (node.status ?? "").toUpperCase() === "ONLINE";
                    const cfg = nodeTypeConfig[node.type.toUpperCase()] || nodeTypeConfig.CPE;
                    const Icon = cfg.icon;
                    return (
                      <button
                        onClick={() => navigate(`/red/${node.id}`)}
                        className="w-[200px] rounded-2xl border border-[#e2e8f0] bg-white shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer overflow-hidden text-left"
                      >
                        <div className="h-1" style={{ backgroundColor: cfg.border }} />
                        <div className="p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="rounded-lg p-1.5" style={{ backgroundColor: cfg.bg }}>
                              <Icon className="h-4 w-4" style={{ color: cfg.border }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-[#0f172a] truncate">{node.name}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded-md bg-[#f5f7fa] px-1.5 py-0.5 text-[10px] font-medium text-[#475569]">{node.type}</span>
                              <span className="font-mono text-[10px] text-[#94a3b8]">{node.ip || "-"}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className={`h-2 w-2 rounded-full ${isOnline ? "bg-[#16a34a]" : "bg-[#dc2626]"}`} />
                              <span className={`text-[10px] ${isOnline ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
                                {isOnline ? "En linea" : "Sin conexion"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  }

                  function getLineColor(parentNode: NodeData, childNode: NodeData): string {
                    const parentOnline = (parentNode.status ?? "").toUpperCase() === "ONLINE";
                    const childOnline = (childNode.status ?? "").toUpperCase() === "ONLINE";
                    return parentOnline && childOnline ? "#16a34a" : "#e2e8f0";
                  }

                  function TopologyNode({ node, level }: { node: NodeData; level: number }) {
                    const children = childMap.get(node.id) || [];
                    return (
                      <div className="flex flex-col items-center">
                        <NodeCard node={node} />

                        {children.length > 0 && (
                          <>
                            {/* Vertical line down from parent */}
                            <div className="w-0.5 h-8" style={{ backgroundColor: children.length === 1 ? getLineColor(node, children[0]) : "#e2e8f0" }} />

                            {/* Horizontal connector spanning children */}
                            {children.length > 1 && (
                              <div className="relative flex">
                                {children.map((child, idx) => {
                                  const color = getLineColor(node, child);
                                  const isFirst = idx === 0;
                                  const isLast = idx === children.length - 1;
                                  return (
                                    <div
                                      key={child.id}
                                      className="flex flex-col items-center"
                                      style={{ minWidth: "220px" }}
                                    >
                                      {/* Horizontal bar segment + vertical down */}
                                      <div className="relative w-full h-0.5">
                                        {/* Left half of horizontal bar */}
                                        {!isFirst && (
                                          <div
                                            className="absolute top-0 left-0 h-0.5"
                                            style={{ width: "50%", backgroundColor: "#e2e8f0" }}
                                          />
                                        )}
                                        {/* Right half of horizontal bar */}
                                        {!isLast && (
                                          <div
                                            className="absolute top-0 right-0 h-0.5"
                                            style={{ width: "50%", backgroundColor: "#e2e8f0" }}
                                          />
                                        )}
                                      </div>
                                      {/* Vertical line down to child */}
                                      <div className="w-0.5 h-4" style={{ backgroundColor: color }} />
                                      <TopologyNode node={child} level={level + 1} />
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Single child - just render it directly */}
                            {children.length === 1 && (
                              <TopologyNode node={children[0]} level={level + 1} />
                            )}
                          </>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div className="flex gap-12 justify-center">
                      {rootNodes.map(root => (
                        <TopologyNode key={root.id} node={root} level={0} />
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "topology" && view === "table" && (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
                  <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Nombre</th>
                  <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Tipo</th>
                  <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">IP</th>
                  <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Estado</th>
                  <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Ultima vez visto</th>
                  <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {nodes.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-[#94a3b8]">No hay nodos registrados</td></tr>
                ) : nodes.map((node, idx) => (
                  <tr
                    key={node.id}
                    className={`cursor-pointer transition-colors hover:bg-[#f8f9fb] ${idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"}`}
                    onClick={() => navigate(`/red/${node.id}`)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${(node.status ?? "").toUpperCase() === "ONLINE" ? "bg-[#16a34a] status-dot-online" : (node.status ?? "").toUpperCase() === "DEGRADED" ? "bg-[#f59e0b]" : "bg-[#dc2626]"}`} />
                        <span className="font-medium text-[#0f172a]">{node.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5"><span className="rounded-md bg-[#f5f7fa] px-2.5 py-1 text-[10px] font-medium uppercase text-[#475569] border border-[#e2e8f0]">{node.type}</span></td>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#475569]">{node.ip}</td>
                    <td className="px-5 py-3.5"><StatusBadge status={node.status ?? "unknown"} size="sm" /></td>
                    <td className="px-5 py-3.5 text-xs text-[#94a3b8]">{node.lastSeen ? new Date(node.lastSeen).toLocaleString("es-MX") : "-"}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <button onClick={e => { e.stopPropagation(); setEditingNode(node); setNodeForm({ name: node.name, type: node.type, ip: node.ip, parentId: node.parentId ?? "" }); setShowAddForm(true); }} className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-[#eff6ff] hover:text-[#006fff]"><Pencil className="h-4 w-4" /></button>
                        <button onClick={e => { e.stopPropagation(); setDeletingNode(node); }} className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-[#fef2f2] hover:text-[#dc2626]"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════ TAB: MAPA IPS ═══════════════════ */}
      {tab === "ips" && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* IP loading */}
          {ipLoading && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-72" />
                </div>
              </div>
              <div className="flex gap-4 flex-1">
                <Skeleton className="h-full w-[60px] rounded-xl" />
                <Skeleton className="h-full flex-1 rounded-xl" />
              </div>
            </div>
          )}

          {/* IP error */}
          {!ipLoading && ipError && !ipMap && (
            <div className="flex flex-col items-center justify-center py-24">
              <div className="rounded-2xl border border-[#fee2e2] bg-white p-8 text-center shadow-sm max-w-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fef2f2]">
                  <AlertTriangle className="h-6 w-6 text-[#dc2626]" />
                </div>
                <p className="mt-4 text-sm font-medium text-[#0f172a]">Error al cargar el mapa de IPs</p>
                <p className="mt-1 text-xs text-[#64748b]">{ipError}</p>
                <button onClick={() => fetchMap()} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] transition-colors">
                  <RefreshCw className="h-4 w-4" />Reintentar
                </button>
              </div>
            </div>
          )}

          {/* IP map content */}
          {!ipLoading && ipMap && (
            <>
              {/* Connection warning */}
              {!ipMap.connected && (
                <div className="flex items-center gap-3 rounded-xl border border-[#fbbf24]/30 bg-[#fffbeb] px-4 py-2 mb-3 shrink-0">
                  <WifiOff className="h-4 w-4 text-[#f59e0b] shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-[#92400e]">Sin conexion al MikroTik</p>
                    <p className="text-[10px] text-[#a16207]">Mostrando solo datos locales. {ipMap.error}</p>
                  </div>
                </div>
              )}

              {/* Info bar */}
              <div className="flex items-center justify-between mb-3 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-medium text-[#475569] bg-[#f1f5f9] px-2 py-0.5 rounded-md">{subnetDisplay}</span>
                  {ipMap.connected && (
                    <span className="flex items-center gap-1 rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-medium text-[#166534]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a] animate-pulse" />
                      Conectado
                    </span>
                  )}
                  <p className="text-xs text-[#64748b]">
                    <span className="font-semibold text-[#0f172a]">{usedCount}</span> usadas
                    <span className="mx-1.5 text-[#cbd5e1]">&middot;</span>
                    <span className="font-semibold text-[#0f172a]">{freeCount}</span> libres
                    <span className="mx-1.5 text-[#cbd5e1]">&middot;</span>
                    Siguiente: <span className="font-mono font-medium text-[#006fff]">{ipMap.next_available || "--"}</span>
                  </p>
                  <div className="flex items-center gap-3 ml-2">
                    {LEGEND_ITEMS.map(item => (
                      <span key={item.type} className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />
                        <span className="text-[10px] text-[#94a3b8]">{item.label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Subnet tabs */}
              {ipMap.subnets.length > 1 && (
                <div className="flex items-center gap-1 border-b border-[#e2e8f0] mb-3 shrink-0">
                  {ipMap.subnets.map(s => {
                    const prefix = s.gateway.split(".").slice(0, 3).join(".") + ".";
                    const active = prefix === activePrefix;
                    return (
                      <button
                        key={s.network}
                        onClick={() => { setSelectedSubnet(prefix); setSelectedIp(null); }}
                        className={`relative px-3 py-2 text-xs font-medium transition-colors ${active ? "text-[#006fff]" : "text-[#64748b] hover:text-[#0f172a]"}`}
                      >
                        {s.network}
                        {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#006fff] rounded-full" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Grid area */}
              <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm flex-1 min-h-0 flex flex-col">
                <div className="flex flex-1 min-h-0 overflow-auto p-4">
                  {/* Range labels */}
                  <div className="w-[72px] shrink-0 relative mr-3" style={{ minHeight: "fit-content" }}>
                    {RANGE_LABELS.map((range) => {
                      const topPercent = (range.startRow / 16) * 100;
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

                  {/* 16x16 grid */}
                  <div className="flex-1 min-w-0">
                    <div className="w-full">
                      <div className="grid mb-1" style={{ gridTemplateColumns: "repeat(16, 1fr)", gap: "2px" }}>
                        {Array.from({ length: 16 }).map((_, i) => (
                          <div key={i} className="h-4 flex items-center justify-center text-[8px] font-mono text-[#94a3b8] font-medium">+{i}</div>
                        ))}
                      </div>
                      <div className="grid" style={{ gridTemplateColumns: "repeat(16, 1fr)", gap: "2px" }}>
                        {cells.map(({ ip, octet, entry }) => (
                          <IPCell key={octet} ip={ip} octet={octet} entry={entry} isSelected={selectedIp === ip} onClick={handleCellClick} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detail bar */}
                <div className={`border-t border-[#e2e8f0] bg-[#fafbfc] transition-all duration-200 overflow-hidden ${selectedIp ? "max-h-[120px] py-3 px-5" : "max-h-0 py-0 px-5"}`}>
                  {selectedIp && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-sm font-bold text-[#0f172a]">{selectedIp}</span>
                        {selectedDevice ? (
                          <>
                            <span className="flex items-center gap-1.5">
                              <Circle className="h-2 w-2 fill-current" style={{ color: STATUS_DOT_COLORS[selectedDevice.type] }} />
                              <span className="text-xs text-[#475569]">{statusText(selectedDevice.type)}</span>
                            </span>
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                backgroundColor: selectedDevice.type === "gateway" ? "#eff6ff" : selectedDevice.type === "node" ? "#f0fdf4" : selectedDevice.type === "node_offline" ? "#f8fafc" : selectedDevice.type === "dhcp" ? "#fffbeb" : "#faf5ff",
                                color: selectedDevice.type === "gateway" ? "#1e40af" : selectedDevice.type === "node" ? "#166534" : selectedDevice.type === "node_offline" ? "#475569" : selectedDevice.type === "dhcp" ? "#92400e" : "#6b21a8",
                              }}
                            >
                              {TYPE_LABELS[selectedDevice.type]}
                            </span>
                            <span className="text-sm font-medium text-[#0f172a]">{selectedDevice.name || "Sin nombre"}</span>
                            {selectedDevice.mac && <span className="font-mono text-xs text-[#94a3b8]">{selectedDevice.mac}</span>}
                            <span className="text-[10px] text-[#94a3b8] bg-[#f1f5f9] rounded px-1.5 py-0.5">{sourceLabel(selectedDevice.source)}</span>
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
                        {selectedDevice?.node_id && (
                          <a href={`/red/${selectedDevice.node_id}`} className="inline-flex items-center gap-1 rounded-lg border border-[#006fff]/20 bg-[#eff6ff] px-3 py-1.5 text-xs font-medium text-[#006fff] hover:bg-[#dbeafe] transition-colors">
                            <ExternalLink className="h-3 w-3" />Ver nodo
                          </a>
                        )}
                        {selectedDevice?.type === "unknown" && (
                          <button onClick={() => openAssignModal(selectedDevice.ip, selectedDevice.mac)} className="inline-flex items-center gap-1 rounded-lg bg-[#8b5cf6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#7c3aed] transition-colors">
                            <Plus className="h-3 w-3" />Agregar como nodo
                          </button>
                        )}
                        {!selectedDevice && ipToLastOctet(selectedIp) !== 0 && ipToLastOctet(selectedIp) !== 255 && (
                          <button onClick={() => openAssignModal(selectedIp)} className="inline-flex items-center gap-1 rounded-lg bg-[#006fff] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0057cc] transition-colors">
                            <Plus className="h-3 w-3" />Asignar esta IP
                          </button>
                        )}
                        <button onClick={() => setSelectedIp(null)} className="rounded-lg p-1.5 text-[#94a3b8] hover:text-[#475569] hover:bg-[#f1f5f9] transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════ TAB: DESCUBRIR ═══════════════════ */}
      {tab === "discover" && (
        <div className="flex-1 min-h-0 overflow-auto space-y-6">
          {/* Subnet input + info */}
          <div className="flex items-center gap-4">
            <p className="text-sm text-[#475569]">Escanea la red para encontrar dispositivos nuevos</p>
            <div className="flex items-center gap-2 ml-auto">
              <label className="text-xs text-[#94a3b8]">Subred:</label>
              <input type="text" value={subnet} onChange={e => setSubnet(e.target.value)} placeholder="10.10.10" className="w-32 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 font-mono text-sm text-[#0f172a] focus:border-[#006fff] focus:outline-none" />
            </div>
          </div>

          {discoverError && (
            <div className="rounded-2xl border border-[#dc2626]/30 bg-[#fef2f2] p-5">
              <div className="flex items-center gap-3"><AlertTriangle className="h-5 w-5 text-[#dc2626]" /><p className="text-sm text-[#dc2626]">{discoverError}</p></div>
            </div>
          )}

          {discoverLoading && (
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
              <Skeleton className="mb-4 h-5 w-48" />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 mb-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="mt-1 h-3 w-48" /></div>
                </div>
              ))}
            </div>
          )}

          {!discoverLoading && !discoverResult && !discoverError && (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
                <Search className="mx-auto h-12 w-12 text-[#94a3b8]" />
                <p className="mt-4 text-sm font-medium text-[#0f172a]">Presiona &quot;Escanear&quot; para buscar dispositivos</p>
                <p className="mt-2 text-xs text-[#94a3b8]">Se escaneara la subred {subnet}.1 a {subnet}.254</p>
              </div>
            </div>
          )}

          {discoverResult && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Subred escaneada</p>
                  <p className="mt-1 text-lg font-semibold font-mono">{discoverResult.subnet}.*</p>
                </div>
                <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-widest text-[#16a34a]">Dispositivos encontrados</p>
                  <p className="mt-1 text-2xl font-semibold text-[#16a34a]">{discoverResult.found}</p>
                </div>
              </div>

              {discoverResult.devices.length > 0 && (
                <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
                  <div className="border-b border-[#e2e8f0] px-6 py-4"><h2 className="text-sm font-semibold text-[#0f172a]">Dispositivos Encontrados</h2></div>
                  <div className="divide-y divide-[#e2e8f0]">
                    {discoverResult.devices.map(device => {
                      const isAdded = addedIps.has(device.ip);
                      const isAdding = adding === device.ip;
                      return (
                        <div key={device.ip} className="flex items-center gap-4 px-6 py-3.5 hover:bg-[#f8f9fb]">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f0fdf4]"><Monitor className="h-5 w-5 text-[#16a34a]" /></div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-[#0f172a] font-mono">{device.ip}</p>
                            <p className="mt-0.5 text-xs text-[#94a3b8]">{device.responsive ? "Responde a ping" : "Sin respuesta"}</p>
                          </div>
                          {isAdded ? (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-[#16a34a]"><CheckCircle className="h-4 w-4" />Agregado</span>
                          ) : (
                            <button onClick={() => handleAddNode(device)} disabled={isAdding} className="flex items-center gap-1.5 rounded-lg bg-[#006fff] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0057cc] disabled:opacity-50">
                              <Plus className="h-3.5 w-3.5" />{isAdding ? "..." : "Agregar como nodo"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {discoverResult.devices.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e2e8f0] bg-white py-16 shadow-sm">
                  <Wifi className="h-10 w-10 text-[#94a3b8]" />
                  <p className="mt-4 text-sm text-[#94a3b8]">No se encontraron dispositivos en la subred {discoverResult.subnet}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ MODALS ═══════════════════ */}

      {/* Node form modal (topology) */}
      <Modal open={showAddForm} onClose={() => { setShowAddForm(false); setEditingNode(null); }} title={isEditing ? "Editar Nodo" : "Nuevo Nodo"}>
        <form onSubmit={handleNodeSubmit} className="space-y-4">
          {formError && <div className="rounded-xl border border-[#dc2626]/30 bg-[#fef2f2] px-4 py-2.5 text-sm text-[#dc2626]">{formError}</div>}
          <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Nombre *</label><input type="text" className={inputClass} value={nodeForm.name} onChange={e => setNodeForm({ ...nodeForm, name: e.target.value })} placeholder="Ej: Base-G5" /></div>
          <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Tipo</label><select className={inputClass} value={nodeForm.type} onChange={e => setNodeForm({ ...nodeForm, type: e.target.value })}><option value="ROUTER">Router</option><option value="AP">Antena AP</option><option value="STATION">Estacion</option><option value="DISTRIBUTION">Distribucion</option><option value="CPE">Equipo Cliente</option><option value="SWITCH">Switch</option></select></div>
          <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">IP *</label><input type="text" className={inputClass} value={nodeForm.ip} onChange={e => setNodeForm({ ...nodeForm, ip: e.target.value })} placeholder="192.168.1.1" /></div>
          <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Nodo Padre</label><select className={inputClass} value={nodeForm.parentId} onChange={e => setNodeForm({ ...nodeForm, parentId: e.target.value })}><option value="">Sin padre (raiz)</option>{nodes.filter(n => !isEditing || n.id !== editingNode?.id).map(n => <option key={n.id} value={n.id}>{n.name} ({n.type})</option>)}</select></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowAddForm(false); setEditingNode(null); }} className="rounded-xl border border-[#e2e8f0] px-5 py-2.5 text-sm text-[#475569] hover:bg-[#f5f7fa]">Cancelar</button><button type="submit" disabled={saving} className="rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] disabled:opacity-50">{saving ? "Guardando..." : isEditing ? "Guardar Cambios" : "Crear Nodo"}</button></div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog open={!!deletingNode} onClose={() => setDeletingNode(null)} onConfirm={handleDeleteNode} title="Eliminar nodo" message={deletingNode ? `Estas seguro de eliminar "${deletingNode.name}"?` : ""} confirmText="Eliminar" confirmColor="red" loading={deleting} />

      {/* Assign IP modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowAssignModal(false)}>
          <div className="w-full max-w-md rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold text-[#0f172a]">Asignar IP</h3>
                <p className="text-xs text-[#94a3b8] mt-0.5">Agregar un nuevo dispositivo a la red</p>
              </div>
              <button onClick={() => setShowAssignModal(false)} className="rounded-lg p-1.5 text-[#94a3b8] hover:text-[#475569] hover:bg-[#f1f5f9] transition-colors"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1.5">Direccion IP</label>
                <input type="text" value={assignIp} onChange={e => setAssignIp(e.target.value)} placeholder={ipMap?.next_available || "192.168.1.202"} className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm font-mono text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1.5">Nombre del dispositivo</label>
                <input type="text" value={assignName} onChange={e => setAssignName(e.target.value)} placeholder="AP-Cerro-Norte" className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10 transition-all placeholder:text-[#94a3b8]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1.5">Tipo de dispositivo</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: "CPE", icon: Monitor, label: "CPE" },
                    { value: "AP", icon: Radio, label: "AP" },
                    { value: "BRIDGE", icon: NetworkIcon, label: "Bridge" },
                    { value: "SWITCH", icon: Server, label: "Switch" },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setAssignType(opt.value)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition-all ${assignType === opt.value ? "border-[#006fff] bg-[#eff6ff] text-[#006fff] ring-1 ring-[#006fff]/20" : "border-[#e2e8f0] bg-white text-[#475569] hover:border-[#cbd5e1] hover:bg-[#f8fafc]"}`}
                    >
                      <opt.icon className="h-5 w-5" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1.5">MAC (opcional)</label>
                <input type="text" value={assignMac} onChange={e => setAssignMac(e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm font-mono focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10 transition-all placeholder:text-[#94a3b8]" />
              </div>
              {assignError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-[#dc2626] shrink-0 mt-0.5" />
                  <p className="text-xs text-[#dc2626]">{assignError}</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowAssignModal(false)} className="flex-1 rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] hover:bg-[#f8fafc] transition-colors">Cancelar</button>
                <button onClick={handleAssign} disabled={!assignIp || !assignName || assigning} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#0057cc] disabled:opacity-40 transition-colors">
                  {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Asignar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className={`flex items-center gap-3 rounded-xl border px-5 py-3.5 shadow-lg ${toast.type === "success" ? "border-[#16a34a]/30 bg-[#f0fdf4] text-[#16a34a]" : "border-[#f59e0b]/30 bg-[#fffbeb] text-[#b45309]"}`}>
            {toast.type === "success" ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            <p className="text-sm font-medium">{toast.message}</p>
            <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">&times;</button>
          </div>
        </div>
      )}
    </div>
  );
}
