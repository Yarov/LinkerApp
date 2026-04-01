import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Shield, Wifi, WifiOff, RefreshCw, Settings, AlertTriangle, Check, Activity } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Skeleton from "@/components/Skeleton";

// Rust get_vpn_status returns: { connected, localIp, interface, latency }
interface VpnStatus { connected: boolean; interface: string | null; localIp: string | null; latency?: number | null; }

export default function VPNPage() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [connectionState, setConnectionState] = useState<"connected"|"disconnected"|"connecting"|"disconnecting"|"error">("disconnected");
  const [statusLoading, setStatusLoading] = useState(true);
  const [noConfig, setNoConfig] = useState(false);
  const [errorMessage, setErrorMessage] = useState(""); const [successMessage, setSuccessMessage] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      // Rust command is `get_vpn_status`
      const data = await invoke<VpnStatus>("get_vpn_status");
      setStatus(data);
      setConnectionState(data.connected ? "connected" : "disconnected");
    } catch {
      setConnectionState("error");
    } finally { setStatusLoading(false); }
  }, []);
  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleConnect = async () => {
    setConnectionState("connecting"); setErrorMessage("");
    try {
      // Rust command is `connect_vpn`
      const data = await invoke<{success:boolean;message?:string}>("connect_vpn");
      if (data.success) {
        setSuccessMessage(data.message ?? "VPN conectada");
        setTimeout(() => setSuccessMessage(""), 4000);
        setTimeout(fetchStatus, 1500);
      } else {
        setConnectionState("error");
        setErrorMessage("Error al conectar");
      }
    } catch (err) {
      setConnectionState("error");
      setErrorMessage(String(err));
    }
  };

  const handleDisconnect = async () => {
    setConnectionState("disconnecting");
    try {
      // Rust command is `disconnect_vpn`
      await invoke("disconnect_vpn");
      setConnectionState("disconnected");
      setStatus(prev => prev ? { ...prev, connected: false } : prev);
    } catch (err) {
      setConnectionState("connected");
      setErrorMessage(String(err));
    }
  };

  const isConnected = connectionState === "connected";
  const isTransitioning = connectionState === "connecting" || connectionState === "disconnecting";

  if (statusLoading) return <div className="py-20"><Skeleton className="mx-auto h-20 w-20 !rounded-full" /></div>;
  if (noConfig) return (<div className="flex min-h-[60vh] items-center justify-center"><div className="max-w-md rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm"><Shield className="mx-auto h-8 w-8 text-[#006fff]" /><h2 className="mt-4 text-xl font-bold text-[#0f172a]">VPN no configurada</h2><Link to="/vpn/setup" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white">Configurar VPN</Link></div></div>);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-[#0f172a]">VPN WireGuard</h1><p className="mt-1 text-sm text-[#475569]">Administra tu conexion VPN</p></div><Link to="/vpn/setup" className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm text-[#475569] hover:bg-[#f5f7fa]"><Settings className="h-4 w-4" />Asistente</Link></div>
      {errorMessage && <div className="flex items-start gap-3 rounded-2xl border border-[#dc2626]/20 bg-[#fef2f2] px-5 py-4 text-sm text-[#dc2626]"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><p>{errorMessage}</p></div>}
      {successMessage && <div className="flex items-center gap-3 rounded-2xl border border-[#16a34a]/20 bg-[#f0fdf4] px-5 py-4 text-sm text-[#16a34a]"><Check className="h-4 w-4" />{successMessage}</div>}
      <div className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm ${isConnected ? "border-[#16a34a]/30" : "border-[#e2e8f0]"}`}>
        <div className={`h-1 ${isConnected ? "bg-gradient-to-r from-[#16a34a] to-[#22c55e]" : "bg-gradient-to-r from-[#94a3b8] to-[#cbd5e1]"}`} />
        <div className="px-8 py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-6">
              <div className="relative shrink-0"><div className={`flex h-20 w-20 items-center justify-center rounded-full ${isConnected ? "bg-[#f0fdf4]" : "bg-[#fef2f2]"}`}><div className={`h-10 w-10 rounded-full ${isConnected ? "bg-[#16a34a] shadow-lg shadow-[#16a34a]/30" : isTransitioning ? "bg-[#006fff] animate-pulse" : "bg-[#dc2626]"}`} /></div></div>
              <div><h2 className="text-xl font-bold text-[#0f172a]">{isConnected ? "VPN Conectada" : connectionState === "connecting" ? "Conectando..." : "VPN Desconectada"}</h2>
                {isConnected && status && <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2"><div className="flex items-center gap-2 text-sm"><span className="text-[#475569]">IP Local:</span><span className="font-mono font-medium text-[#0f172a]">{status.localIp || "10.10.10.2"}</span></div>{status.latency != null && <div className="flex items-center gap-2 text-sm"><span className="text-[#475569]">Latencia:</span><span className="font-medium text-[#0f172a]">{status.latency}ms</span></div>}</div>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {isConnected ? <>
                <button onClick={handleDisconnect} disabled={isTransitioning} className="inline-flex items-center gap-2 rounded-xl bg-[#dc2626] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#b91c1c] disabled:opacity-50"><WifiOff className="h-4 w-4" />Desconectar</button>
              </> : <button onClick={handleConnect} disabled={isTransitioning} className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-8 py-3 text-base font-semibold text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#005ce6] disabled:opacity-50">{isTransitioning ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Wifi className="h-5 w-5" />}{connectionState === "connecting" ? "Conectando..." : "Conectar VPN"}</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
