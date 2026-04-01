import { useState, useEffect, useRef } from "react";
import { Server, Cpu, HardDrive, Clock, AlertTriangle, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Skeleton from "@/components/Skeleton";
import { useMikrotikStore } from "@/stores/useMikrotikStore";

interface SystemStatus { uptime: string; version: string; board: string; cpu: string; memory: string; freeMemory: string; totalMemory: string; }
interface PPPoESession { name: string; address: string; uptime: string; service: string; "caller-id": string; [key: string]: unknown; }

export default function MikroTikPage() {
  const mikrotikConnected = useMikrotikStore(s => s.connected);
  const retryConnection = useMikrotikStore(s => s.retry);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [pppoeList, setPppoeList] = useState<PPPoESession[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = (isManual?: boolean) => {
    if (isManual) setRefreshing(true);
    Promise.all([
      invoke<Record<string, unknown>>("get_system_status").catch(() => ({ connected: false, resource: null })),
      invoke<Record<string, unknown>>("get_pppoe_sessions").catch(() => ({ sessions: [], count: 0 })),
    ]).then(([statusData, pppoeData]) => {
      // Parse system status from get_system_status response
      if (statusData?.connected && statusData.resource) {
        const res = statusData.resource as Record<string, string>;
        const free = parseInt(res["free-memory"] ?? "0", 10);
        const total = parseInt(res["total-memory"] ?? "1", 10);
        const memPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
        setSystemStatus({
          uptime: res["uptime"] ?? "-",
          version: res["version"] ?? "-",
          board: res["board-name"] ?? "-",
          cpu: res["cpu-load"] ?? "0",
          memory: String(memPercent),
          freeMemory: free > 1048576 ? `${Math.round(free / 1048576)}MB` : "-",
          totalMemory: total > 1048576 ? `${Math.round(total / 1048576)}MB` : "-",
        });
      } else {
        setSystemStatus(null);
      }

      // Parse PPPoE sessions from get_pppoe_sessions response
      const sessions = (pppoeData?.sessions ?? []) as PPPoESession[];
      setPppoeList(Array.isArray(sessions) ? sessions : []);
      setLoading(false); setRefreshing(false);
    }).catch(err => { setError(String(err)); setLoading(false); setRefreshing(false); });
  };

  useEffect(() => {
    // Delay data fetch to allow skeleton to render first
    fetchData();
      intervalRef.current = setInterval(() => fetchData(), 30000);
    
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const cpuNum = parseInt((systemStatus?.cpu ?? "0").replace("%", "")) || 0;
  const memNum = parseInt((systemStatus?.memory ?? "0").replace("%", "")) || 0;

  if (loading) return (<div className="space-y-6"><div className="flex items-center justify-between"><div><Skeleton className="h-7 w-28" /><Skeleton className="mt-2 h-4 w-52" /></div></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({length:4}).map((_,i)=><div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-7 w-16" /></div>)}</div></div>);
  if (error) return (<div className="flex flex-col items-center justify-center py-20"><div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm"><AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" /><p className="mt-4 text-sm text-[#dc2626]">{error}</p><button onClick={() => { setError(""); setLoading(true); fetchData(); }} className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white">Reintentar</button></div></div>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold text-[#0f172a]">MikroTik</h1><p className="mt-1 text-sm text-[#475569]">{systemStatus ? `RouterOS ${systemStatus.version} \u2014 Uptime: ${systemStatus.uptime}` : "Administracion del router"}</p></div><div className="flex items-center gap-3"><div className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs text-[#94a3b8]"><div className="h-1.5 w-1.5 rounded-full bg-[#16a34a] status-dot-online" />Auto-refresco 30s</div><button onClick={() => { if (!mikrotikConnected) retryConnection(); fetchData(true); }} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] px-4 py-2 text-sm text-[#475569] hover:bg-[#f5f7fa] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />{mikrotikConnected ? "Actualizar" : "Reintentar"}</button></div></div>
      {!mikrotikConnected && !systemStatus && <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e2e8f0] bg-white py-16 shadow-sm"><WifiOff className="h-12 w-12 text-[#f59e0b]" /><h2 className="mt-5 text-lg font-semibold text-[#0f172a]">Sin conexion a MikroTik</h2><p className="mt-2 text-sm text-[#94a3b8]">No se puede conectar al router.</p></div>}
      {systemStatus && <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><div className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#006fff] to-transparent" /><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">CPU</p><p className="mt-2 text-2xl font-bold text-[#0f172a]">{systemStatus.cpu}%</p></div><div className="rounded-xl bg-[#eff6ff] p-3"><Cpu className="h-6 w-6 text-[#006fff]" /></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e2e8f0]"><div className={`h-full rounded-full ${cpuNum > 80 ? "bg-[#dc2626]" : cpuNum > 50 ? "bg-[#f59e0b]" : "bg-[#006fff]"}`} style={{width:`${cpuNum}%`}} /></div></div>
        <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><div className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#7c4dff] to-transparent" /><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Memoria</p><p className="mt-2 text-2xl font-bold text-[#0f172a]">{systemStatus.memory}%</p></div><div className="rounded-xl bg-[#f5f3ff] p-3"><HardDrive className="h-6 w-6 text-[#7c4dff]" /></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e2e8f0]"><div className={`h-full rounded-full ${memNum > 80 ? "bg-[#dc2626]" : memNum > 50 ? "bg-[#f59e0b]" : "bg-[#7c4dff]"}`} style={{width:`${memNum}%`}} /></div><p className="mt-2 text-xs text-[#94a3b8]">{systemStatus.freeMemory} libre de {systemStatus.totalMemory}</p></div>
        <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><div className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#16a34a] to-transparent" /><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Uptime</p><p className="mt-2 text-lg font-bold text-[#0f172a]">{systemStatus.uptime}</p></div><div className="rounded-xl bg-[#f0fdf4] p-3"><Clock className="h-6 w-6 text-[#16a34a]" /></div></div></div>
        <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><div className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#00bcd4] to-transparent" /><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Version</p><p className="mt-2 text-lg font-bold text-[#0f172a]">{systemStatus.version}</p></div><div className="rounded-xl bg-[#ecfeff] p-3"><Server className="h-6 w-6 text-[#00bcd4]" /></div></div></div>
      </div>}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-4"><div className="flex items-center gap-2"><Wifi className="h-4 w-4 text-[#006fff]" /><h2 className="text-base font-semibold text-[#0f172a]">Sesiones PPPoE Activas</h2><span className="rounded-lg bg-[#eff6ff] px-2.5 py-0.5 text-xs font-bold text-[#006fff]">{pppoeList.length}</span></div></div>
        <table className="w-full text-left text-sm"><thead><tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]"><th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Usuario</th><th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">IP</th><th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Uptime</th><th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Servicio</th><th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">MAC</th></tr></thead>
        <tbody>{pppoeList.length === 0 ? <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-[#94a3b8]">No hay sesiones PPPoE activas</td></tr> : pppoeList.map((s, idx) => {
          const name = (s.name ?? s["name"] ?? "-") as string;
          const address = (s.address ?? s["address"] ?? "-") as string;
          const uptime = (s.uptime ?? s["uptime"] ?? "-") as string;
          const service = (s.service ?? s["service"] ?? "-") as string;
          const callerId = (s["caller-id"] ?? s.callerId ?? "-") as string;
          return (
            <tr key={`${name}-${idx}`} className={`hover:bg-[#f8f9fb] ${idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"}`}><td className="px-5 py-3 font-medium text-[#0f172a]">{name}</td><td className="px-5 py-3 font-mono text-xs text-[#475569]">{address}</td><td className="px-5 py-3 text-[#475569]">{uptime}</td><td className="px-5 py-3"><span className="rounded-md bg-[#f5f7fa] px-2.5 py-1 text-[10px] font-medium text-[#475569] border border-[#e2e8f0]">{service}</span></td><td className="px-5 py-3 font-mono text-xs text-[#94a3b8]">{callerId}</td></tr>
          );
        })}</tbody></table>
      </div>
    </div>
  );
}
