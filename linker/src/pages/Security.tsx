import { useState, useEffect, useCallback } from "react";
import { Shield, Gauge, Globe, Lock, ShieldAlert, Save, Loader2, AlertTriangle, Zap, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Skeleton from "@/components/Skeleton";
import { useMikrotikStore } from "@/stores/useMikrotikStore";

interface ModuleStatus {
  configured: boolean;
  status: string; // "ok" | "partial" | "none" | "error"
  description: string;
  rules?: number;
  disabled?: number;
}

interface NetworkHealth {
  connected: boolean;
  health_percentage: number;
  configured_modules: number;
  total_modules: number;
  error?: string;
  firewall: ModuleStatus;
  qos: ModuleStatus;
  dns: ModuleStatus;
  clientIsolation: ModuleStatus;
  antiDdos: ModuleStatus;
  backup: ModuleStatus;
}

interface FirewallRule {
  id: string;
  chain: string;
  action: string;
  src_address: string;
  dst_address: string;
  protocol: string;
  dst_port: string;
  connection_state: string;
  comment: string;
  disabled: boolean;
  is_linker: boolean;
  type: string;
}

interface HistoryEntry {
  id: string;
  action: string;
  status: string;
  message: string;
  details: string | null;
  created_at: string;
}

interface RulesData {
  connected: boolean;
  error?: string;
  firewall_rules: FirewallRule[];
  nat_rules: FirewallRule[];
  total_filter: number;
  total_nat: number;
  linker_filter: number;
  linker_nat: number;
  history: HistoryEntry[];
}

export default function SeguridadPage() {
  const mikrotikConnected = useMikrotikStore(s => s.connected);
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [rulesData, setRulesData] = useState<RulesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [healthData, rules] = await Promise.all([
        invoke<NetworkHealth>("get_network_health"),
        invoke<RulesData>("get_rules").catch(() => null),
      ]);
      setHealth(healthData);
      setRulesData(rules);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const applyAction = async (ruleType: string) => {
    setApplying(ruleType);
    try {
      const result = await invoke<{ success: boolean; message: string; errors: string[] }>("apply_security", { ruleType });
      if (!result.success && result.errors?.length > 0) {
        alert(`Errores:\n${result.errors.join("\n")}`);
      }
      await fetchData();
    } catch (err) {
      alert(String(err));
    } finally {
      setApplying(null);
    }
  };

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-4 h-9 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
        <p className="mt-4 text-sm text-[#dc2626]">{error}</p>
        <button onClick={() => { setError(""); fetchData(); }} className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white">
          Reintentar
        </button>
      </div>
    </div>
  );

  const cards: { key: keyof Pick<NetworkHealth, "firewall" | "qos" | "dns" | "clientIsolation" | "antiDdos" | "backup">; title: string; desc: string; icon: typeof Shield }[] = [
    { key: "firewall", title: "Firewall Profesional", desc: "INPUT + FORWARD rules: established, ICMP, LAN, WireGuard, API VPN, fasttrack.", icon: Shield },
    { key: "qos", title: "QoS (Calidad de Servicio)", desc: "PCQ queue types para distribucion equitativa del ancho de banda.", icon: Gauge },
    { key: "dns", title: "DNS Cache", desc: "DNS 8.8.8.8, 1.1.1.1 con cache 4096KiB y remote requests.", icon: Globe },
    { key: "clientIsolation", title: "Aislamiento de Clientes", desc: "Bloquea trafico entre clientes (10.0.0.0/24).", icon: Lock },
    { key: "antiDdos", title: "Proteccion Anti-DDoS", desc: "SYN flood, ICMP flood, limite de conexiones por cliente.", icon: ShieldAlert },
    { key: "backup", title: "Backup", desc: "Respaldo de la configuracion del MikroTik.", icon: Save },
  ];

  const getModuleStatus = (key: string): ModuleStatus | null => {
    if (!health) return null;
    return (health as unknown as Record<string, ModuleStatus>)[key] ?? null;
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "ok": return { bg: "bg-[#f0fdf4]", text: "text-[#16a34a]", dot: "bg-[#16a34a]" };
      case "partial": return { bg: "bg-[#fffbeb]", text: "text-[#f59e0b]", dot: "bg-[#f59e0b]" };
      default: return { bg: "bg-[#fef2f2]", text: "text-[#dc2626]", dot: "bg-[#dc2626]" };
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "ok": return "Aplicado";
      case "partial": return "Parcial";
      case "error": return "Error";
      default: return "No configurado";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#0f172a]">Seguridad de Red</h1>
          <p className="mt-1 text-sm text-[#475569]">Configura y monitorea la seguridad de tu red MikroTik</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-xl bg-[#f5f7fa] px-4 py-2 text-sm font-medium text-[#475569] hover:bg-[#e2e8f0]">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </div>

      {/* Health summary */}
      {health && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${health.health_percentage >= 80 ? "bg-[#f0fdf4]" : health.health_percentage >= 50 ? "bg-[#fffbeb]" : "bg-[#fef2f2]"}`}>
                <Shield className={`h-6 w-6 ${health.health_percentage >= 80 ? "text-[#16a34a]" : health.health_percentage >= 50 ? "text-[#f59e0b]" : "text-[#dc2626]"}`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0f172a]">
                  Seguridad: {health.health_percentage}%
                  {!health.connected && <span className="ml-2 text-xs text-[#dc2626]">(Sin conexion)</span>}
                </p>
                <p className="text-xs text-[#475569]">
                  {health.configured_modules}/{health.total_modules} modulos configurados en MikroTik
                  {rulesData && ` | ${rulesData.linker_filter} reglas Linker activas`}
                </p>
              </div>
            </div>
            <div className="flex-1">
              <div className="h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
                <div
                  className={`h-full rounded-full transition-all ${health.health_percentage >= 80 ? "bg-[#16a34a]" : health.health_percentage >= 50 ? "bg-[#f59e0b]" : "bg-[#dc2626]"}`}
                  style={{ width: `${health.health_percentage}%` }}
                />
              </div>
            </div>
          </div>
          {health.error && <p className="mt-2 text-xs text-[#dc2626]">{health.error}</p>}
        </div>
      )}

      {/* Module cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(card => {
          const Icon = card.icon;
          const mod = getModuleStatus(card.key);
          const st = mod?.status ?? "none";
          const colors = statusColor(st);
          return (
            <div key={card.key} className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`rounded-xl p-2.5 ${colors.bg} ${colors.text}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#0f172a]">{card.title}</h3>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                      {statusLabel(st)}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#475569] mb-1">{card.desc}</p>
              {mod && mod.description && (
                <p className="text-[10px] text-[#94a3b8] mb-3 truncate" title={mod.description}>
                  {mod.configured ? <CheckCircle2 className="inline h-3 w-3 mr-1 text-[#16a34a]" /> : <XCircle className="inline h-3 w-3 mr-1 text-[#dc2626]" />}
                  {mod.description}
                </p>
              )}
              {!mod?.description && <p className="text-[10px] text-[#94a3b8] mb-3">Sin datos del MikroTik</p>}
              <button
                onClick={() => applyAction(card.key)}
                disabled={!mikrotikConnected || applying === card.key}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] disabled:opacity-50"
              >
                {applying === card.key ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Aplicando...</>
                ) : (
                  <><Zap className="h-4 w-4" />{st === "ok" ? "Reconfigurar" : "Aplicar"}</>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Real firewall rules from MikroTik */}
      {rulesData && rulesData.connected && (rulesData.firewall_rules.length > 0 || rulesData.nat_rules.length > 0) && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <button
            onClick={() => setShowRules(!showRules)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <h2 className="text-base font-semibold text-[#0f172a]">Reglas en MikroTik</h2>
              <p className="text-xs text-[#475569]">
                {rulesData.total_filter} filter ({rulesData.linker_filter} Linker) | {rulesData.total_nat} NAT ({rulesData.linker_nat} Linker)
              </p>
            </div>
            {showRules ? <ChevronUp className="h-5 w-5 text-[#94a3b8]" /> : <ChevronDown className="h-5 w-5 text-[#94a3b8]" />}
          </button>

          {showRules && (
            <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
              {rulesData.firewall_rules.map((rule) => (
                <div
                  key={`filter-${rule.id}`}
                  className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-xs ${
                    rule.is_linker ? "bg-[#f0f9ff] border border-[#bae6fd]" : "bg-[#f5f7fa]"
                  } ${rule.disabled ? "opacity-50" : ""}`}
                >
                  <div className="min-w-0 flex-1 grid grid-cols-5 gap-2">
                    <span className="font-medium text-[#0f172a]">{rule.chain}</span>
                    <span className={`font-medium ${rule.action === "drop" ? "text-[#dc2626]" : rule.action === "accept" ? "text-[#16a34a]" : "text-[#f59e0b]"}`}>
                      {rule.action}
                    </span>
                    <span className="text-[#475569] truncate">{rule.protocol || "-"}{rule.dst_port ? `:${rule.dst_port}` : ""}</span>
                    <span className="text-[#475569] truncate">{rule.src_address || "*"} -{">"} {rule.dst_address || "*"}</span>
                    <span className="text-[#94a3b8] truncate" title={rule.comment}>{rule.comment || "-"}</span>
                  </div>
                  <div className="ml-2 flex items-center gap-1.5">
                    {rule.is_linker && <span className="rounded bg-[#006fff] px-1.5 py-0.5 text-[9px] font-bold text-white">LK</span>}
                    {rule.disabled && <span className="rounded bg-[#94a3b8] px-1.5 py-0.5 text-[9px] font-bold text-white">OFF</span>}
                  </div>
                </div>
              ))}
              {rulesData.nat_rules.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-[#475569] pt-2">NAT</p>
                  {rulesData.nat_rules.map((rule) => (
                    <div
                      key={`nat-${rule.id}`}
                      className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-xs ${
                        rule.is_linker ? "bg-[#f0f9ff] border border-[#bae6fd]" : "bg-[#f5f7fa]"
                      } ${rule.disabled ? "opacity-50" : ""}`}
                    >
                      <div className="min-w-0 flex-1 grid grid-cols-5 gap-2">
                        <span className="font-medium text-[#0f172a]">{rule.chain}</span>
                        <span className="font-medium text-[#475569]">{rule.action}</span>
                        <span className="text-[#475569] truncate">{rule.protocol || "-"}{rule.dst_port ? `:${rule.dst_port}` : ""}</span>
                        <span className="text-[#475569] truncate">{rule.src_address || "*"} -{">"} {rule.dst_address || "*"}</span>
                        <span className="text-[#94a3b8] truncate" title={rule.comment}>{rule.comment || "-"}</span>
                      </div>
                      <div className="ml-2 flex items-center gap-1.5">
                        {rule.is_linker && <span className="rounded bg-[#006fff] px-1.5 py-0.5 text-[9px] font-bold text-white">LK</span>}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* History log */}
      {rulesData && rulesData.history.length > 0 && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[#0f172a] mb-4">Historial de aplicaciones</h2>
          <div className="space-y-2">
            {rulesData.history.slice(0, 10).map(entry => (
              <div key={entry.id} className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[#0f172a] truncate">{entry.message}</p>
                  <p className="text-xs text-[#94a3b8]">{new Date(entry.created_at).toLocaleString("es-MX")}</p>
                </div>
                <span className={`ml-3 shrink-0 inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium ${
                  entry.status === "OK" ? "bg-[#f0fdf4] text-[#16a34a]" :
                  entry.status === "ERROR" ? "bg-[#fef2f2] text-[#dc2626]" :
                  "bg-[#fffbeb] text-[#f59e0b]"
                }`}>
                  {entry.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
