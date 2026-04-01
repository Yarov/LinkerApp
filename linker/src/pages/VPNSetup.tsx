import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Server, Network, Key, Wifi, ChevronRight, ChevronLeft, Shield, AlertTriangle } from "lucide-react";

export default function VPNSetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [vpsIp, setVpsIp] = useState(""); const [vpsPort, setVpsPort] = useState("13231"); const [vpsPeerKey, setVpsPeerKey] = useState("");
  const [localAddress, setLocalAddress] = useState("10.10.10.2/24");
  const inputClass = "w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10";

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4">
      <div className="text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#eff6ff]"><Shield className="h-8 w-8 text-[#006fff]" /></div><h1 className="text-2xl font-bold text-[#0f172a]">Configuracion de VPN</h1><p className="mt-1 text-sm text-[#475569]">Configura tu conexion WireGuard</p></div>
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 shadow-sm">
        {step === 0 && <div className="space-y-6"><h2 className="text-lg font-semibold text-[#0f172a]">Servidor VPN</h2><div className="space-y-4"><div><label className="mb-1.5 block text-sm font-medium text-[#475569]">IP del VPS</label><input type="text" value={vpsIp} onChange={e => setVpsIp(e.target.value)} placeholder="84.46.246.220" className={inputClass} /></div><div><label className="mb-1.5 block text-sm font-medium text-[#475569]">Puerto</label><input type="text" value={vpsPort} onChange={e => setVpsPort(e.target.value)} className={inputClass} /></div><div><label className="mb-1.5 block text-sm font-medium text-[#475569]">Llave publica del VPS</label><input type="text" value={vpsPeerKey} onChange={e => setVpsPeerKey(e.target.value)} className={inputClass} /></div></div></div>}
        {step === 1 && <div className="space-y-6"><h2 className="text-lg font-semibold text-[#0f172a]">Direcciones</h2><div><label className="mb-1.5 block text-sm font-medium text-[#475569]">Tu direccion local</label><input type="text" value={localAddress} onChange={e => setLocalAddress(e.target.value)} className={inputClass} /></div></div>}
        {step === 2 && <div className="space-y-6 text-center">
          <h2 className="text-lg font-semibold text-[#0f172a]">Informacion</h2>
          <p className="text-sm text-[#475569]">Servidor: {vpsIp}:{vpsPort}</p>
          <p className="text-sm text-[#475569]">Direccion local: {localAddress}</p>
          <div className="rounded-xl border border-[#f59e0b]/20 bg-[#fffbeb] px-4 py-3 text-sm text-[#b45309]">
            La configuracion automatica de VPN sera disponible en una proxima actualizacion. Por ahora, configura el archivo wg-ameca.conf manualmente con estos datos y usa la pagina VPN para conectar/desconectar.
          </div>
          <button onClick={() => navigate("/vpn")} className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-8 py-3 text-base font-semibold text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#005ce6]"><Wifi className="h-5 w-5" />Ir a VPN</button>
        </div>}
        <div className="mt-8 flex items-center justify-between border-t border-[#e2e8f0] pt-6">
          <button onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0} className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#475569] disabled:invisible"><ChevronLeft className="h-4 w-4" />Anterior</button>
          {step < 2 ? <button onClick={() => setStep(step + 1)} className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white">Siguiente<ChevronRight className="h-4 w-4" /></button> : null}
        </div>
      </div>
    </div>
  );
}
