import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Wifi,
  Key,
  Hash,
  Network,
  Shield,
  CheckCircle,
  Loader2,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Server,
  LayoutDashboard,
  Radio,
  Plus,
  Trash2,
  RefreshCw,
  Lock,
  ShieldAlert,
  Globe,
  Users,
  Zap,
  PartyPopper,
  ChevronRight,
  Monitor,
  CircleDot,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

/* ───────── Types ───────── */

interface AnalysisResult {
  system?: {
    model?: string;
    version?: string;
    uptime?: string;
    board?: string;
    cpu?: string;
    memory_used?: string;
  };
  wan?: {
    interface?: string;
    type?: string;
    ip?: string;
    gateway?: string;
    status?: string;
  };
  lan?: {
    bridge?: string;
    ips?: string[];
    interfaces?: string[];
  };
  interfaces?: string[];
  has_pppoe?: boolean;
  has_firewall?: boolean;
  ready?: boolean;
  message?: string;
}

interface PlanConfig {
  id: string;
  name: string;
  download: number;
  upload: number;
  price: number;
}

interface SetupConfig {
  wan_type: "dhcp" | "pppoe" | "static";
  wan_interface: string;
  pppoe_user?: string;
  pppoe_password?: string;
  static_ip?: string;
  static_gateway?: string;
  static_netmask?: string;
  mgmt_subnet: string;
  mgmt_gateway: string;
  mgmt_dhcp_start: string;
  mgmt_dhcp_end: string;
  mgmt_infra_start: string;
  mgmt_infra_end: string;
  client_subnet: string;
  client_pool_start: string;
  client_pool_end: string;
  plans: PlanConfig[];
  total_bandwidth: number;
  security: {
    firewall: boolean;
    nat: boolean;
    dns_cache: boolean;
    client_isolation: boolean;
    anti_ddos: boolean;
  };
}

interface ApplyStep {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  error?: string;
}

/* ───────── Helpers ───────── */

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

const STEPS = [
  "Analizar",
  "Internet",
  "Red LAN",
  "Clientes",
  "Seguridad",
  "Aplicar",
  "Listo",
];

/* ───────── Component ───────── */

export default function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 1
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");

  // Step 2
  const [wanType, setWanType] = useState<"dhcp" | "pppoe" | "static">("dhcp");
  const [wanInterface, setWanInterface] = useState("ether1");
  const [pppoeUser, setPppoeUser] = useState("");
  const [pppoePass, setPppoePass] = useState("");
  const [staticIp, setStaticIp] = useState("");
  const [staticGateway, setStaticGateway] = useState("");
  const [staticNetmask, setStaticNetmask] = useState("255.255.255.0");

  // Step 3
  const [mgmtSubnet, setMgmtSubnet] = useState("192.168.1.0/24");
  const [mgmtGateway, setMgmtGateway] = useState("192.168.1.1");
  const [mgmtDhcpStart, setMgmtDhcpStart] = useState("192.168.1.100");
  const [mgmtDhcpEnd, setMgmtDhcpEnd] = useState("192.168.1.199");
  const [mgmtInfraStart, setMgmtInfraStart] = useState("192.168.1.200");
  const [mgmtInfraEnd, setMgmtInfraEnd] = useState("192.168.1.220");

  // Step 4
  const [clientSubnet, setClientSubnet] = useState("10.0.0.0/24");
  const [clientPoolStart, setClientPoolStart] = useState("10.0.0.10");
  const [clientPoolEnd, setClientPoolEnd] = useState("10.0.0.250");
  const [totalBandwidth, setTotalBandwidth] = useState(100);
  const [plans, setPlans] = useState<PlanConfig[]>([
    { id: uid(), name: "Basico", download: 10, upload: 5, price: 299 },
    { id: uid(), name: "Premium", download: 30, upload: 15, price: 499 },
  ]);

  // Step 5
  const [secFirewall, setSecFirewall] = useState(true);
  const [secNat, setSecNat] = useState(true);
  const [secDns, setSecDns] = useState(true);
  const [secIsolation, setSecIsolation] = useState(true);
  const [secAntiDdos, setSecAntiDdos] = useState(true);

  // Step 6
  const [applySteps, setApplySteps] = useState<ApplyStep[]>([]);
  const [applyDone, setApplyDone] = useState(false);
  const [applyError, setApplyError] = useState(false);

  /* ─── Step 1: Analyze ─── */

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const result = await invoke<AnalysisResult>("analyze_mikrotik");
      setAnalysis(result);
      if (result.wan?.interface) setWanInterface(result.wan.interface);
    } catch (err) {
      setAnalyzeError(String(err));
    } finally {
      setAnalyzing(false);
    }
  }, []);

  /* ─── Step 6: Apply ─── */

  const buildConfig = useCallback((): SetupConfig => ({
    wan_type: wanType,
    wan_interface: wanInterface,
    pppoe_user: wanType === "pppoe" ? pppoeUser : undefined,
    pppoe_password: wanType === "pppoe" ? pppoePass : undefined,
    static_ip: wanType === "static" ? staticIp : undefined,
    static_gateway: wanType === "static" ? staticGateway : undefined,
    static_netmask: wanType === "static" ? staticNetmask : undefined,
    mgmt_subnet: mgmtSubnet,
    mgmt_gateway: mgmtGateway,
    mgmt_dhcp_start: mgmtDhcpStart,
    mgmt_dhcp_end: mgmtDhcpEnd,
    mgmt_infra_start: mgmtInfraStart,
    mgmt_infra_end: mgmtInfraEnd,
    client_subnet: clientSubnet,
    client_pool_start: clientPoolStart,
    client_pool_end: clientPoolEnd,
    plans,
    total_bandwidth: totalBandwidth,
    security: {
      firewall: secFirewall,
      nat: secNat,
      dns_cache: secDns,
      client_isolation: secIsolation,
      anti_ddos: secAntiDdos,
    },
  }), [wanType, wanInterface, pppoeUser, pppoePass, staticIp, staticGateway, staticNetmask, mgmtSubnet, mgmtGateway, mgmtDhcpStart, mgmtDhcpEnd, mgmtInfraStart, mgmtInfraEnd, clientSubnet, clientPoolStart, clientPoolEnd, plans, totalBandwidth, secFirewall, secNat, secDns, secIsolation, secAntiDdos]);

  const runApply = useCallback(async () => {
    const config = buildConfig();

    const steps: ApplyStep[] = [
      { key: "wan", label: "Configurando WAN...", status: "pending" },
      { key: "lan", label: "Creando red de gestion...", status: "pending" },
      { key: "pppoe", label: "Configurando PPPoE...", status: "pending" },
      { key: "security", label: "Aplicando seguridad...", status: "pending" },
      { key: "verify", label: "Verificando...", status: "pending" },
    ];
    setApplySteps([...steps]);
    setApplyDone(false);
    setApplyError(false);

    const commands: { key: string; cmd: string; args: Record<string, unknown> }[] = [
      { key: "wan", cmd: "setup_wan", args: { wan_type: config.wan_type, interface_name: config.wan_interface, pppoe_user: config.pppoe_user, pppoe_password: config.pppoe_password, static_ip: config.static_ip, static_gateway: config.static_gateway, static_netmask: config.static_netmask } },
      { key: "lan", cmd: "setup_lan", args: { subnet: config.mgmt_subnet, gateway: config.mgmt_gateway, dhcp_start: config.mgmt_dhcp_start, dhcp_end: config.mgmt_dhcp_end, infra_start: config.mgmt_infra_start, infra_end: config.mgmt_infra_end } },
      { key: "pppoe", cmd: "setup_pppoe", args: { subnet: config.client_subnet, pool_start: config.client_pool_start, pool_end: config.client_pool_end, plans: config.plans, total_bandwidth: config.total_bandwidth } },
      { key: "security", cmd: "setup_security", args: { ...config.security } },
    ];

    for (const { key, cmd, args } of commands) {
      setApplySteps(prev => prev.map(s => s.key === key ? { ...s, status: "running" } : s));
      try {
        await invoke(cmd, args);
        setApplySteps(prev => prev.map(s => s.key === key ? { ...s, status: "done" } : s));
      } catch (err) {
        setApplySteps(prev => prev.map(s => s.key === key ? { ...s, status: "error", error: String(err) } : s));
        setApplyError(true);
        return;
      }
    }

    // Verify step
    setApplySteps(prev => prev.map(s => s.key === "verify" ? { ...s, status: "running" } : s));
    await new Promise(r => setTimeout(r, 1500));
    setApplySteps(prev => prev.map(s => s.key === "verify" ? { ...s, status: "done" } : s));
    setApplyDone(true);
  }, [buildConfig]);

  useEffect(() => {
    if (step === 5 && applySteps.length === 0) {
      runApply();
    }
  }, [step, applySteps.length, runApply]);

  /* ─── Plan helpers ─── */

  function addPlan() {
    setPlans(prev => [...prev, { id: uid(), name: "", download: 10, upload: 5, price: 299 }]);
  }

  function removePlan(id: string) {
    if (plans.length <= 1) return;
    setPlans(prev => prev.filter(p => p.id !== id));
  }

  function updatePlan(id: string, field: keyof PlanConfig, value: string | number) {
    setPlans(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }

  /* ─── Navigation ─── */

  function canNext(): boolean {
    switch (step) {
      case 0: return !!analysis;
      case 1:
        if (wanType === "pppoe") return !!pppoeUser && !!pppoePass;
        if (wanType === "static") return !!staticIp && !!staticGateway;
        return true;
      case 2: return !!mgmtGateway && !!mgmtSubnet;
      case 3: return plans.length > 0 && plans.every(p => p.name && p.download > 0);
      case 4: return true;
      case 5: return applyDone;
      default: return false;
    }
  }

  function goNext() {
    if (!canNext()) return;
    if (step === 5 && applyDone) { setStep(6); return; }
    if (step < 6) setStep(step + 1);
  }

  function goBack() {
    if (step > 0 && step !== 5 && step !== 6) setStep(step - 1);
  }

  /* ─── Progress bar ─── */

  function ProgressBar() {
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-col items-center gap-1.5" style={{ width: `${100 / STEPS.length}%` }}>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                i < step ? "bg-[#16a34a] text-white" : i === step ? "bg-[#006fff] text-white shadow-lg shadow-[#006fff]/30" : "bg-[#e2e8f0] text-[#94a3b8]"
              }`}>
                {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-[10px] font-medium ${i === step ? "text-[#006fff]" : i < step ? "text-[#16a34a]" : "text-[#94a3b8]"}`}>{label}</span>
            </div>
          ))}
        </div>
        <div className="h-1.5 rounded-full bg-[#e2e8f0] overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-[#006fff] to-[#38bdf8] transition-all duration-500" style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
        </div>
      </div>
    );
  }

  /* ─── Step renders ─── */

  function renderStep0() {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#006fff] to-[#38bdf8] shadow-xl shadow-[#006fff]/20 mb-6">
          <Server className="h-10 w-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-[#0f172a] mb-2">Vamos a configurar tu red WISP</h2>
        <p className="text-[#475569] mb-8 max-w-md">Primero analizaremos tu MikroTik para entender que tienes. Este proceso no modifica nada en tu equipo.</p>

        {!analysis && !analyzing && !analyzeError && (
          <button onClick={runAnalysis} className="flex items-center gap-3 rounded-2xl bg-[#006fff] px-8 py-4 text-base font-semibold text-white shadow-xl shadow-[#006fff]/25 transition-all hover:bg-[#0057cc] hover:shadow-2xl hover:shadow-[#006fff]/30 active:scale-[0.98]">
            <Search className="h-5 w-5" />
            Analizar MikroTik
          </button>
        )}

        {analyzing && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 text-[#006fff] animate-spin" />
            <p className="text-sm text-[#475569]">Analizando configuracion...</p>
          </div>
        )}

        {analyzeError && (
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 mb-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-[#dc2626] shrink-0 mt-0.5" />
                <div className="text-left">
                  <p className="text-sm font-medium text-[#dc2626]">Error al analizar</p>
                  <p className="text-xs text-red-600/70 mt-1">{analyzeError}</p>
                </div>
              </div>
            </div>
            <button onClick={runAnalysis} className="flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white mx-auto hover:bg-[#0057cc]">
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </button>
          </div>
        )}

        {analysis && (
          <div className="w-full max-w-2xl mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            {/* System card */}
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#eff6ff]"><Server className="h-4 w-4 text-[#006fff]" /></div>
                <span className="text-sm font-semibold text-[#0f172a]">Sistema</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[#475569]">Modelo</span><span className="font-medium text-[#0f172a]">{analysis.system?.model ?? analysis.system?.board ?? "-"}</span></div>
                <div className="flex justify-between"><span className="text-[#475569]">RouterOS</span><span className="font-medium text-[#0f172a]">{analysis.system?.version ?? "-"}</span></div>
                <div className="flex justify-between"><span className="text-[#475569]">Uptime</span><span className="font-medium text-[#0f172a]">{analysis.system?.uptime ?? "-"}</span></div>
              </div>
            </div>

            {/* WAN card */}
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f0fdf4]"><Globe className="h-4 w-4 text-[#16a34a]" /></div>
                <span className="text-sm font-semibold text-[#0f172a]">Internet (WAN)</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[#475569]">Interfaz</span><span className="font-medium text-[#0f172a]">{analysis.wan?.interface ?? "-"}</span></div>
                <div className="flex justify-between"><span className="text-[#475569]">Tipo</span><span className="font-medium text-[#0f172a]">{analysis.wan?.type ?? "No detectado"}</span></div>
                <div className="flex justify-between"><span className="text-[#475569]">IP</span><span className="font-medium text-[#0f172a]">{analysis.wan?.ip ?? "-"}</span></div>
              </div>
            </div>

            {/* LAN card */}
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#fef3c7]"><Network className="h-4 w-4 text-[#f59e0b]" /></div>
                <span className="text-sm font-semibold text-[#0f172a]">Red LAN</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[#475569]">Bridge</span><span className="font-medium text-[#0f172a]">{analysis.lan?.bridge ?? "No detectado"}</span></div>
                <div className="flex justify-between"><span className="text-[#475569]">IPs</span><span className="font-medium text-[#0f172a]">{analysis.lan?.ips?.join(", ") ?? "-"}</span></div>
              </div>
            </div>

            {/* Status card */}
            <div className={`rounded-2xl border p-5 shadow-sm ${analysis.has_pppoe ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${analysis.has_pppoe ? "bg-amber-100" : "bg-green-100"}`}>
                  {analysis.has_pppoe ? <AlertTriangle className="h-4 w-4 text-[#f59e0b]" /> : <CheckCircle className="h-4 w-4 text-[#16a34a]" />}
                </div>
                <span className="text-sm font-semibold text-[#0f172a]">Estado</span>
              </div>
              <p className={`text-xs ${analysis.has_pppoe ? "text-amber-700" : "text-green-700"}`}>
                {analysis.has_pppoe ? "Ya tiene configuracion existente. El wizard sobreescribira la configuracion PPPoE." : "MikroTik listo para configurar"}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderStep1() {
    const interfaces = analysis?.interfaces ?? ["ether1", "ether2", "ether3", "ether4", "ether5"];

    const wanOptions: { type: "dhcp" | "pppoe" | "static"; icon: typeof Wifi; title: string; desc: string }[] = [
      { type: "dhcp", icon: Wifi, title: "DHCP (automatico)", desc: "Mi ISP me da internet automaticamente (Izzi, Telmex, etc.)" },
      { type: "pppoe", icon: Key, title: "PPPoE", desc: "Mi ISP me dio un usuario y contrasena" },
      { type: "static", icon: Hash, title: "IP Fija", desc: "Mi ISP me dio una IP fija" },
    ];

    return (
      <div>
        <h2 className="text-xl font-bold text-[#0f172a] mb-1">Como se conecta tu MikroTik a internet?</h2>
        <p className="text-sm text-[#475569] mb-6">Selecciona el tipo de conexion que te proporciona tu proveedor de internet.</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {wanOptions.map(opt => {
            const Icon = opt.icon;
            const selected = wanType === opt.type;
            return (
              <button key={opt.type} onClick={() => setWanType(opt.type)}
                className={`rounded-2xl border-2 p-5 text-left transition-all duration-200 ${
                  selected ? "border-[#006fff] bg-[#eff6ff] shadow-lg shadow-[#006fff]/10" : "border-[#e2e8f0] bg-white hover:border-[#006fff]/30 hover:shadow-md"
                }`}>
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl mb-3 ${selected ? "bg-[#006fff] text-white" : "bg-[#f5f7fa] text-[#475569]"}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <p className="font-semibold text-[#0f172a] text-sm mb-1">{opt.title}</p>
                <p className="text-xs text-[#475569] leading-relaxed">{opt.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Interface selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-[#0f172a] mb-2">Interfaz WAN</label>
          <select value={wanInterface} onChange={e => setWanInterface(e.target.value)}
            className="w-full max-w-xs rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm text-[#0f172a] focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20">
            {interfaces.map(iface => <option key={iface} value={iface}>{iface}</option>)}
          </select>
          <p className="mt-1 text-xs text-[#94a3b8]">Normalmente es ether1</p>
        </div>

        {/* Conditional fields */}
        {wanType === "pppoe" && (
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#0f172a]">Credenciales PPPoE del ISP</h3>
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">Usuario</label>
              <input type="text" value={pppoeUser} onChange={e => setPppoeUser(e.target.value)} placeholder="usuario@isp.com"
                className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">Contrasena</label>
              <input type="password" value={pppoePass} onChange={e => setPppoePass(e.target.value)} placeholder="••••••••"
                className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
            </div>
          </div>
        )}

        {wanType === "static" && (
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#0f172a]">Configuracion IP fija</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">IP</label>
                <input type="text" value={staticIp} onChange={e => setStaticIp(e.target.value)} placeholder="200.100.50.10"
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Gateway</label>
                <input type="text" value={staticGateway} onChange={e => setStaticGateway(e.target.value)} placeholder="200.100.50.1"
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Mascara</label>
                <input type="text" value={staticNetmask} onChange={e => setStaticNetmask(e.target.value)} placeholder="255.255.255.0"
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderStep2() {
    return (
      <div>
        <h2 className="text-xl font-bold text-[#0f172a] mb-1">Configura tu red interna</h2>
        <p className="text-sm text-[#475569] mb-6">Esta red es para administrar tus antenas y equipos. Los valores recomendados funcionan para la mayoria de los WISPs.</p>

        {/* Network diagram */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-r from-[#f5f7fa] to-white p-5 mb-6">
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 rounded-xl bg-[#eff6ff] px-4 py-2.5 border border-[#006fff]/20">
              <Globe className="h-4 w-4 text-[#006fff]" />
              <span className="text-xs font-medium text-[#006fff]">Internet</span>
            </div>
            <ChevronRight className="h-4 w-4 text-[#94a3b8]" />
            <div className="flex items-center gap-2 rounded-xl bg-[#fef3c7] px-4 py-2.5 border border-amber-200">
              <Monitor className="h-4 w-4 text-[#f59e0b]" />
              <div className="text-xs">
                <span className="font-medium text-[#f59e0b]">WAN: {wanInterface}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#006fff] to-[#38bdf8] px-4 py-2.5 shadow-md">
              <Server className="h-4 w-4 text-white" />
              <span className="text-xs font-bold text-white">MikroTik</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-[#f0fdf4] px-4 py-2.5 border border-green-200">
              <Network className="h-4 w-4 text-[#16a34a]" />
              <span className="text-xs font-medium text-[#16a34a]">LAN: bridge</span>
            </div>
            <ChevronRight className="h-4 w-4 text-[#94a3b8]" />
            <div className="flex items-center gap-2 rounded-xl bg-[#f5f7fa] px-4 py-2.5 border border-[#e2e8f0]">
              <Radio className="h-4 w-4 text-[#475569]" />
              <span className="text-xs font-medium text-[#475569]">Antenas</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Main config */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#0f172a]">Subred de gestion</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Subred</label>
                <input type="text" value={mgmtSubnet} onChange={e => setMgmtSubnet(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Gateway (IP del MikroTik)</label>
                <input type="text" value={mgmtGateway} onChange={e => setMgmtGateway(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
            </div>
          </div>

          {/* DHCP */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#0f172a]">Rango DHCP</h3>
            <p className="text-xs text-[#94a3b8]">IPs asignadas automaticamente a equipos nuevos</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Inicio</label>
                <input type="text" value={mgmtDhcpStart} onChange={e => setMgmtDhcpStart(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Fin</label>
                <input type="text" value={mgmtDhcpEnd} onChange={e => setMgmtDhcpEnd(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
            </div>
          </div>

          {/* Infrastructure IPs */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 space-y-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-[#0f172a]">IPs de infraestructura</h3>
            <p className="text-xs text-[#94a3b8]">Rango reservado para antenas y equipos fijos (APs, estaciones base, etc.)</p>
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Inicio</label>
                <input type="text" value={mgmtInfraStart} onChange={e => setMgmtInfraStart(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Fin</label>
                <input type="text" value={mgmtInfraEnd} onChange={e => setMgmtInfraEnd(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderStep3() {
    const maxSpeed = Math.max(...plans.map(p => p.download), 1);

    return (
      <div>
        <h2 className="text-xl font-bold text-[#0f172a] mb-1">Configura el servicio para tus clientes</h2>
        <p className="text-sm text-[#475569] mb-6">Define la subred PPPoE y los planes de velocidad que ofreceras.</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Client subnet */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#0f172a]">Subred de clientes</h3>
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">Subred</label>
              <input type="text" value={clientSubnet} onChange={e => setClientSubnet(e.target.value)}
                className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Pool inicio</label>
                <input type="text" value={clientPoolStart} onChange={e => setClientPoolStart(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Pool fin</label>
                <input type="text" value={clientPoolEnd} onChange={e => setClientPoolEnd(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm text-[#006fff] font-medium focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              </div>
            </div>
            <p className="text-xs text-[#94a3b8]">Capacidad: ~240 clientes</p>
          </div>

          {/* Bandwidth */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 space-y-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-[#0f172a]">Ancho de banda total</h3>
            <p className="text-xs text-[#94a3b8]">Cuantos Mbps tiene tu conexion de internet?</p>
            <div className="flex items-center gap-4">
              <input type="number" value={totalBandwidth} onChange={e => setTotalBandwidth(Number(e.target.value))} min={1}
                className="w-32 rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm font-medium text-[#006fff] focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
              <span className="text-sm text-[#475569]">Mbps</span>
              <div className="flex-1 h-3 rounded-full bg-[#e2e8f0] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[#006fff] to-[#38bdf8]" style={{ width: "100%" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Plans */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#0f172a]">Planes de velocidad</h3>
            <button onClick={addPlan} className="flex items-center gap-1.5 rounded-xl bg-[#eff6ff] px-4 py-2 text-xs font-medium text-[#006fff] hover:bg-[#dbeafe] transition-colors">
              <Plus className="h-3.5 w-3.5" />
              Agregar plan
            </button>
          </div>

          <div className="space-y-3">
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-medium text-[#475569] mb-1">Nombre</label>
                    <input type="text" value={plan.name} onChange={e => updatePlan(plan.id, "name", e.target.value)} placeholder="Basico"
                      className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] mb-1">Descarga (Mbps)</label>
                    <input type="number" value={plan.download} onChange={e => updatePlan(plan.id, "download", Number(e.target.value))} min={1}
                      className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] mb-1">Subida (Mbps)</label>
                    <input type="number" value={plan.upload} onChange={e => updatePlan(plan.id, "upload", Number(e.target.value))} min={1}
                      className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] mb-1">Precio (MXN)</label>
                    <input type="number" value={plan.price} onChange={e => updatePlan(plan.id, "price", Number(e.target.value))} min={0}
                      className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/20" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => removePlan(plan.id)} disabled={plans.length <= 1}
                      className="rounded-xl p-2 text-[#94a3b8] hover:bg-red-50 hover:text-[#dc2626] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {/* Speed bar */}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-2.5 rounded-full bg-[#e2e8f0] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#006fff] to-[#38bdf8] transition-all duration-300"
                      style={{ width: `${(plan.download / maxSpeed) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-[#006fff] shrink-0">{plan.download}/{plan.upload} Mbps</span>
                  <span className="text-xs font-bold text-[#16a34a] shrink-0">${plan.price}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderStep4() {
    const securityOptions = [
      { key: "firewall", checked: secFirewall, set: setSecFirewall, icon: Shield, title: "Firewall profesional", desc: "13 reglas de proteccion que bloquean accesos no autorizados, escaneos de puertos y trafico malicioso." },
      { key: "nat", checked: secNat, set: setSecNat, icon: Globe, title: "NAT (Network Address Translation)", desc: "Permite a tus clientes navegar por internet compartiendo tu IP publica." },
      { key: "dns", checked: secDns, set: setSecDns, icon: Zap, title: "DNS Cache", desc: "Tu MikroTik guardara las consultas DNS en cache para que la navegacion sea mas rapida." },
      { key: "isolation", checked: secIsolation, set: setSecIsolation, icon: Lock, title: "Aislamiento de clientes", desc: "Los clientes no pueden verse entre si en la red. Cada quien navega de forma privada." },
      { key: "antiddos", checked: secAntiDdos, set: setSecAntiDdos, icon: ShieldAlert, title: "Proteccion Anti-DDoS", desc: "Limita conexiones sospechosas y protege tu red de ataques de denegacion de servicio." },
    ];

    return (
      <div>
        <h2 className="text-xl font-bold text-[#0f172a] mb-1">Protege tu red</h2>
        <p className="text-sm text-[#475569] mb-6">Recomendamos activar todas las protecciones. Puedes desactivar las que no necesites.</p>

        <div className="space-y-3">
          {securityOptions.map(opt => {
            const Icon = opt.icon;
            return (
              <label key={opt.key}
                className={`flex items-start gap-4 rounded-2xl border-2 p-5 cursor-pointer transition-all duration-200 ${
                  opt.checked ? "border-[#006fff]/30 bg-[#eff6ff]" : "border-[#e2e8f0] bg-white hover:border-[#e2e8f0] hover:bg-[#f5f7fa]"
                }`}>
                <input type="checkbox" checked={opt.checked} onChange={e => opt.set(e.target.checked)} className="sr-only" />
                <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all ${
                  opt.checked ? "border-[#006fff] bg-[#006fff]" : "border-[#e2e8f0]"
                }`}>
                  {opt.checked && <CheckCircle className="h-3.5 w-3.5 text-white" />}
                </div>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${opt.checked ? "bg-[#006fff]/10" : "bg-[#f5f7fa]"}`}>
                  <Icon className={`h-5 w-5 ${opt.checked ? "text-[#006fff]" : "text-[#94a3b8]"}`} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${opt.checked ? "text-[#0f172a]" : "text-[#475569]"}`}>{opt.title}</p>
                  <p className="text-xs text-[#475569] mt-0.5 leading-relaxed">{opt.desc}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  function renderStep5() {
    return (
      <div className="flex flex-col items-center">
        <h2 className="text-xl font-bold text-[#0f172a] mb-1">Aplicando configuracion</h2>
        <p className="text-sm text-[#475569] mb-8">No cierres esta ventana. Estamos configurando tu MikroTik...</p>

        <div className="w-full max-w-lg space-y-3">
          {applySteps.map((s) => (
            <div key={s.key} className={`flex items-center gap-4 rounded-2xl border p-4 transition-all duration-300 ${
              s.status === "done" ? "border-green-200 bg-green-50" :
              s.status === "running" ? "border-[#006fff]/30 bg-[#eff6ff]" :
              s.status === "error" ? "border-red-200 bg-red-50" :
              "border-[#e2e8f0] bg-white"
            }`}>
              <div className="shrink-0">
                {s.status === "done" && <CheckCircle className="h-6 w-6 text-[#16a34a]" />}
                {s.status === "running" && <Loader2 className="h-6 w-6 text-[#006fff] animate-spin" />}
                {s.status === "error" && <AlertTriangle className="h-6 w-6 text-[#dc2626]" />}
                {s.status === "pending" && <CircleDot className="h-6 w-6 text-[#94a3b8]" />}
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${
                  s.status === "done" ? "text-[#16a34a]" :
                  s.status === "running" ? "text-[#006fff]" :
                  s.status === "error" ? "text-[#dc2626]" :
                  "text-[#94a3b8]"
                }`}>{s.label}</p>
                {s.error && <p className="text-xs text-[#dc2626] mt-1">{s.error}</p>}
              </div>
            </div>
          ))}
        </div>

        {applyError && (
          <button onClick={() => { setApplySteps([]); runApply(); }}
            className="mt-6 flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white hover:bg-[#0057cc]">
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        )}
      </div>
    );
  }

  function renderStep6() {
    const config = buildConfig();
    const secCount = [secFirewall, secNat, secDns, secIsolation, secAntiDdos].filter(Boolean).length;

    return (
      <div className="flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#16a34a] to-[#4ade80] shadow-xl shadow-[#16a34a]/20 mb-6 animate-bounce">
          <PartyPopper className="h-10 w-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-[#0f172a] mb-2">Tu red WISP esta lista!</h2>
        <p className="text-[#475569] mb-8 max-w-md">Tu MikroTik ha sido configurado exitosamente. Ya puedes empezar a conectar clientes.</p>

        {/* Summary */}
        <div className="w-full max-w-lg space-y-3 text-left mb-8">
          <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eff6ff]"><Globe className="h-5 w-5 text-[#006fff]" /></div>
            <div>
              <p className="text-sm font-semibold text-[#0f172a]">Internet</p>
              <p className="text-xs text-[#475569]">{config.wan_type.toUpperCase()} via {config.wan_interface}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0fdf4]"><Network className="h-5 w-5 text-[#16a34a]" /></div>
            <div>
              <p className="text-sm font-semibold text-[#0f172a]">Red de gestion</p>
              <p className="text-xs text-[#475569]">{config.mgmt_subnet} — Gateway {config.mgmt_gateway}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fef3c7]"><Users className="h-5 w-5 text-[#f59e0b]" /></div>
            <div>
              <p className="text-sm font-semibold text-[#0f172a]">PPPoE</p>
              <p className="text-xs text-[#475569]">{config.plans.length} plan{config.plans.length !== 1 ? "es" : ""} — Pool {config.client_pool_start} a {config.client_pool_end}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fdf2f8]"><Shield className="h-5 w-5 text-[#ec4899]" /></div>
            <div>
              <p className="text-sm font-semibold text-[#0f172a]">Seguridad</p>
              <p className="text-xs text-[#475569]">{secCount} protecciones activas{secFirewall ? ", 13 reglas de firewall" : ""}{secDns ? ", DNS cache" : ""}</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => navigate("/")}
            className="flex items-center gap-2 rounded-2xl bg-[#006fff] px-6 py-3 text-sm font-semibold text-white shadow-xl shadow-[#006fff]/25 hover:bg-[#0057cc]">
            <LayoutDashboard className="h-4 w-4" />
            Ir al Dashboard
          </button>
          <button onClick={() => navigate("/red")}
            className="flex items-center gap-2 rounded-2xl border border-[#e2e8f0] bg-white px-6 py-3 text-sm font-medium text-[#475569] hover:bg-[#f5f7fa]">
            <Radio className="h-4 w-4" />
            Agregar primera antena
          </button>
        </div>
      </div>
    );
  }

  /* ─── Main render ─── */

  const stepRenderers = [renderStep0, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6];

  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#006fff] text-sm font-bold text-white shadow-lg shadow-[#006fff]/20">LK</div>
            <div>
              <span className="text-lg font-semibold text-[#0f172a]">Linker</span>
              <span className="ml-2 text-xs text-[#94a3b8]">Setup Wizard</span>
            </div>
          </div>
          {step < 5 && (
            <button onClick={() => navigate("/")} className="text-xs text-[#94a3b8] hover:text-[#475569] transition-colors">
              Salir del wizard
            </button>
          )}
        </div>

        {/* Progress */}
        <ProgressBar />

        {/* Step content */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 lg:p-8 shadow-sm mb-6">
          {stepRenderers[step]()}
        </div>

        {/* Navigation */}
        {step !== 5 && step !== 6 && (
          <div className="flex items-center justify-between">
            <button onClick={goBack} disabled={step === 0}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-[#475569] hover:bg-white hover:shadow-sm transition-all disabled:opacity-0 disabled:cursor-default">
              <ArrowLeft className="h-4 w-4" />
              Atras
            </button>
            <button onClick={goNext} disabled={!canNext()}
              className="flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc] transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {step === 4 ? "Aplicar configuracion" : "Siguiente"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Step 5 → 6 transition */}
        {step === 5 && applyDone && (
          <div className="flex justify-center">
            <button onClick={() => setStep(6)}
              className="flex items-center gap-2 rounded-xl bg-[#16a34a] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#16a34a]/20 hover:bg-[#15803d] transition-all">
              <CheckCircle className="h-4 w-4" />
              Continuar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
