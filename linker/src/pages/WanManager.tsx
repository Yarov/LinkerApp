import { useState, useEffect, useCallback } from "react";
import {
  Satellite, Globe, Wifi, Radio, Network, Search, RefreshCw, Loader2,
  AlertTriangle, CheckCircle2, XCircle, Plus, Trash2, ArrowLeftRight,
  ShieldCheck, Activity, Zap, ChevronDown, ChevronUp, Settings2,
  ArrowDownUp, Signal, Ban, Gauge, ArrowDown, ArrowUp, Timer,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Skeleton from "@/components/Skeleton";
import { useMikrotikStore } from "@/stores/useMikrotikStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DetectedWan {
  interface: string;
  type: string;
  ip: string;
  gateway: string;
  status: string;
  isp_guess: string;
  running: boolean;
  pppoe_user?: string;
  underlying_interface?: string;
}

interface WanDetection {
  connected: boolean;
  wan_lines: DetectedWan[];
  starlink_router_reachable: boolean;
  router_identity: string;
  router_board: string;
  error?: string;
}

interface SavedWanLine {
  id: string;
  interface_name: string;
  isp: string;
  ip: string;
  type: string;
  role: "primary" | "backup" | "loadbalance";
  gateway: string;
  bandwidth_limit?: string;
  ping_target?: string;
  check_interval?: string;
}

interface WanStatus {
  interface_name: string;
  isp: string;
  running: boolean;
  ip: string;
  has_default_route: boolean;
  tx_bytes: string;
  rx_bytes: string;
}

interface WanStatusResponse {
  connected: boolean;
  wan_lines: WanStatus[];
  load_balance_active: boolean;
  failover_active: boolean;
  lb_rules_count: number;
  netwatch_count: number;
}

interface SpeedTestResult {
  interface: string;
  ping: {
    avg_ms: number;
    min_ms: number;
    max_ms: number;
    sent: number;
    received: number;
    loss_pct: number;
  };
  download: {
    mbps: number;
    bytes: number;
    duration_secs: number;
    status: string;
  };
  upload: {
    mbps: number;
    status: string;
  };
  quality: string;
  latency_quality: string;
}

// ---------------------------------------------------------------------------
// ISP Config
// ---------------------------------------------------------------------------
const ISP_LIST = [
  { value: "starlink", label: "Starlink", icon: Satellite, color: "#006fff" },
  { value: "telmex", label: "Telmex", icon: Globe, color: "#00a651" },
  { value: "izzi", label: "Izzi", icon: Wifi, color: "#e4002b" },
  { value: "totalplay", label: "Totalplay", icon: Radio, color: "#00b4d8" },
  { value: "megacable", label: "Megacable", icon: Network, color: "#ff6b00" },
  { value: "other", label: "Otro", icon: Globe, color: "#475569" },
] as const;

const getIsp = (v: string) => ISP_LIST.find(i => i.value === v) ?? ISP_LIST[5];

type TabKey = "conexiones" | "balanceo" | "failover";

const TABS: { key: TabKey; label: string; icon: typeof Globe }[] = [
  { key: "conexiones", label: "Conexiones", icon: Signal },
  { key: "balanceo", label: "Balanceo", icon: ArrowLeftRight },
  { key: "failover", label: "Failover", icon: ShieldCheck },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatBytes(bytes: string): string {
  const n = parseInt(bytes, 10);
  if (isNaN(n) || n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function WanManagerPage() {
  const mikrotikConnected = useMikrotikStore(s => s.connected);

  const [tab, setTab] = useState<TabKey>("conexiones");
  const [savedWans, setSavedWans] = useState<SavedWanLine[]>([]);
  const [wanDetect, setWanDetect] = useState<WanDetection | null>(null);
  const [wanStatus, setWanStatus] = useState<WanStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [speedTests, setSpeedTests] = useState<Record<string, SpeedTestResult>>({});
  const [testingWan, setTestingWan] = useState<string | null>(null);

  const hasStarlink = savedWans.some(w => w.isp === "starlink");
  const multiWan = savedWans.length >= 2;

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, status] = await Promise.all([
        invoke<{ settings: Record<string, string> }>("get_settings").catch(() => null),
        invoke<WanStatusResponse>("get_wan_status").catch(() => null),
      ]);

      const s = settings?.settings ?? {};
      if (s["wan_lines"]) {
        try {
          const parsed = JSON.parse(s["wan_lines"]) as SavedWanLine[];
          // Ensure role defaults
          setSavedWans(parsed.map(w => ({ ...w, role: w.role || "primary", gateway: w.gateway || "" })));
        } catch { /* ignore */ }
      }
      if (status) setWanStatus(status);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-detect on first load if no saved WANs
  const [didAutoDetect, setDidAutoDetect] = useState(false);
  useEffect(() => {
    if (!loading && !didAutoDetect && savedWans.length === 0 && mikrotikConnected) {
      setDidAutoDetect(true);
      detectWan();
    }
  }, [loading, didAutoDetect, savedWans.length, mikrotikConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  const detectWan = async () => {
    setDetecting(true);
    try {
      const result = await invoke<WanDetection>("detect_wan");
      setWanDetect(result);
      if (result.starlink_router_reachable) {
        for (const wl of result.wan_lines) {
          if (wl.isp_guess === "unknown") wl.isp_guess = "starlink";
        }
      }
    } catch { /* silent */ }
    finally { setDetecting(false); }
  };

  const saveWanLines = async (lines: SavedWanLine[]) => {
    setSavedWans(lines);
    const mainIsp = lines.find(w => w.isp === "starlink") ? "starlink" : lines[0]?.isp ?? "other";
    await invoke("save_settings", {
      settings: { wan_lines: JSON.stringify(lines), isp_type: mainIsp },
    }).catch(() => {});
  };

  const selectIspForWan = async (wan: DetectedWan, isp: string) => {
    const isFirst = savedWans.length === 0;
    const line: SavedWanLine = {
      id: String(Date.now()),
      interface_name: wan.interface,
      isp,
      ip: wan.ip,
      type: wan.type,
      role: isFirst ? "primary" : "backup",
      gateway: wan.gateway,
    };
    const newLines = [...savedWans.filter(w => w.interface_name !== wan.interface), line];
    await saveWanLines(newLines);

    if (wanDetect) {
      const unsaved = wanDetect.wan_lines.filter(
        wl => !newLines.some(s => s.interface_name === wl.interface)
      );
      if (unsaved.length === 0) setWanDetect(null);
    }

    // Refresh status
    const status = await invoke<WanStatusResponse>("get_wan_status").catch(() => null);
    if (status) setWanStatus(status);
  };

  const removeWan = async (id: string) => {
    const newLines = savedWans.filter(w => w.id !== id);
    // If removing primary, promote first remaining to primary
    if (newLines.length > 0 && !newLines.some(w => w.role === "primary")) {
      newLines[0].role = "primary";
    }
    await saveWanLines(newLines);
  };

  const updateWanRole = async (id: string, role: SavedWanLine["role"]) => {
    const newLines = savedWans.map(w => {
      if (w.id === id) return { ...w, role };
      // If setting as primary, demote others
      if (role === "primary" && w.role === "primary") return { ...w, role: "backup" as const };
      return w;
    });
    await saveWanLines(newLines);
  };

  const updateWanField = async (id: string, field: string, value: string) => {
    const newLines = savedWans.map(w =>
      w.id === id ? { ...w, [field]: value } : w
    );
    await saveWanLines(newLines);
  };

  // -----------------------------------------------------------------------
  // Load Balance / Failover actions
  // -----------------------------------------------------------------------
  const applyLoadBalance = async () => {
    setApplying("lb");
    try {
      const configs = savedWans.map(w => ({
        interface_name: w.interface_name,
        gateway: w.gateway,
        role: w.role,
      }));
      const result = await invoke<{ success: boolean; applied: string[]; errors: string[] }>(
        "setup_load_balance", { wanConfigs: JSON.stringify(configs) }
      );
      if (!result.success && result.errors?.length) {
        alert(`Errores:\n${result.errors.join("\n")}`);
      }
      const status = await invoke<WanStatusResponse>("get_wan_status").catch(() => null);
      if (status) setWanStatus(status);
    } catch (err) { alert(String(err)); }
    finally { setApplying(null); }
  };

  const applyFailover = async () => {
    setApplying("failover");
    try {
      const configs = savedWans.map(w => ({
        interface_name: w.interface_name,
        gateway: w.gateway,
        role: w.role,
        bandwidth_limit: w.bandwidth_limit || "",
        ping_target: w.ping_target || "8.8.8.8",
        check_interval: w.check_interval || "10s",
      }));
      const result = await invoke<{ success: boolean; applied: string[]; errors: string[] }>(
        "setup_failover", { wanConfigs: JSON.stringify(configs) }
      );
      if (!result.success && result.errors?.length) {
        alert(`Errores:\n${result.errors.join("\n")}`);
      }
      const status = await invoke<WanStatusResponse>("get_wan_status").catch(() => null);
      if (status) setWanStatus(status);
    } catch (err) { alert(String(err)); }
    finally { setApplying(null); }
  };

  const removeConfig = async (type: string) => {
    setApplying(`rm-${type}`);
    try {
      await invoke("remove_wan_config", { configType: type });
      const status = await invoke<WanStatusResponse>("get_wan_status").catch(() => null);
      if (status) setWanStatus(status);
    } catch (err) { alert(String(err)); }
    finally { setApplying(null); }
  };

  const runSpeedTest = async (wan: SavedWanLine) => {
    setTestingWan(wan.id);
    try {
      const result = await invoke<SpeedTestResult>("speed_test_wan", {
        interfaceName: wan.interface_name,
        srcIp: wan.ip || "",
      });
      setSpeedTests(prev => ({ ...prev, [wan.id]: result }));
    } catch (err) { alert(`Error en speed test: ${String(err)}`); }
    finally { setTestingWan(null); }
  };

  // -----------------------------------------------------------------------
  // Loading / Error states
  // -----------------------------------------------------------------------
  if (loading) return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {[1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
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
          <h1 className="text-2xl font-semibold text-[#0f172a]">WANs & ISPs</h1>
          <div className="mt-1.5 flex items-center gap-2">
            {savedWans.map(w => {
              const isp = getIsp(w.isp);
              const I = isp.icon;
              return (
                <span key={w.id} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: `${isp.color}12`, color: isp.color }}>
                  <I className="h-3.5 w-3.5" />{isp.label}
                  <span className={`h-1.5 w-1.5 rounded-full ${w.role === "primary" ? "bg-[#16a34a]" : "bg-[#f59e0b]"}`} />
                  <span className="text-[10px] opacity-70">{w.role === "primary" ? "PRI" : w.role === "backup" ? "BKP" : "LB"}</span>
                </span>
              );
            })}
            {savedWans.length === 0 && <span className="text-sm text-[#94a3b8]">Detecta tus conexiones WAN</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={detectWan} disabled={detecting} className="flex items-center gap-1.5 rounded-xl bg-[#f5f7fa] px-3 py-2 text-xs font-medium text-[#475569] hover:bg-[#e2e8f0]">
            {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {detecting ? "Detectando..." : "Detectar WAN"}
          </button>
          <button onClick={fetchData} className="flex items-center gap-1.5 rounded-xl bg-[#f5f7fa] px-3 py-2 text-xs font-medium text-[#475569] hover:bg-[#e2e8f0]">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* TAB SWITCHER */}
      <div className="flex gap-1 rounded-xl bg-[#f5f7fa] p-1">
        {TABS.map(t => {
          const I = t.icon;
          const isDisabled = t.key !== "conexiones" && !multiWan;
          return (
            <button
              key={t.key}
              onClick={() => !isDisabled && setTab(t.key)}
              disabled={isDisabled}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                tab === t.key
                  ? "bg-white text-[#006fff] shadow-sm"
                  : isDisabled
                    ? "text-[#cbd5e1] cursor-not-allowed"
                    : "text-[#475569] hover:text-[#0f172a]"
              }`}
            >
              <I className="h-4 w-4" />
              {t.label}
              {isDisabled && <span className="text-[9px]">(2+ WANs)</span>}
            </button>
          );
        })}
      </div>

      {/* WAN AUTO-DETECTION (shows when detected and has unsaved WANs) */}
      {wanDetect && wanDetect.connected && (() => {
        const unsavedWans = wanDetect.wan_lines.filter(
          wl => !savedWans.some(s => s.interface_name === wl.interface)
        );
        if (unsavedWans.length === 0) return null;
        return (
          <div className="rounded-2xl border border-[#bae6fd] bg-[#f0f9ff] p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl bg-white p-2.5 shadow-sm"><Search className="h-5 w-5 text-[#006fff]" /></div>
              <div>
                <p className="text-sm font-semibold text-[#0f172a]">
                  {unsavedWans.length} conexion{unsavedWans.length > 1 ? "es" : ""} detectada{unsavedWans.length > 1 ? "s" : ""}
                  <span className="ml-2 text-xs font-normal text-[#475569]">{wanDetect.router_identity} ({wanDetect.router_board})</span>
                </p>
                {wanDetect.starlink_router_reachable && (
                  <p className="text-xs text-[#006fff] flex items-center gap-1"><Satellite className="h-3 w-3" /> Router Starlink detectado (192.168.100.1)</p>
                )}
              </div>
              <button onClick={() => setWanDetect(null)} className="ml-auto text-xs text-[#94a3b8] hover:text-[#475569]">Cerrar</button>
            </div>

            {unsavedWans.map((wan, idx) => {
              const guessedIsp = getIsp(wan.isp_guess === "unknown" ? "other" : wan.isp_guess);
              return (
                <div key={idx} className="mb-3 last:mb-0 rounded-xl bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-[#0f172a]">
                        {wan.interface} <span className="text-xs text-[#94a3b8]">({wan.type})</span>
                      </p>
                      <p className="text-xs text-[#475569]">
                        IP: {wan.ip || "sin IP"} | Gateway: {wan.gateway || "-"}
                        {wan.status === "bound" && <span className="ml-1 text-[#16a34a]"> conectado</span>}
                      </p>
                    </div>
                    {wan.isp_guess !== "unknown" && wan.isp_guess !== "other" && (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${guessedIsp.color}12`, color: guessedIsp.color }}>
                        Parece {guessedIsp.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-[#475569] mb-2">Selecciona el proveedor:</p>
                  <div className="flex flex-wrap gap-2">
                    {ISP_LIST.map(isp => {
                      const I = isp.icon;
                      const isGuess = wan.isp_guess === isp.value;
                      return (
                        <button
                          key={isp.value}
                          onClick={() => selectIspForWan(wan, isp.value)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                            isGuess ? "ring-2 shadow-sm" : "hover:shadow-sm"
                          }`}
                          style={{
                            backgroundColor: isGuess ? `${isp.color}18` : "#f5f7fa",
                            color: isGuess ? isp.color : "#475569",
                            ...(isGuess ? { boxShadow: `0 0 0 2px ${isp.color}40` } : {}),
                          }}
                        >
                          <I className="h-4 w-4" />
                          {isp.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ================================================================= */}
      {/* TAB: CONEXIONES                                                   */}
      {/* ================================================================= */}
      {tab === "conexiones" && (
        <div className="space-y-4">
          {savedWans.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-10 text-center">
              <Signal className="mx-auto h-10 w-10 text-[#94a3b8]" />
              <p className="mt-3 text-sm font-medium text-[#475569]">No hay conexiones WAN configuradas</p>
              <p className="mt-1 text-xs text-[#94a3b8]">Haz clic en "Detectar WAN" para encontrar tus conexiones automaticamente</p>
              <button onClick={detectWan} disabled={detecting} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc]">
                <Search className="h-4 w-4" />{detecting ? "Detectando..." : "Detectar WAN"}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {savedWans.map(wan => {
                const isp = getIsp(wan.isp);
                const I = isp.icon;
                const status = wanStatus?.wan_lines.find(s => s.interface_name === wan.interface_name);
                const isRunning = status?.running ?? false;

                return (
                  <div key={wan.id} className="rounded-2xl border bg-white p-5 shadow-sm transition-all" style={{ borderColor: isRunning ? `${isp.color}30` : "#e2e8f0" }}>
                    {/* Card header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl p-2.5" style={{ backgroundColor: `${isp.color}12`, color: isp.color }}>
                          <I className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#0f172a]">{isp.label}</p>
                          <p className="text-xs text-[#475569]">{wan.interface_name} ({wan.type})</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isRunning ? "bg-[#f0fdf4] text-[#16a34a]" : "bg-[#fef2f2] text-[#dc2626]"
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-[#16a34a]" : "bg-[#dc2626]"}`} />
                          {isRunning ? "UP" : "DOWN"}
                        </span>
                        <button onClick={() => removeWan(wan.id)} className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-[#fef2f2] hover:text-[#dc2626]">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Status info */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div className="rounded-lg bg-[#f5f7fa] px-3 py-2">
                        <p className="text-[10px] text-[#94a3b8]">IP</p>
                        <p className="text-xs font-medium text-[#0f172a]">{status?.ip || wan.ip || "-"}</p>
                      </div>
                      <div className="rounded-lg bg-[#f5f7fa] px-3 py-2">
                        <p className="text-[10px] text-[#94a3b8]">Gateway</p>
                        <p className="text-xs font-medium text-[#0f172a]">{wan.gateway || "-"}</p>
                      </div>
                      {status && (
                        <>
                          <div className="rounded-lg bg-[#f5f7fa] px-3 py-2">
                            <p className="text-[10px] text-[#94a3b8]">TX</p>
                            <p className="text-xs font-medium text-[#0f172a]">{formatBytes(status.tx_bytes)}</p>
                          </div>
                          <div className="rounded-lg bg-[#f5f7fa] px-3 py-2">
                            <p className="text-[10px] text-[#94a3b8]">RX</p>
                            <p className="text-xs font-medium text-[#0f172a]">{formatBytes(status.rx_bytes)}</p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Role selector */}
                    <div>
                      <p className="text-[10px] font-medium text-[#94a3b8] mb-1.5">ROL</p>
                      <div className="flex gap-1.5">
                        {(["primary", "backup", "loadbalance"] as const).map(role => (
                          <button
                            key={role}
                            onClick={() => updateWanRole(wan.id, role)}
                            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${
                              wan.role === role
                                ? "bg-[#006fff] text-white shadow-sm"
                                : "bg-[#f5f7fa] text-[#475569] hover:bg-[#e2e8f0]"
                            }`}
                          >
                            {role === "primary" ? "Primario" : role === "backup" ? "Respaldo" : "Balanceo"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Gateway input */}
                    {!wan.gateway && (
                      <div className="mt-3">
                        <label className="text-[10px] font-medium text-[#94a3b8]">GATEWAY (requerido para LB/Failover)</label>
                        <input
                          type="text"
                          placeholder="ej: 192.168.1.1"
                          className="mt-1 w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-xs text-[#0f172a] focus:border-[#006fff] focus:outline-none"
                          onBlur={e => updateWanField(wan.id, "gateway", e.target.value)}
                        />
                      </div>
                    )}

                    {/* Speed Test */}
                    <div className="mt-3">
                      {speedTests[wan.id] ? (
                        <SpeedTestCard result={speedTests[wan.id]} onRetest={() => runSpeedTest(wan)} testing={testingWan === wan.id} />
                      ) : (
                        <button
                          onClick={() => runSpeedTest(wan)}
                          disabled={!mikrotikConnected || testingWan !== null}
                          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-xs font-medium text-[#475569] transition-all hover:border-[#006fff] hover:text-[#006fff] disabled:opacity-50"
                        >
                          {testingWan === wan.id
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Midiendo velocidad...</>
                            : <><Gauge className="h-3.5 w-3.5" />Speed Test</>
                          }
                        </button>
                      )}
                    </div>

                    {/* Starlink warning */}
                    {wan.isp === "starlink" && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#fffbeb] px-3 py-2">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#f59e0b] mt-0.5" />
                        <div>
                          <p className="text-[10px] font-medium text-[#92400e]">Politica de uso justo</p>
                          <p className="text-[10px] text-[#a16207]">Starlink puede reducir velocidad con alto consumo. Se recomienda usar como respaldo, no balanceo activo.</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add WAN card */}
              <button onClick={detectWan} disabled={detecting} className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#e2e8f0] bg-[#f8fafc] p-8 text-[#94a3b8] transition-all hover:border-[#006fff] hover:text-[#006fff]">
                <Plus className="h-8 w-8" />
                <p className="mt-2 text-sm font-medium">{detecting ? "Detectando..." : "Agregar WAN"}</p>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB: BALANCEO                                                     */}
      {/* ================================================================= */}
      {tab === "balanceo" && multiWan && (
        <div className="space-y-5">
          {/* Status banner */}
          <div className={`flex items-center gap-3 rounded-2xl border p-4 ${
            wanStatus?.load_balance_active ? "border-[#16a34a]/20 bg-[#f0fdf4]" : "border-[#e2e8f0] bg-white"
          }`}>
            <ArrowLeftRight className={`h-5 w-5 ${wanStatus?.load_balance_active ? "text-[#16a34a]" : "text-[#94a3b8]"}`} />
            <div className="flex-1">
              <p className="text-sm font-medium text-[#0f172a]">
                Load Balance PCC
                {wanStatus?.load_balance_active && <span className="ml-2 text-xs text-[#16a34a]">ACTIVO ({wanStatus.lb_rules_count} reglas)</span>}
              </p>
              <p className="text-xs text-[#475569]">
                Per Connection Classifier — distribuye trafico por IP de cliente, mantiene sesiones sticky
              </p>
            </div>
          </div>

          {/* Visual: WAN distribution */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-4">Distribucion de trafico</h3>
            <div className="flex gap-1 rounded-lg overflow-hidden h-8">
              {savedWans.filter(w => w.role !== "backup").map((wan, idx) => {
                const isp = getIsp(wan.isp);
                const activeWans = savedWans.filter(w => w.role !== "backup").length;
                const pct = Math.round(100 / activeWans);
                return (
                  <div
                    key={wan.id}
                    className="flex items-center justify-center text-white text-xs font-bold"
                    style={{ width: `${pct}%`, backgroundColor: isp.color }}
                  >
                    {isp.label} {pct}%
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-[#94a3b8]">PCC distribuye equitativamente por IP origen. Cada cliente usa siempre la misma WAN.</p>

            {savedWans.some(w => w.role === "backup") && (
              <div className="mt-3 flex items-center gap-2 text-xs text-[#f59e0b]">
                <ShieldCheck className="h-3.5 w-3.5" />
                {savedWans.filter(w => w.role === "backup").map(w => getIsp(w.isp).label).join(", ")} como respaldo (no participa en balanceo)
              </div>
            )}
          </div>

          {/* WAN list for LB */}
          <div className="space-y-2">
            {savedWans.map(wan => {
              const isp = getIsp(wan.isp);
              const I = isp.icon;
              return (
                <div key={wan.id} className="flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 shadow-sm">
                  <div className="rounded-lg p-2" style={{ backgroundColor: `${isp.color}12`, color: isp.color }}>
                    <I className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0f172a]">{isp.label} — {wan.interface_name}</p>
                    <p className="text-[11px] text-[#94a3b8]">Gateway: {wan.gateway || "sin configurar"}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    wan.role === "primary" ? "bg-[#f0fdf4] text-[#16a34a]" :
                    wan.role === "loadbalance" ? "bg-[#eff6ff] text-[#006fff]" :
                    "bg-[#fffbeb] text-[#f59e0b]"
                  }`}>
                    {wan.role === "primary" ? "PRIMARIO" : wan.role === "loadbalance" ? "BALANCEO" : "RESPALDO"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={applyLoadBalance}
              disabled={!mikrotikConnected || !!applying || savedWans.some(w => !w.gateway && w.role !== "backup")}
              className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] disabled:opacity-50"
            >
              {applying === "lb"
                ? <><Loader2 className="h-4 w-4 animate-spin" />Aplicando...</>
                : <><Zap className="h-4 w-4" />{wanStatus?.load_balance_active ? "Reconfigurar" : "Activar"} Load Balance</>
              }
            </button>
            {wanStatus?.load_balance_active && (
              <button
                onClick={() => removeConfig("loadbalance")}
                disabled={!!applying}
                className="flex items-center gap-2 rounded-xl bg-[#fef2f2] px-4 py-2.5 text-sm font-medium text-[#dc2626] hover:bg-[#fee2e2] disabled:opacity-50"
              >
                {applying === "rm-loadbalance" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Desactivar
              </button>
            )}
          </div>

          {!savedWans.every(w => w.gateway) && (
            <p className="text-xs text-[#f59e0b] flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Configura el gateway de cada WAN para activar el balanceo
            </p>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB: FAILOVER                                                     */}
      {/* ================================================================= */}
      {tab === "failover" && multiWan && (
        <div className="space-y-5">
          {/* Status banner */}
          <div className={`flex items-center gap-3 rounded-2xl border p-4 ${
            wanStatus?.failover_active ? "border-[#16a34a]/20 bg-[#f0fdf4]" : "border-[#e2e8f0] bg-white"
          }`}>
            <ShieldCheck className={`h-5 w-5 ${wanStatus?.failover_active ? "text-[#16a34a]" : "text-[#94a3b8]"}`} />
            <div className="flex-1">
              <p className="text-sm font-medium text-[#0f172a]">
                Failover Automatico
                {wanStatus?.failover_active && <span className="ml-2 text-xs text-[#16a34a]">ACTIVO ({wanStatus.netwatch_count} monitores)</span>}
              </p>
              <p className="text-xs text-[#475569]">
                Si la WAN primaria falla, el trafico cambia automaticamente al respaldo via Netwatch
              </p>
            </div>
          </div>

          {/* Failover chain visualization */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-4">Cadena de failover</h3>
            <div className="flex items-center gap-3">
              {savedWans
                .sort((a, b) => a.role === "primary" ? -1 : b.role === "primary" ? 1 : 0)
                .map((wan, idx) => {
                  const isp = getIsp(wan.isp);
                  const I = isp.icon;
                  const status = wanStatus?.wan_lines.find(s => s.interface_name === wan.interface_name);
                  return (
                    <div key={wan.id} className="flex items-center gap-3">
                      {idx > 0 && (
                        <div className="flex flex-col items-center">
                          <div className="h-px w-8 bg-[#e2e8f0]" />
                          <span className="text-[8px] text-[#94a3b8]">FALLO</span>
                          <div className="h-px w-8 bg-[#e2e8f0]" />
                        </div>
                      )}
                      <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 ${
                        wan.role === "primary" ? "border-[#16a34a]/30 bg-[#f0fdf4]" : "border-[#e2e8f0] bg-[#f8fafc]"
                      }`}>
                        <div className="rounded-lg p-1.5" style={{ backgroundColor: `${isp.color}12`, color: isp.color }}>
                          <I className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-[#0f172a]">{isp.label}</p>
                          <p className="text-[10px] text-[#94a3b8]">{wan.role === "primary" ? "Primario" : `Backup ${idx}`}</p>
                        </div>
                        <span className={`h-2 w-2 rounded-full ${status?.running ? "bg-[#16a34a]" : "bg-[#dc2626]"}`} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Failover config per WAN */}
          <div className="space-y-3">
            {savedWans.filter(w => w.role === "primary").map(wan => (
              <div key={wan.id} className="rounded-xl border border-[#16a34a]/20 bg-[#f0fdf4] px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[#0f172a]">{getIsp(wan.isp).label} — Primario</p>
                  <span className="rounded-full bg-[#16a34a] px-2 py-0.5 text-[10px] font-bold text-white">d=1</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#94a3b8]">Ping target</label>
                    <input
                      type="text"
                      defaultValue={wan.ping_target || "8.8.8.8"}
                      className="mt-0.5 w-full rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs"
                      onBlur={e => updateWanField(wan.id, "ping_target", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#94a3b8]">Check interval</label>
                    <input
                      type="text"
                      defaultValue={wan.check_interval || "10s"}
                      className="mt-0.5 w-full rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs"
                      onBlur={e => updateWanField(wan.id, "check_interval", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}

            {savedWans.filter(w => w.role === "backup").map((wan, idx) => (
              <div key={wan.id} className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[#0f172a]">{getIsp(wan.isp).label} — Respaldo {idx + 1}</p>
                  <span className="rounded-full bg-[#f59e0b] px-2 py-0.5 text-[10px] font-bold text-white">d={10 + idx}</span>
                </div>
                {wan.isp === "starlink" && (
                  <div className="mt-2">
                    <label className="text-[10px] text-[#94a3b8]">Limite de ancho de banda (proteccion Fair Use)</label>
                    <div className="mt-0.5 flex gap-2">
                      <input
                        type="text"
                        defaultValue={wan.bandwidth_limit || ""}
                        placeholder="ej: 50M/50M"
                        className="flex-1 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-1.5 text-xs"
                        onBlur={e => updateWanField(wan.id, "bandwidth_limit", e.target.value)}
                      />
                      <span className="self-center text-[10px] text-[#94a3b8]">upload/download</span>
                    </div>
                    <p className="mt-1 text-[10px] text-[#f59e0b]">Recomendado: Limitar a 50M para evitar throttling por uso excesivo</p>
                  </div>
                )}
              </div>
            ))}

            {savedWans.filter(w => w.role === "loadbalance").length > 0 && (
              <div className="rounded-lg bg-[#fffbeb] px-3 py-2">
                <p className="text-xs text-[#92400e]">
                  <AlertTriangle className="inline h-3 w-3 mr-1" />
                  WANs en modo "Balanceo" no participan en failover. Cambia su rol a "Primario" o "Respaldo".
                </p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={applyFailover}
              disabled={
                !mikrotikConnected || !!applying ||
                !savedWans.some(w => w.role === "primary") ||
                !savedWans.some(w => w.role === "backup") ||
                savedWans.some(w => !w.gateway)
              }
              className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] disabled:opacity-50"
            >
              {applying === "failover"
                ? <><Loader2 className="h-4 w-4 animate-spin" />Aplicando...</>
                : <><Zap className="h-4 w-4" />{wanStatus?.failover_active ? "Reconfigurar" : "Activar"} Failover</>
              }
            </button>
            {wanStatus?.failover_active && (
              <button
                onClick={() => removeConfig("failover")}
                disabled={!!applying}
                className="flex items-center gap-2 rounded-xl bg-[#fef2f2] px-4 py-2.5 text-sm font-medium text-[#dc2626] hover:bg-[#fee2e2] disabled:opacity-50"
              >
                {applying === "rm-failover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Desactivar
              </button>
            )}
          </div>

          {!savedWans.every(w => w.gateway) && (
            <p className="text-xs text-[#f59e0b] flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Configura el gateway de cada WAN en la pestana "Conexiones"
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpeedTestCard sub-component
// ---------------------------------------------------------------------------
function SpeedTestCard({ result, onRetest, testing }: {
  result: SpeedTestResult;
  onRetest: () => void;
  testing: boolean;
}) {
  const qualityColors: Record<string, { bg: string; text: string }> = {
    excelente: { bg: "bg-[#f0fdf4]", text: "text-[#16a34a]" },
    bueno: { bg: "bg-[#eff6ff]", text: "text-[#006fff]" },
    aceptable: { bg: "bg-[#fffbeb]", text: "text-[#f59e0b]" },
    bajo: { bg: "bg-[#fff7ed]", text: "text-[#ea580c]" },
    critico: { bg: "bg-[#fef2f2]", text: "text-[#dc2626]" },
    alto: { bg: "bg-[#fef2f2]", text: "text-[#dc2626]" },
  };

  const dlQ = qualityColors[result.quality] ?? qualityColors.aceptable;
  const pingQ = qualityColors[result.latency_quality] ?? qualityColors.aceptable;

  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#475569]">Speed Test</p>
        <button
          onClick={onRetest}
          disabled={testing}
          className="flex items-center gap-1 text-[10px] text-[#006fff] hover:underline disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Re-test
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* Download */}
        <div className="rounded-lg bg-white p-2.5 shadow-sm text-center">
          <ArrowDown className="mx-auto h-4 w-4 text-[#16a34a]" />
          <p className="mt-1 text-lg font-bold text-[#0f172a]">{result.download.mbps}</p>
          <p className="text-[10px] text-[#94a3b8]">Mbps bajada</p>
          <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[8px] font-bold ${dlQ.bg} ${dlQ.text}`}>
            {result.quality}
          </span>
        </div>

        {/* Upload */}
        <div className="rounded-lg bg-white p-2.5 shadow-sm text-center">
          <ArrowUp className="mx-auto h-4 w-4 text-[#006fff]" />
          <p className="mt-1 text-lg font-bold text-[#0f172a]">{result.upload.mbps}</p>
          <p className="text-[10px] text-[#94a3b8]">Mbps subida</p>
          {result.upload.status === "estimated" && (
            <span className="mt-1 inline-block text-[8px] text-[#94a3b8]">estimado</span>
          )}
        </div>

        {/* Latency */}
        <div className="rounded-lg bg-white p-2.5 shadow-sm text-center">
          <Timer className="mx-auto h-4 w-4 text-[#f59e0b]" />
          <p className="mt-1 text-lg font-bold text-[#0f172a]">{result.ping.avg_ms}</p>
          <p className="text-[10px] text-[#94a3b8]">ms latencia</p>
          <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[8px] font-bold ${pingQ.bg} ${pingQ.text}`}>
            {result.latency_quality}
          </span>
        </div>
      </div>

      {/* Extra details */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-[#94a3b8]">
        <span>Ping: {result.ping.min_ms}-{result.ping.max_ms}ms | Loss: {result.ping.loss_pct}%</span>
        {result.download.duration_secs > 0 && (
          <span>{formatBytes(String(result.download.bytes))} en {result.download.duration_secs}s</span>
        )}
      </div>
    </div>
  );
}
