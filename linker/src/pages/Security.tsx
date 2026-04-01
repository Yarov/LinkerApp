import { useState, useEffect, useCallback } from "react";
import {
  Shield, Gauge, Globe, Lock, ShieldAlert, Save, Loader2, AlertTriangle,
  Zap, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Satellite, Ban, Gamepad2, Moon, EyeOff,
  ShieldCheck, ArrowDownUp,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Skeleton from "@/components/Skeleton";
import { useMikrotikStore } from "@/stores/useMikrotikStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ModuleStatus {
  configured: boolean;
  status: string;
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

interface ProtectionModuleStatus {
  active: boolean;
  rules: number;
  disabled?: number;
}

interface ProtectionStatus {
  connected: boolean;
  isp_type: string;
  is_starlink: boolean;
  universal: Record<string, ProtectionModuleStatus>;
  starlink: Record<string, ProtectionModuleStatus>;
}

interface FirewallRule {
  id: string; chain: string; action: string; src_address: string;
  dst_address: string; protocol: string; dst_port: string;
  comment: string; disabled: boolean; is_linker: boolean;
}

interface HistoryEntry {
  id: string; action: string; status: string; message: string;
  details: string | null; created_at: string;
}

interface RulesData {
  connected: boolean;
  firewall_rules: FirewallRule[];
  nat_rules: FirewallRule[];
  total_filter: number; total_nat: number;
  linker_filter: number; linker_nat: number;
  history: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function SeguridadPage() {
  const mikrotikConnected = useMikrotikStore(s => s.connected);

  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [protection, setProtection] = useState<ProtectionStatus | null>(null);
  const [rulesData, setRulesData] = useState<RulesData | null>(null);
  const [hasStarlink, setHasStarlink] = useState(false);
  const [hasAnyWan, setHasAnyWan] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showWisp, setShowWisp] = useState(true);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [healthData, protStatus, rules, settings] = await Promise.all([
        invoke<NetworkHealth>("get_network_health").catch(() => null),
        invoke<ProtectionStatus>("get_protection_status").catch(() => null),
        invoke<RulesData>("get_rules").catch(() => null),
        invoke<{ settings: Record<string, string> }>("get_settings").catch(() => null),
      ]);
      if (healthData) setHealth(healthData);
      if (protStatus) setProtection(protStatus);
      if (rules) setRulesData(rules);

      // Check WAN config for ISP-aware protections
      const s = settings?.settings ?? {};
      if (s["wan_lines"]) {
        try {
          const wans = JSON.parse(s["wan_lines"]) as { isp: string }[];
          setHasAnyWan(wans.length > 0);
          setHasStarlink(wans.some(w => w.isp === "starlink"));
        } catch { /* ignore */ }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // -----------------------------------------------------------------------
  // Apply actions
  // -----------------------------------------------------------------------
  const applyProtection = async (module: string) => {
    setApplying(module);
    try {
      const result = await invoke<{ success: boolean; errors: string[] }>("apply_protection", { module });
      if (!result.success && result.errors?.length) alert(`Errores:\n${result.errors.join("\n")}`);
      const p = await invoke<ProtectionStatus>("get_protection_status").catch(() => null);
      if (p) setProtection(p);
      const r = await invoke<RulesData>("get_rules").catch(() => null);
      if (r) setRulesData(r);
    } catch (err) { alert(String(err)); }
    finally { setApplying(null); }
  };

  const removeProtectionMod = async (module: string) => {
    setApplying(`rm-${module}`);
    try {
      await invoke("remove_protection", { module });
      const p = await invoke<ProtectionStatus>("get_protection_status").catch(() => null);
      if (p) setProtection(p);
      const r = await invoke<RulesData>("get_rules").catch(() => null);
      if (r) setRulesData(r);
    } catch (err) { alert(String(err)); }
    finally { setApplying(null); }
  };

  const applyBaseSec = async (key: string) => {
    setApplying(key);
    try {
      const result = await invoke<{ success: boolean; errors: string[] }>("apply_security", { ruleType: key });
      if (!result.success && result.errors?.length) alert(`Errores:\n${result.errors.join("\n")}`);
      const h = await invoke<NetworkHealth>("get_network_health").catch(() => null);
      if (h) setHealth(h);
      const r = await invoke<RulesData>("get_rules").catch(() => null);
      if (r) setRulesData(r);
    } catch (err) { alert(String(err)); }
    finally { setApplying(null); }
  };

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  const statusColor = (s: string) => {
    if (s === "ok") return { bg: "bg-[#f0fdf4]", text: "text-[#16a34a]", dot: "bg-[#16a34a]" };
    if (s === "partial") return { bg: "bg-[#fffbeb]", text: "text-[#f59e0b]", dot: "bg-[#f59e0b]" };
    return { bg: "bg-[#fef2f2]", text: "text-[#dc2626]", dot: "bg-[#dc2626]" };
  };

  const getMod = (key: string): ModuleStatus | null =>
    health ? (health as unknown as Record<string, ModuleStatus>)[key] ?? null : null;

  const getProtMod = (key: string): ProtectionModuleStatus | null => {
    if (!protection) return null;
    return protection.universal[key] ?? protection.starlink[key] ?? null;
  };

  // Protection card definitions
  type PCard = { key: string; title: string; desc: string; icon: typeof Shield; critical?: boolean };
  const universalCards: PCard[] = [
    { key: "torrent_block", title: "Bloqueo Torrents", desc: "L7 + puertos P2P + limite conexiones.", icon: Ban },
    { key: "high_download_block", title: "Control Descargas", desc: "Detecta y limita heavy users.", icon: ArrowDownUp },
    { key: "gaming_priority", title: "Gaming Priority", desc: "Prioridad para Xbox, PS, Steam, Fortnite.", icon: Gamepad2 },
    { key: "firewall_hardening", title: "Firewall Avanzado", desc: "Bogon filter + port scan + drop WAN.", icon: ShieldCheck },
    { key: "ip_protection", title: "Proteccion IP", desc: "Oculta infraestructura a clientes.", icon: EyeOff },
  ];
  const starlinkCards: PCard[] = [
    { key: "anti_isp_detection", title: "Anti-Detection", desc: "TTL=64, MSS clamp, bloqueo DoH.", icon: Shield, critical: true },
    { key: "anti_stow", title: "Anti-Stow/Sleep", desc: "Keepalive para que el dish no duerma.", icon: Moon, critical: true },
    { key: "app_block", title: "Bloqueo App", desc: "DNS sinkhole + bloqueo 192.168.100.x", icon: Satellite, critical: true },
    { key: "dns_redirect", title: "DNS Redirect", desc: "Fuerza todo DNS al MikroTik.", icon: Globe },
    { key: "conntrack_optimize", title: "Conntrack Opt.", desc: "Reduce timeouts de conexiones.", icon: Gauge },
  ];

  const protActiveCount = [...universalCards, ...(hasStarlink ? starlinkCards : [])]
    .filter(c => getProtMod(c.key)?.active).length;
  const protTotal = universalCards.length + (hasStarlink ? starlinkCards.length : 0);

  // -----------------------------------------------------------------------
  // Loading / Error
  // -----------------------------------------------------------------------
  if (loading) return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
        <p className="mt-4 text-sm text-[#dc2626]">{error}</p>
        <button onClick={() => { setError(""); fetchData(); }} className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white">Reintentar</button>
      </div>
    </div>
  );

  // -----------------------------------------------------------------------
  // RENDER
  // -----------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#0f172a]">Seguridad</h1>
          <p className="mt-1 text-sm text-[#94a3b8]">Firewall, proteccion WISP y reglas de seguridad</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-1.5 rounded-xl bg-[#f5f7fa] px-3 py-2 text-xs font-medium text-[#475569] hover:bg-[#e2e8f0]">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ================================================================= */}
      {/* SEGURIDAD BASE                                                    */}
      {/* ================================================================= */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-[#475569]">Seguridad Base</h2>
            {health && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                health.health_percentage >= 80 ? "bg-[#f0fdf4] text-[#16a34a]" :
                health.health_percentage >= 50 ? "bg-[#fffbeb] text-[#f59e0b]" :
                "bg-[#fef2f2] text-[#dc2626]"
              }`}>
                {health.configured_modules}/{health.total_modules}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {([
            { key: "firewall", title: "Firewall", desc: "INPUT + FORWARD + fasttrack", icon: Shield },
            { key: "dns", title: "DNS Cache", desc: "8.8.8.8 / 1.1.1.1 + cache 4MB", icon: Globe },
            { key: "antiDdos", title: "Anti-DDoS", desc: "SYN flood + ICMP + conn limit", icon: ShieldAlert },
            { key: "qos", title: "QoS", desc: "PCQ equitativo por cliente", icon: Gauge },
            { key: "clientIsolation", title: "Aislamiento", desc: "Bloqueo entre clientes", icon: Lock },
            { key: "backup", title: "Backup", desc: "Respaldo de config", icon: Save },
          ] as { key: string; title: string; desc: string; icon: typeof Shield }[]).map(card => {
            const Icon = card.icon;
            const mod = getMod(card.key);
            const st = mod?.status ?? "none";
            const colors = statusColor(st);
            const isApplying = applying === card.key;
            return (
              <div key={card.key} className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm transition-all ${st === "ok" ? "border-[#16a34a]/20" : "border-[#e2e8f0]"}`}>
                <div className={`shrink-0 rounded-lg p-2 ${colors.bg} ${colors.text}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[#0f172a]">{card.title}</p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${colors.bg} ${colors.text}`}>
                      <span className={`h-1 w-1 rounded-full ${colors.dot}`} />
                      {st === "ok" ? "ON" : st === "partial" ? "Parcial" : "OFF"}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#94a3b8] truncate">{mod?.description || card.desc}</p>
                </div>
                <button
                  onClick={() => applyBaseSec(card.key)}
                  disabled={!mikrotikConnected || isApplying}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 ${
                    st === "ok"
                      ? "bg-[#f0fdf4] text-[#16a34a] hover:bg-[#dcfce7]"
                      : "bg-[#006fff] text-white hover:bg-[#0057cc]"
                  }`}
                >
                  {isApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : st === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ================================================================= */}
      {/* PROTECCION WISP                                                   */}
      {/* ================================================================= */}
      <div>
        <button onClick={() => setShowWisp(!showWisp)} className="flex w-full items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-[#475569]">Proteccion WISP</h2>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              protActiveCount === protTotal && protTotal > 0 ? "bg-[#f0fdf4] text-[#16a34a]" :
              protActiveCount > 0 ? "bg-[#fffbeb] text-[#f59e0b]" :
              "bg-[#f1f5f9] text-[#94a3b8]"
            }`}>
              {protActiveCount}/{protTotal}
            </span>
            {hasStarlink && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#eff6ff] px-2 py-0.5 text-[10px] font-medium text-[#006fff]">
                <Satellite className="h-3 w-3" />Starlink
              </span>
            )}
          </div>
          {showWisp ? <ChevronUp className="h-4 w-4 text-[#94a3b8]" /> : <ChevronDown className="h-4 w-4 text-[#94a3b8]" />}
        </button>

        {showWisp && (
          <>
            {!hasAnyWan ? (
              <div className="rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-6 text-center">
                <p className="text-sm text-[#475569]">Configura tus WANs en la seccion <span className="font-medium text-[#006fff]">WANs & ISPs</span> para ver las protecciones disponibles</p>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Apply all */}
                <button
                  onClick={() => applyProtection(hasStarlink ? "all_starlink" : "all_universal")}
                  disabled={!mikrotikConnected || !!applying}
                  className="flex items-center gap-2 rounded-xl bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] disabled:opacity-50"
                >
                  {(applying === "all_starlink" || applying === "all_universal")
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Aplicando...</>
                    : <><Zap className="h-4 w-4" />Aplicar todas ({protTotal})</>
                  }
                </button>

                {/* Universal */}
                <div>
                  <p className="mb-2 text-xs font-medium text-[#94a3b8]">UNIVERSALES</p>
                  <div className="space-y-2">
                    {universalCards.map(c => <ProtToggleCard key={c.key} card={c} mod={getProtMod(c.key)} applying={applying} onApply={applyProtection} onRemove={removeProtectionMod} disabled={!mikrotikConnected} accentColor="#16a34a" />)}
                  </div>
                </div>

                {/* Starlink */}
                {hasStarlink && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#006fff]">
                      <Satellite className="h-3 w-3" />STARLINK
                    </p>
                    <div className="space-y-2">
                      {starlinkCards.map(c => <ProtToggleCard key={c.key} card={c} mod={getProtMod(c.key)} applying={applying} onApply={applyProtection} onRemove={removeProtectionMod} disabled={!mikrotikConnected} accentColor="#006fff" />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ================================================================= */}
      {/* REGLAS EN MIKROTIK                                                */}
      {/* ================================================================= */}
      {rulesData && rulesData.connected && (rulesData.firewall_rules.length > 0 || rulesData.nat_rules.length > 0) && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <button onClick={() => setShowRules(!showRules)} className="flex w-full items-center justify-between text-left">
            <div>
              <h2 className="text-sm font-semibold text-[#0f172a]">Reglas en MikroTik</h2>
              <p className="text-[11px] text-[#475569]">{rulesData.total_filter} filter ({rulesData.linker_filter} LK) | {rulesData.total_nat} NAT ({rulesData.linker_nat} LK)</p>
            </div>
            {showRules ? <ChevronUp className="h-4 w-4 text-[#94a3b8]" /> : <ChevronDown className="h-4 w-4 text-[#94a3b8]" />}
          </button>
          {showRules && (
            <div className="mt-3 space-y-1.5 max-h-80 overflow-y-auto">
              {rulesData.firewall_rules.map(rule => <RuleRow key={`f-${rule.id}`} rule={rule} />)}
              {rulesData.nat_rules.length > 0 && <p className="text-[10px] font-semibold text-[#475569] pt-2">NAT</p>}
              {rulesData.nat_rules.map(rule => <RuleRow key={`n-${rule.id}`} rule={rule} />)}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {rulesData && rulesData.history.length > 0 && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-[#0f172a] mb-3">Historial</h2>
          <div className="space-y-1.5">
            {rulesData.history.slice(0, 8).map(e => (
              <div key={e.id} className="flex items-center justify-between rounded-lg bg-[#f5f7fa] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[#0f172a] truncate">{e.message}</p>
                  <p className="text-[10px] text-[#94a3b8]">{new Date(e.created_at).toLocaleString("es-MX")}</p>
                </div>
                <span className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  e.status === "OK" ? "bg-[#f0fdf4] text-[#16a34a]" : e.status === "ERROR" ? "bg-[#fef2f2] text-[#dc2626]" : "bg-[#fffbeb] text-[#f59e0b]"
                }`}>{e.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProtToggleCard({ card, mod, applying, onApply, onRemove, disabled, accentColor }: {
  card: { key: string; title: string; desc: string; icon: typeof Shield; critical?: boolean };
  mod: { active: boolean; rules: number } | null;
  applying: string | null;
  onApply: (key: string) => void;
  onRemove: (key: string) => void;
  disabled: boolean;
  accentColor: string;
}) {
  const Icon = card.icon;
  const isActive = mod?.active ?? false;
  const isBusy = applying === card.key || applying === `rm-${card.key}`;

  return (
    <div className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm transition-all ${isActive ? "border-opacity-30" : "border-[#e2e8f0]"}`}
      style={{ borderColor: isActive ? accentColor : undefined }}
    >
      <div className="shrink-0 rounded-lg p-2" style={{ backgroundColor: isActive ? `${accentColor}12` : "#f5f7fa", color: isActive ? accentColor : "#94a3b8" }}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[#0f172a]">{card.title}</p>
          {card.critical && !isActive && (
            <span className="rounded bg-[#fef2f2] px-1 py-0.5 text-[8px] font-bold text-[#dc2626]">CRITICO</span>
          )}
          {mod && mod.rules > 0 && (
            <span className="text-[10px] text-[#94a3b8]">{mod.rules} reglas</span>
          )}
        </div>
        <p className="text-[11px] text-[#94a3b8]">{card.desc}</p>
      </div>
      <button
        onClick={() => isActive ? onRemove(card.key) : onApply(card.key)}
        disabled={disabled || isBusy}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50 ${
          isActive ? "" : "bg-[#e2e8f0]"
        }`}
        style={{ backgroundColor: isActive ? accentColor : undefined }}
      >
        {isBusy ? (
          <span className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-3 w-3 animate-spin text-white" /></span>
        ) : (
          <span className={`mt-0.5 inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${isActive ? "ml-[22px]" : "ml-0.5"}`} />
        )}
      </button>
    </div>
  );
}

function RuleRow({ rule }: { rule: FirewallRule }) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-[11px] ${
      rule.is_linker ? "bg-[#f0f9ff] border border-[#bae6fd]" : "bg-[#f5f7fa]"
    } ${rule.disabled ? "opacity-40" : ""}`}>
      <div className="min-w-0 flex-1 grid grid-cols-5 gap-2">
        <span className="font-medium text-[#0f172a]">{rule.chain}</span>
        <span className={`font-medium ${rule.action === "drop" ? "text-[#dc2626]" : rule.action === "accept" ? "text-[#16a34a]" : "text-[#f59e0b]"}`}>{rule.action}</span>
        <span className="text-[#475569] truncate">{rule.protocol || "-"}{rule.dst_port ? `:${rule.dst_port}` : ""}</span>
        <span className="text-[#475569] truncate">{rule.src_address || "*"}{"->"}{rule.dst_address || "*"}</span>
        <span className="text-[#94a3b8] truncate">{rule.comment || "-"}</span>
      </div>
      {rule.is_linker && <span className="ml-1 rounded bg-[#006fff] px-1 py-0.5 text-[8px] font-bold text-white">LK</span>}
    </div>
  );
}
