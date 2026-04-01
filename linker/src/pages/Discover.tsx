import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, Plus, Wifi, AlertTriangle, CheckCircle, Monitor } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Skeleton from "@/components/Skeleton";

// Rust discover_devices returns: { subnet, found, devices: [{ ip, responsive }] }
interface DiscoveredDevice { ip: string; responsive: boolean; }
interface DiscoverResult { subnet: string; found: number; devices: DiscoveredDevice[]; }

export default function DiscoverPage() {
  const navigate = useNavigate();
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [subnet, setSubnet] = useState("10.10.10");
  const [adding, setAdding] = useState<string | null>(null); const [addedIps, setAddedIps] = useState<Set<string>>(new Set());

  const handleScan = async () => {
    setLoading(true); setError(""); setResult(null);
    try {
      const data = await invoke<DiscoverResult>("discover_devices", { subnet: subnet || undefined });
      setResult(data);
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  };

  const handleAddNode = async (device: DiscoveredDevice) => {
    setAdding(device.ip);
    try {
      // Rust create_node expects flat params
      await invoke("create_node", {
        name: `Dispositivo ${device.ip}`,
        nodeType: "CPE",
        ip: device.ip,
        mac: null,
        model: null,
        firmware: null,
        latitude: null,
        longitude: null,
        parentId: null,
      });
      setAddedIps(prev => new Set(prev).add(device.ip));
    } catch (err) { alert(String(err)); } finally { setAdding(null); }
  };

  const inputClass = "w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/red")} className="rounded-xl border border-[#e2e8f0] p-2 text-[#475569] hover:bg-[#f5f7fa]"><ArrowLeft className="h-5 w-5" /></button>
          <div><h1 className="text-2xl font-semibold text-[#0f172a]">Descubrir Dispositivos</h1><p className="mt-1 text-sm text-[#475569]">Escanea la red para encontrar dispositivos nuevos</p></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#94a3b8]">Subred:</label>
            <input type="text" value={subnet} onChange={e => setSubnet(e.target.value)} placeholder="10.10.10" className="w-32 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 font-mono text-sm text-[#0f172a] focus:border-[#006fff] focus:outline-none" />
          </div>
          <button onClick={handleScan} disabled={loading} className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc] disabled:opacity-50"><Search className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{loading ? "Escaneando..." : "Escanear Red"}</button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-[#dc2626]/30 bg-[#fef2f2] p-5"><div className="flex items-center gap-3"><AlertTriangle className="h-5 w-5 text-[#dc2626]" /><p className="text-sm text-[#dc2626]">{error}</p></div></div>}

      {loading && <div className="space-y-6"><div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm"><Skeleton className="mb-4 h-5 w-48" />{Array.from({length:4}).map((_,i)=><div key={i} className="flex items-center gap-4 mb-3"><Skeleton className="h-10 w-10 rounded-lg" /><div className="flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="mt-1 h-3 w-48" /></div></div>)}</div></div>}

      {!loading && !result && !error && <div className="flex flex-col items-center justify-center py-20"><div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm"><Search className="mx-auto h-12 w-12 text-[#94a3b8]" /><p className="mt-4 text-sm font-medium text-[#0f172a]">Presiona &quot;Escanear Red&quot; para buscar dispositivos</p><p className="mt-2 text-xs text-[#94a3b8]">Se escaneara la subred {subnet}.1 a {subnet}.254</p></div></div>}

      {result && <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Subred escaneada</p><p className="mt-1 text-lg font-semibold font-mono">{result.subnet}.*</p></div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"><p className="text-xs font-medium uppercase tracking-widest text-[#16a34a]">Dispositivos encontrados</p><p className="mt-1 text-2xl font-semibold text-[#16a34a]">{result.found}</p></div>
        </div>

        {result.devices.length > 0 && <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
          <div className="border-b border-[#e2e8f0] px-6 py-4"><h2 className="text-sm font-semibold text-[#0f172a]">Dispositivos Encontrados</h2></div>
          <div className="divide-y divide-[#e2e8f0]">{result.devices.map(device => {
            const isAdded = addedIps.has(device.ip); const isAdding = adding === device.ip;
            return (<div key={device.ip} className="flex items-center gap-4 px-6 py-3.5 hover:bg-[#f8f9fb]">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f0fdf4]"><Monitor className="h-5 w-5 text-[#16a34a]" /></div>
              <div className="flex-1"><p className="text-sm font-medium text-[#0f172a] font-mono">{device.ip}</p><p className="mt-0.5 text-xs text-[#94a3b8]">{device.responsive ? "Responde a ping" : "Sin respuesta"}</p></div>
              {isAdded ? <span className="flex items-center gap-1.5 text-xs font-medium text-[#16a34a]"><CheckCircle className="h-4 w-4" />Agregado</span> : <button onClick={() => handleAddNode(device)} disabled={isAdding} className="flex items-center gap-1.5 rounded-lg bg-[#006fff] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0057cc] disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{isAdding ? "..." : "Agregar como nodo"}</button>}
            </div>);
          })}</div>
        </div>}

        {result.devices.length === 0 && <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e2e8f0] bg-white py-16 shadow-sm"><Wifi className="h-10 w-10 text-[#94a3b8]" /><p className="mt-4 text-sm text-[#94a3b8]">No se encontraron dispositivos en la subred {result.subnet}</p></div>}
      </div>}
    </div>
  );
}
