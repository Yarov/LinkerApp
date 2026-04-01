import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Wifi, AlertTriangle, RefreshCw, Signal, Radio, Activity, Cpu, HardDrive, Clock, Users } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import StatusBadge from "@/components/StatusBadge";
import Skeleton from "@/components/Skeleton";

// Rust get_node_status returns { node: { id, name, type, ip, status, last_seen }, connected_clients: number }
interface RawNodeStatus {
  node: {
    id: string;
    name: string;
    type: string;
    ip: string | null;
    status: string;
    last_seen: string | null;
  };
  connected_clients: number;
}

// Rust list_nodes returns { nodes: [...] }
interface RawNode {
  id: string;
  name: string;
  type: string;
  ip: string | null;
  status: string;
  last_seen: string | null;
  parent_id: string | null;
}

export default function NodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [node, setNode] = useState<RawNode | null>(null);
  const [connectedClients, setConnectedClients] = useState(0);
  const [childNodes, setChildNodes] = useState<RawNode[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = () => {
    const isRefresh = !loading; if (isRefresh) setRefreshing(true);
    Promise.all([
      invoke<RawNodeStatus>("get_node_status", { id }).catch(() => null),
      invoke<{ nodes: RawNode[] }>("list_nodes").catch(() => ({ nodes: [] })),
    ]).then(([statusData, nodesData]) => {
      if (statusData?.node) {
        setNode(statusData.node as RawNode);
        setConnectedClients(statusData.connected_clients ?? 0);
      } else {
        // Fallback: find node from list
        const found = (nodesData?.nodes ?? []).find(n => n.id === id);
        if (found) setNode(found);
        else setError("Nodo no encontrado");
      }
      // Find child nodes
      const children = (nodesData?.nodes ?? []).filter(n => n.parent_id === id);
      setChildNodes(children);
      setLoading(false); setRefreshing(false);
    }).catch(err => { setError(String(err)); setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { fetchData(); }, [id]);

  if (loading) return (<div className="space-y-6"><Skeleton className="h-4 w-24" /><div className="flex items-start justify-between"><Skeleton className="h-12 w-12 rounded-2xl" /><div><Skeleton className="h-7 w-36" /></div></div></div>);
  if (error || !node) return (<div className="flex flex-col items-center justify-center py-20"><div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm"><AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" /><p className="mt-4 text-sm text-[#dc2626]">{error || "Nodo no encontrado"}</p><Link to="/red" className="mt-4 inline-block text-sm text-[#006fff]">Volver a Red</Link></div></div>);

  const isOnline = (node.status ?? "").toUpperCase() === "ONLINE";

  return (
    <div className="space-y-6">
      <Link to="/red" className="inline-flex items-center gap-2 text-sm text-[#475569] hover:text-[#0f172a]"><ArrowLeft className="h-4 w-4" />Volver a Red</Link>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${isOnline ? "bg-[#f0fdf4]" : "bg-[#fef2f2]"}`}><Radio className={`h-6 w-6 ${isOnline ? "text-[#16a34a]" : "text-[#dc2626]"}`} /></div>
          <div><h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">{node.name}</h1><div className="mt-1 flex items-center gap-2"><span className="rounded-md bg-[#f5f7fa] px-2.5 py-0.5 text-[10px] font-medium uppercase text-[#475569] border border-[#e2e8f0]">{node.type}</span><span className="font-mono text-sm text-[#94a3b8]">{node.ip ?? "-"}</span></div></div>
        </div>
        <div className="flex items-center gap-3"><button onClick={fetchData} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] px-4 py-2 text-sm text-[#475569] hover:bg-[#f5f7fa] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Actualizar</button><StatusBadge status={node.status ?? "unknown"} /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]"><Users className="h-3.5 w-3.5" />Clientes conectados</div><p className="mt-3 text-2xl font-bold text-[#0f172a]">{connectedClients}</p></div>
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]"><Activity className="h-3.5 w-3.5" />Estado</div><p className="mt-3 text-lg font-bold text-[#0f172a]">{isOnline ? "En linea" : "Fuera de linea"}</p></div>
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]"><Clock className="h-3.5 w-3.5" />Ultima vez visto</div><p className="mt-3 text-sm font-medium text-[#0f172a]">{node.last_seen ? new Date(node.last_seen).toLocaleString("es-MX") : "N/A"}</p></div>
      </div>
      {childNodes.length > 0 && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-[#0f172a]">Nodos Hijos ({childNodes.length})</h3>
          <div className="space-y-1.5">{childNodes.map(child => (<Link key={child.id} to={`/red/${child.id}`} className="flex items-center justify-between rounded-xl px-4 py-3 hover:bg-[#f8f9fb]"><div className="flex items-center gap-3"><div className={`h-2.5 w-2.5 rounded-full ${(child.status??"").toUpperCase()==="ONLINE"?"bg-[#16a34a] status-dot-online":"bg-[#dc2626]"}`} /><span className="text-sm font-medium text-[#0f172a]">{child.name}</span><span className="rounded-md bg-[#f5f7fa] px-2 py-0.5 text-[10px] font-medium uppercase text-[#475569] border border-[#e2e8f0]">{child.type}</span></div><span className="font-mono text-xs text-[#94a3b8]">{child.ip ?? "-"}</span></Link>))}</div>
        </div>
      )}
    </div>
  );
}
