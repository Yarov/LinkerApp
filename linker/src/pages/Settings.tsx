import { useState, useEffect, useCallback } from "react";
import { Server, Key, Database, Eye, EyeOff, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Skeleton from "@/components/Skeleton";
import { useMikrotikStore } from "@/stores/useMikrotikStore";

interface DashboardData {
  total_clients: number;
  total_nodes: number;
  total_plans: number;
  unread_alerts: number;
}

export default function ConfiguracionPage() {
  const retryMikrotik = useMikrotikStore(s => s.retry);
  const [counts, setCounts] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // MikroTik connection settings
  const [mkHost, setMkHost] = useState(""); const [mkPort, setMkPort] = useState("8728");
  const [mkUser, setMkUser] = useState(""); const [mkPassword, setMkPassword] = useState("");
  const [mkShowPassword, setMkShowPassword] = useState(false);
  const [mkMessage, setMkMessage] = useState<{type:"success"|"error";text:string}|null>(null);
  const [mkSaving, setMkSaving] = useState(false);

  // Admin password
  const [adminUser, setAdminUser] = useState(""); const [adminPassword, setAdminPassword] = useState("");
  const [adminMessage, setAdminMessage] = useState<{type:"success"|"error";text:string}|null>(null);
  const [adminSaving, setAdminSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashData, settingsData] = await Promise.all([
        invoke<DashboardData>("get_dashboard"),
        invoke<{ settings: Record<string, string> }>("get_settings"),
      ]);
      setCounts(dashData);
      const s = settingsData?.settings ?? {};
      setMkHost(s["mikrotik_host"] ?? "");
      setMkPort(s["mikrotik_port"] ?? "8728");
      setMkUser(s["mikrotik_user"] ?? "");
      setMkPassword(s["mikrotik_password"] ?? "");
      setAdminUser(s["admin_user"] ?? "");
      setAdminPassword(s["admin_password"] ?? "");
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const saveMikrotik = async () => {
    setMkSaving(true); setMkMessage(null);
    try {
      await invoke("save_settings", {
        settings: {
          mikrotik_host: mkHost,
          mikrotik_port: mkPort,
          mikrotik_user: mkUser,
          mikrotik_password: mkPassword,
        },
      });
      setMkMessage({ type: "success", text: "Configuracion de MikroTik guardada" });
      // Trigger MikroTik health re-check
      retryMikrotik();
    } catch (err) {
      setMkMessage({ type: "error", text: String(err) });
    } finally { setMkSaving(false); }
  };

  const saveAdmin = async () => {
    setAdminSaving(true); setAdminMessage(null);
    try {
      if (!adminUser || !adminPassword) {
        setAdminMessage({ type: "error", text: "Usuario y contrasena son obligatorios" });
        return;
      }
      await invoke("save_settings", {
        settings: {
          admin_user: adminUser,
          admin_password: adminPassword,
        },
      });
      setAdminMessage({ type: "success", text: "Credenciales de admin actualizadas" });
    } catch (err) {
      setAdminMessage({ type: "error", text: String(err) });
    } finally { setAdminSaving(false); }
  };

  const inputClass = "w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10";

  if (loading) return <div className="space-y-6"><Skeleton className="h-7 w-40" />{Array.from({length:3}).map((_,i)=><div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm"><Skeleton className="h-5 w-36" /><Skeleton className="mt-4 h-20 w-full" /></div>)}</div>;

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-[#0f172a]">Configuracion</h1><p className="mt-1 text-sm text-[#475569]">Ajustes del sistema</p></div>

      {/* System info */}
      {counts && <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4"><div className="rounded-xl bg-[#eff6ff] p-2.5"><Database className="h-5 w-5 text-[#006fff]" /></div><h2 className="text-base font-semibold text-[#0f172a]">Sistema</h2></div>
        <div className="space-y-2">
          {[
            ["Version", "Linker v1.0"],
            ["Base de datos", "SQLite"],
            ["Nodos", String(counts.total_nodes ?? 0)],
            ["Clientes", String(counts.total_clients ?? 0)],
            ["Planes", String(counts.total_plans ?? 0)],
            ["Alertas sin leer", String(counts.unread_alerts ?? 0)],
          ].map(([label, value]) => <div key={label} className="flex items-center justify-between py-2"><span className="text-sm text-[#475569]">{label}</span><span className="text-sm font-medium text-[#0f172a]">{value}</span></div>)}
        </div>
      </div>}

      {/* MikroTik connection */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4"><div className="rounded-xl bg-[#eff6ff] p-2.5"><Server className="h-5 w-5 text-[#006fff]" /></div><h2 className="text-base font-semibold text-[#0f172a]">Conexion MikroTik</h2></div>
        {mkMessage && <div className={`mb-4 rounded-xl border px-4 py-2.5 text-sm ${mkMessage.type === "success" ? "border-[#16a34a]/30 bg-[#f0fdf4] text-[#16a34a]" : "border-[#dc2626]/30 bg-[#fef2f2] text-[#dc2626]"}`}>{mkMessage.text}</div>}
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2"><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Host / IP</label><input type="text" className={inputClass} value={mkHost} onChange={e => setMkHost(e.target.value)} placeholder="10.10.10.1" /></div>
            <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Puerto</label><input type="text" className={inputClass} value={mkPort} onChange={e => setMkPort(e.target.value)} placeholder="8728" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Usuario</label><input type="text" className={inputClass} value={mkUser} onChange={e => setMkUser(e.target.value)} placeholder="admin" /></div>
            <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Contrasena</label><div className="relative"><input type={mkShowPassword ? "text" : "password"} className={inputClass + " pr-10"} value={mkPassword} onChange={e => setMkPassword(e.target.value)} placeholder="Contrasena del MikroTik" /><button type="button" onClick={() => setMkShowPassword(!mkShowPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#475569]">{mkShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
          </div>
          <div className="flex justify-end"><button onClick={saveMikrotik} disabled={mkSaving} className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] disabled:opacity-50">{mkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{mkSaving ? "Guardando..." : "Guardar"}</button></div>
        </div>
      </div>

      {/* Admin password */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4"><div className="rounded-xl bg-[#fef2f2] p-2.5"><Key className="h-5 w-5 text-[#dc2626]" /></div><h2 className="text-base font-semibold text-[#0f172a]">Credenciales de Administrador</h2></div>
        {adminMessage && <div className={`mb-4 rounded-xl border px-4 py-2.5 text-sm ${adminMessage.type === "success" ? "border-[#16a34a]/30 bg-[#f0fdf4] text-[#16a34a]" : "border-[#dc2626]/30 bg-[#fef2f2] text-[#dc2626]"}`}>{adminMessage.text}</div>}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Usuario admin</label><input type="text" className={inputClass} value={adminUser} onChange={e => setAdminUser(e.target.value)} placeholder="admin" /></div>
            <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Contrasena admin</label><input type="password" className={inputClass} value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Nueva contrasena" /></div>
          </div>
          <div className="flex justify-end"><button onClick={saveAdmin} disabled={adminSaving} className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] disabled:opacity-50">{adminSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{adminSaving ? "Guardando..." : "Guardar"}</button></div>
        </div>
      </div>
      {/* Data Management */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4"><div className="rounded-xl bg-[#f0fdf4] p-2.5"><Database className="h-5 w-5 text-[#16a34a]" /></div><h2 className="text-base font-semibold text-[#0f172a]">Gestion de Datos</h2></div>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[#0f172a]">Importar desde MikroTik</p>
              <p className="text-xs text-[#94a3b8]">Re-importa planes y clientes en cualquier momento</p>
            </div>
            <a href="/onboarding" className="rounded-xl bg-[#006fff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0057cc]">Importar</a>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[#0f172a]">Auto-detectar red</p>
              <p className="text-xs text-[#94a3b8]">Escanea y reconstruye la topologia</p>
            </div>
            <a href="/red" className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-medium text-[#475569] hover:bg-[#f5f7fa]">Ir a Red</a>
          </div>
        </div>
      </div>
    </div>
  );
}
