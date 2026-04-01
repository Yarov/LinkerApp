import { useState, useEffect, memo } from "react";
import { WifiOff, RefreshCw, X, Shield } from "lucide-react";
import { useMikrotikStore } from "@/stores/useMikrotikStore";

export default memo(function ConnectionBanner() {
  const connected = useMikrotikStore(s => s.connected);
  const checking = useMikrotikStore(s => s.checking);
  const retry = useMikrotikStore(s => s.retry);
  const vpnConnected = useMikrotikStore(s => s.vpnConnected);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!connected || !vpnConnected) setDismissed(false);
  }, [connected, vpnConnected]);

  if ((connected && vpnConnected) || dismissed) return null;

  const messages: string[] = [];
  if (!vpnConnected) messages.push("VPN desconectada");
  if (!connected) messages.push("Sin conexion a MikroTik");

  return (
    <div className="sticky top-0 z-50 flex items-center gap-3 border-b border-[#f59e0b]/30 bg-[#fffbeb] px-5 py-2.5">
      {!connected ? <WifiOff className="h-4 w-4 shrink-0 text-[#b45309]" /> : <Shield className="h-4 w-4 shrink-0 text-[#b45309]" />}
      <p className="flex-1 text-sm text-[#b45309]">
        {messages.join(". ")}. {!connected ? "Las funciones de red estan deshabilitadas. Solo lectura." : "Conecta la VPN para acceso remoto."}
      </p>
      <button onClick={retry} disabled={checking} className="flex items-center gap-1.5 rounded-lg border border-[#f59e0b]/30 bg-white px-3 py-1 text-xs font-medium text-[#b45309] transition-colors hover:bg-[#fef3c7] disabled:opacity-50">
        <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
        Reintentar
      </button>
      <button onClick={() => setDismissed(true)} className="rounded-lg p-1 text-[#b45309]/60 transition-colors hover:bg-[#fef3c7] hover:text-[#b45309]">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
