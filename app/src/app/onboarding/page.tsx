"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Download,
  ShieldCheck,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Server,
  Users,
  Shield,
  Layers,
  Wifi,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  AlertCircle,
  Eye,
  EyeOff,
  LayoutDashboard,
  Info,
  XCircle,
} from "lucide-react";
import Link from "next/link";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AuditSystem {
  identity: string;
  version: string;
  board: string;
  cpu: string;
  cpuCount: number;
  cpuLoad: number;
  totalMemory: number;
  freeMemory: number;
  uptime: string;
  architecture: string;
}

interface AuditProfile {
  name: string;
  rateLimit: string;
  localAddress: string;
  remoteAddress: string;
}

interface AuditSecret {
  name: string;
  profile: string;
  disabled: boolean;
  lastLoggedOut: string;
  comment: string;
}

interface AuditActive {
  name: string;
  address: string;
  uptime: string;
  service: string;
}

interface AuditFirewall {
  filterRules: Array<{
    chain: string;
    action: string;
    comment: string;
    disabled: boolean;
  }>;
  natRules: Array<{
    chain: string;
    action: string;
    comment: string;
    disabled: boolean;
  }>;
  totalFilterRules: number;
  totalNatRules: number;
  score: number;
  level: "none" | "basic" | "moderate" | "professional";
}

interface AuditQoS {
  simpleQueues: Array<{
    name: string;
    target: string;
    maxLimit: string;
    disabled: boolean;
  }>;
  treeQueues: Array<{
    name: string;
    parent: string;
    maxLimit: string;
    queue: string;
  }>;
  totalSimple: number;
  totalTree: number;
  type: "none" | "simple" | "tree" | "mixed";
}

interface AuditSecurity {
  users: Array<{ name: string; group: string; disabled: boolean }>;
  services: Array<{ name: string; port: number; disabled: boolean }>;
  vulnerabilities: string[];
  recommendations: string[];
}

interface AuditData {
  system: AuditSystem;
  pppoe: {
    profiles: AuditProfile[];
    secrets: AuditSecret[];
    active: AuditActive[];
    totalClients: number;
    totalProfiles: number;
    activeConnections: number;
  };
  firewall: AuditFirewall;
  qos: AuditQoS;
  network: {
    addresses: Array<{ address: string; interface: string; network: string; disabled: boolean }>;
    pools: Array<{ name: string; ranges: string }>;
    dns: { servers: string; allowRemoteRequests: boolean; cacheSize: string };
    interfaces: Array<{ name: string; type: string; running: boolean; disabled: boolean }>;
  };
  security: AuditSecurity;
  error?: string;
}

interface ProfileMapping {
  planName: string;
  price: number;
  selected: boolean;
}

interface ImportResult {
  plans: { imported: number; skipped: number; details: string[] };
  clients: { imported: number; skipped: number; details: string[] };
  errors: string[];
}

// ─── Step indicators ────────────────────────────────────────────────────────

const steps = [
  { key: "analyze", label: "Analizar", icon: Search },
  { key: "import", label: "Importar", icon: Download },
  { key: "improve", label: "Mejorar", icon: ShieldCheck },
  { key: "done", label: "Listo", icon: CheckCircle },
];

// ─── Analyzing progress messages ────────────────────────────────────────────

const analyzeSteps = [
  "Conectando al MikroTik...",
  "Leyendo sistema...",
  "Detectando clientes PPPoE...",
  "Evaluando firewall...",
  "Analizando QoS...",
  "Evaluando seguridad...",
  "Generando reporte...",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${Math.round(bytes / 1048576)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function firewallLevelLabel(level: string): string {
  switch (level) {
    case "professional": return "Profesional";
    case "moderate": return "Moderado";
    case "basic": return "Basico";
    default: return "Sin firewall";
  }
}

function firewallScoreColor(score: number): string {
  if (score >= 80) return "text-[#16a34a]";
  if (score >= 50) return "text-[#f59e0b]";
  return "text-[#dc2626]";
}

function qosTypeLabel(type: string): string {
  switch (type) {
    case "tree": return "Queue Trees";
    case "simple": return "Simple Queues";
    case "mixed": return "Mixto (Simple + Tree)";
    default: return "Sin QoS";
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1: Analyze
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [auditError, setAuditError] = useState("");

  // Step 2: Import
  const [profileMappings, setProfileMappings] = useState<Record<string, ProfileMapping>>({});
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [importingPlans, setImportingPlans] = useState(false);
  const [importingClients, setImportingClients] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [plansImported, setPlansImported] = useState(false);
  const [clientsImported, setClientsImported] = useState(false);

  // Step 3: Improve
  const [applyingFirewall, setApplyingFirewall] = useState(false);
  const [applyingQos, setApplyingQos] = useState(false);
  const [applyingAntiDdos, setApplyingAntiDdos] = useState(false);
  const [firewallApplied, setFirewallApplied] = useState(false);
  const [qosApplied, setQosApplied] = useState(false);
  const [antiDdosApplied, setAntiDdosApplied] = useState(false);
  const [bwDown, setBwDown] = useState(50);
  const [bwUp, setBwUp] = useState(50);

  // Step 4: Done
  const [summary, setSummary] = useState({
    plansImported: 0,
    clientsImported: 0,
    firewallApplied: false,
    qosApplied: false,
    antiDdosApplied: false,
  });

  // ── Run analysis ──
  const runAudit = useCallback(async () => {
    setAnalyzing(true);
    setAuditError("");
    setAnalyzeProgress(0);

    // Animate progress steps
    const interval = setInterval(() => {
      setAnalyzeProgress((prev) => {
        if (prev < analyzeSteps.length - 1) return prev + 1;
        return prev;
      });
    }, 800);

    try {
      const res = await fetch("/api/network/audit");
      clearInterval(interval);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al analizar MikroTik");
      }

      const data: AuditData = await res.json();
      if (data.error) throw new Error(data.error);

      setAnalyzeProgress(analyzeSteps.length - 1);
      setAudit(data);

      // Initialize profile mappings
      const mappings: Record<string, ProfileMapping> = {};
      for (const profile of data.pppoe.profiles) {
        mappings[profile.name] = {
          planName: profile.name,
          price: 0,
          selected: true,
        };
      }
      setProfileMappings(mappings);

      // Initialize all clients as selected
      const allClients = new Set(data.pppoe.secrets.map((s) => s.name));
      setSelectedClients(allClients);
    } catch (err) {
      clearInterval(interval);
      setAuditError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setAnalyzing(false);
    }
  }, []);

  // ── Import plans ──
  const handleImportPlans = async () => {
    if (!audit) return;
    setImportingPlans(true);

    const mapping: Record<string, { planName: string; price: number }> = {};
    const selectedProfiles: string[] = [];
    for (const [name, m] of Object.entries(profileMappings)) {
      if (m.selected) {
        mapping[name] = { planName: m.planName, price: m.price };
        selectedProfiles.push(name);
      }
    }

    try {
      const res = await fetch("/api/network/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "plans",
          profileMapping: mapping,
          selectedProfiles,
        }),
      });
      const data: ImportResult = await res.json();
      setImportResult((prev) =>
        prev
          ? { ...prev, plans: data.plans, errors: [...prev.errors, ...data.errors] }
          : data
      );
      setPlansImported(true);
      setSummary((s) => ({ ...s, plansImported: data.plans.imported }));
    } catch (err) {
      setImportResult((prev) => ({
        plans: prev?.plans || { imported: 0, skipped: 0, details: [] },
        clients: prev?.clients || { imported: 0, skipped: 0, details: [] },
        errors: [
          ...(prev?.errors || []),
          err instanceof Error ? err.message : "Error importando planes",
        ],
      }));
    } finally {
      setImportingPlans(false);
    }
  };

  // ── Import clients ──
  const handleImportClients = async () => {
    if (!audit) return;
    setImportingClients(true);

    try {
      const res = await fetch("/api/network/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "clients",
          selectedClients: Array.from(selectedClients),
        }),
      });
      const data: ImportResult = await res.json();
      setImportResult((prev) =>
        prev
          ? { ...prev, clients: data.clients, errors: [...prev.errors, ...data.errors] }
          : data
      );
      setClientsImported(true);
      setSummary((s) => ({ ...s, clientsImported: data.clients.imported }));
    } catch (err) {
      setImportResult((prev) => ({
        plans: prev?.plans || { imported: 0, skipped: 0, details: [] },
        clients: prev?.clients || { imported: 0, skipped: 0, details: [] },
        errors: [
          ...(prev?.errors || []),
          err instanceof Error ? err.message : "Error importando clientes",
        ],
      }));
    } finally {
      setImportingClients(false);
    }
  };

  // ── Apply improvements ──
  const applyImprovement = async (action: string) => {
    if (action === "firewall") setApplyingFirewall(true);
    if (action === "qos") setApplyingQos(true);
    if (action === "antiDdos") setApplyingAntiDdos(true);

    try {
      const res = await fetch("/api/network/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actions: [action],
          totalBandwidthDown: bwDown,
          totalBandwidthUp: bwUp,
        }),
      });
      const data = await res.json();
      const success = data.results?.[action]?.success === true;

      if (action === "firewall") {
        setFirewallApplied(success);
        setSummary((s) => ({ ...s, firewallApplied: success }));
      }
      if (action === "qos") {
        setQosApplied(success);
        setSummary((s) => ({ ...s, qosApplied: success }));
      }
      if (action === "antiDdos") {
        setAntiDdosApplied(success);
        setSummary((s) => ({ ...s, antiDdosApplied: success }));
      }
    } catch {
      // Error applying
    } finally {
      if (action === "firewall") setApplyingFirewall(false);
      if (action === "qos") setApplyingQos(false);
      if (action === "antiDdos") setApplyingAntiDdos(false);
    }
  };

  // ── Toggle all clients ──
  const toggleAllClients = () => {
    if (!audit) return;
    if (selectedClients.size === audit.pppoe.secrets.length) {
      setSelectedClients(new Set());
    } else {
      setSelectedClients(new Set(audit.pppoe.secrets.map((s) => s.name)));
    }
  };

  // ── Check MikroTik connection on mount ──
  const [mikrotikConnected, setMikrotikConnected] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/mikrotik/health")
      .then((r) => r.json())
      .then((d) => setMikrotikConnected(!!d.connected))
      .catch(() => setMikrotikConnected(false));
  }, []);

  // ── Step navigation ──
  const canGoNext = () => {
    if (currentStep === 0) return !!audit;
    if (currentStep === 1) return true; // Can skip import
    if (currentStep === 2) return true; // Can skip improvements
    return false;
  };

  const goNext = () => {
    if (currentStep < steps.length - 1) setCurrentStep(currentStep + 1);
  };

  const goBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen overflow-y-auto bg-[#f5f7fa]">
      {/* Top bar */}
      <div className="border-b border-[#e2e8f0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#006fff] text-white">
              <Wifi className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold text-[#0f172a]">Linker</span>
          </div>
          <Link
            href="/"
            className="text-sm text-[#475569] transition-colors hover:text-[#0f172a]"
          >
            Saltar al Dashboard
          </Link>
        </div>
      </div>

      {/* Step indicator */}
      <div className="border-b border-[#e2e8f0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-center gap-2">
          {steps.map((step, idx) => {
            const StepIcon = step.icon;
            const isActive = idx === currentStep;
            const isCompleted = idx < currentStep;
            return (
              <div key={step.key} className="flex items-center gap-2">
                {idx > 0 && (
                  <div
                    className={`h-px w-8 sm:w-16 ${
                      isCompleted ? "bg-[#006fff]" : "bg-[#e2e8f0]"
                    }`}
                  />
                )}
                <div
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? "bg-[#006fff]/10 text-[#006fff]"
                      : isCompleted
                        ? "text-[#16a34a]"
                        : "text-[#94a3b8]"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle className="h-4 w-4 text-[#16a34a]" />
                  ) : (
                    <StepIcon className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* ═══════════════════════════════════════════════════════════════════
            STEP 1: ANALIZAR
        ═══════════════════════════════════════════════════════════════════ */}
        {currentStep === 0 && (
          <div className="space-y-6">
            {!audit && !analyzing && (
              <div className="text-center">
                <h1 className="text-3xl font-bold tracking-tight text-[#0f172a]">
                  Bienvenido a Linker
                </h1>
                <p className="mt-3 text-base text-[#475569]">
                  Vamos a analizar tu MikroTik para importar tu configuracion existente
                </p>

                {/* Connection status */}
                <div className="mt-8 flex justify-center">
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 shadow-sm">
                    {mikrotikConnected === null ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-[#006fff]" />
                        <p className="text-sm text-[#475569]">
                          Verificando conexion...
                        </p>
                      </div>
                    ) : mikrotikConnected ? (
                      <div className="flex flex-col items-center gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f0fdf4]">
                          <Server className="h-8 w-8 text-[#16a34a]" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#16a34a]">
                            MikroTik conectado
                          </p>
                          <p className="mt-1 text-xs text-[#94a3b8]">
                            Listo para analizar
                          </p>
                        </div>
                        <button
                          onClick={runAudit}
                          className="flex items-center gap-2 rounded-xl bg-[#006fff] px-8 py-3 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#0057cc] hover:shadow-[#006fff]/30"
                        >
                          <Search className="h-4 w-4" />
                          Analizar MikroTik
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#fef2f2]">
                          <AlertCircle className="h-8 w-8 text-[#dc2626]" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#dc2626]">
                            MikroTik no conectado
                          </p>
                          <p className="mt-1 max-w-xs text-xs text-[#94a3b8]">
                            Verifica la conexion en Configuracion antes de continuar
                          </p>
                        </div>
                        <Link
                          href="/configuracion"
                          className="rounded-xl bg-[#006fff] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
                        >
                          Ir a Configuracion
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Analyzing animation */}
            {analyzing && (
              <div className="flex flex-col items-center gap-6 py-12">
                <Loader2 className="h-12 w-12 animate-spin text-[#006fff]" />
                <div className="w-full max-w-md space-y-3">
                  {analyzeSteps.map((step, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition-all duration-300 ${
                        idx < analyzeProgress
                          ? "text-[#16a34a]"
                          : idx === analyzeProgress
                            ? "text-[#006fff] font-medium"
                            : "text-[#94a3b8]"
                      }`}
                    >
                      {idx < analyzeProgress ? (
                        <CheckCircle className="h-4 w-4 shrink-0 text-[#16a34a]" />
                      ) : idx === analyzeProgress ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#006fff]" />
                      ) : (
                        <div className="h-4 w-4 shrink-0 rounded-full border border-[#e2e8f0]" />
                      )}
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Audit error */}
            {auditError && (
              <div className="rounded-2xl border border-[#dc2626]/20 bg-[#fef2f2] p-6 text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-[#dc2626]" />
                <p className="mt-3 text-sm font-medium text-[#dc2626]">{auditError}</p>
                <button
                  onClick={runAudit}
                  className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
                >
                  Reintentar
                </button>
              </div>
            )}

            {/* Audit results dashboard */}
            {audit && !analyzing && (
              <div className="space-y-6">
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-[#0f172a]">
                    Analisis completado
                  </h2>
                  <p className="mt-1 text-sm text-[#475569]">
                    Resumen de tu configuracion actual en {audit.system.identity}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {/* System card */}
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-[#006fff]">
                      <Server className="h-5 w-5" />
                      <h3 className="text-sm font-semibold">Sistema</h3>
                    </div>
                    <div className="mt-4 space-y-2 text-xs text-[#475569]">
                      <div className="flex justify-between">
                        <span>RouterOS</span>
                        <span className="font-medium text-[#0f172a]">{audit.system.version}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Board</span>
                        <span className="font-medium text-[#0f172a]">{audit.system.board}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Uptime</span>
                        <span className="font-medium text-[#0f172a]">{audit.system.uptime}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Memoria</span>
                        <span className="font-medium text-[#0f172a]">
                          {formatBytes(audit.system.totalMemory - audit.system.freeMemory)} / {formatBytes(audit.system.totalMemory)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* PPPoE card */}
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-[#006fff]">
                      <Users className="h-5 w-5" />
                      <h3 className="text-sm font-semibold">PPPoE</h3>
                    </div>
                    <div className="mt-4 space-y-2 text-xs text-[#475569]">
                      <div className="flex justify-between">
                        <span>Clientes (secrets)</span>
                        <span className="font-semibold text-[#0f172a] text-base">
                          {audit.pppoe.totalClients}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Planes (profiles)</span>
                        <span className="font-medium text-[#0f172a]">{audit.pppoe.totalProfiles}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Conectados ahora</span>
                        <span className="font-medium text-[#16a34a]">{audit.pppoe.activeConnections}</span>
                      </div>
                    </div>
                  </div>

                  {/* Firewall card */}
                  <div className={`rounded-2xl border bg-white p-5 shadow-sm ${
                    audit.firewall.score < 30 ? "border-[#dc2626]/30" : "border-[#e2e8f0]"
                  }`}>
                    <div className="flex items-center gap-2 text-[#006fff]">
                      <Shield className="h-5 w-5" />
                      <h3 className="text-sm font-semibold">Firewall</h3>
                    </div>
                    <div className="mt-4 space-y-2 text-xs text-[#475569]">
                      <div className="flex justify-between">
                        <span>Reglas de filtro</span>
                        <span className="font-medium text-[#0f172a]">{audit.firewall.totalFilterRules}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Reglas NAT</span>
                        <span className="font-medium text-[#0f172a]">{audit.firewall.totalNatRules}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Nivel</span>
                        <span className={`font-semibold ${firewallScoreColor(audit.firewall.score)}`}>
                          {firewallLevelLabel(audit.firewall.level)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Puntaje</span>
                        <span className={`font-bold text-base ${firewallScoreColor(audit.firewall.score)}`}>
                          {audit.firewall.score}/100
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* QoS card */}
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-[#006fff]">
                      <Layers className="h-5 w-5" />
                      <h3 className="text-sm font-semibold">QoS</h3>
                    </div>
                    <div className="mt-4 space-y-2 text-xs text-[#475569]">
                      <div className="flex justify-between">
                        <span>Tipo</span>
                        <span className="font-medium text-[#0f172a]">{qosTypeLabel(audit.qos.type)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Simple Queues</span>
                        <span className="font-medium text-[#0f172a]">{audit.qos.totalSimple}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Tree Queues</span>
                        <span className="font-medium text-[#0f172a]">{audit.qos.totalTree}</span>
                      </div>
                    </div>
                  </div>

                  {/* Vulnerabilities card */}
                  {audit.security.vulnerabilities.length > 0 && (
                    <div className="rounded-2xl border border-[#dc2626]/30 bg-[#fef2f2] p-5 shadow-sm sm:col-span-2">
                      <div className="flex items-center gap-2 text-[#dc2626]">
                        <AlertTriangle className="h-5 w-5" />
                        <h3 className="text-sm font-semibold">Vulnerabilidades detectadas</h3>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {audit.security.vulnerabilities.map((v, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-xs text-[#dc2626]">
                            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {v}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Next button */}
                <div className="flex justify-end">
                  <button
                    onClick={goNext}
                    className="flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#0057cc]"
                  >
                    Continuar a Importar
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP 2: IMPORTAR
        ═══════════════════════════════════════════════════════════════════ */}
        {currentStep === 1 && audit && (
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-[#0f172a]">
                Importar datos existentes
              </h2>
              <p className="mt-1 text-sm text-[#475569]">
                Importa tus planes y clientes de MikroTik a Linker
              </p>
            </div>

            {/* Planes section */}
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-[#006fff]" />
                  <h3 className="text-base font-semibold text-[#0f172a]">
                    Planes detectados ({audit.pppoe.profiles.length})
                  </h3>
                </div>
                {plansImported && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-[#16a34a]">
                    <CheckCircle className="h-4 w-4" />
                    Importados
                  </span>
                )}
              </div>

              {audit.pppoe.profiles.length === 0 ? (
                <p className="mt-4 text-sm text-[#94a3b8]">
                  No se encontraron perfiles PPPoE personalizados
                </p>
              ) : (
                <>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#e2e8f0] text-left text-xs text-[#94a3b8]">
                          <th className="pb-2 pr-4">
                            <input
                              type="checkbox"
                              checked={Object.values(profileMappings).every((m) => m.selected)}
                              onChange={() => {
                                const allSelected = Object.values(profileMappings).every((m) => m.selected);
                                setProfileMappings((prev) => {
                                  const next = { ...prev };
                                  for (const key of Object.keys(next)) {
                                    next[key] = { ...next[key], selected: !allSelected };
                                  }
                                  return next;
                                });
                              }}
                              className="rounded border-[#e2e8f0]"
                            />
                          </th>
                          <th className="pb-2 pr-4">Nombre en MikroTik</th>
                          <th className="pb-2 pr-4">Rate Limit</th>
                          <th className="pb-2 pr-4">Nombre del plan</th>
                          <th className="pb-2">Precio (MXN)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.pppoe.profiles.map((profile) => {
                          const mapping = profileMappings[profile.name];
                          if (!mapping) return null;
                          return (
                            <tr key={profile.name} className="border-b border-[#e2e8f0]/50">
                              <td className="py-3 pr-4">
                                <input
                                  type="checkbox"
                                  checked={mapping.selected}
                                  onChange={() => {
                                    setProfileMappings((prev) => ({
                                      ...prev,
                                      [profile.name]: {
                                        ...prev[profile.name],
                                        selected: !prev[profile.name].selected,
                                      },
                                    }));
                                  }}
                                  disabled={plansImported}
                                  className="rounded border-[#e2e8f0]"
                                />
                              </td>
                              <td className="py-3 pr-4 font-mono text-xs text-[#0f172a]">
                                {profile.name}
                              </td>
                              <td className="py-3 pr-4 text-xs text-[#475569]">
                                {profile.rateLimit}
                              </td>
                              <td className="py-3 pr-4">
                                <input
                                  type="text"
                                  value={mapping.planName}
                                  onChange={(e) => {
                                    setProfileMappings((prev) => ({
                                      ...prev,
                                      [profile.name]: {
                                        ...prev[profile.name],
                                        planName: e.target.value,
                                      },
                                    }));
                                  }}
                                  disabled={plansImported}
                                  className="w-full rounded-lg border border-[#e2e8f0] bg-[#f5f7fa] px-2.5 py-1.5 text-xs text-[#0f172a] outline-none focus:border-[#006fff] disabled:opacity-50"
                                />
                              </td>
                              <td className="py-3">
                                <div className="flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-[#f5f7fa] px-2.5 py-1.5">
                                  <span className="text-xs text-[#94a3b8]">$</span>
                                  <input
                                    type="number"
                                    min={0}
                                    value={mapping.price}
                                    onChange={(e) => {
                                      setProfileMappings((prev) => ({
                                        ...prev,
                                        [profile.name]: {
                                          ...prev[profile.name],
                                          price: parseFloat(e.target.value) || 0,
                                        },
                                      }));
                                    }}
                                    disabled={plansImported}
                                    className="w-20 bg-transparent text-xs text-[#0f172a] outline-none disabled:opacity-50"
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-[#94a3b8]">
                      {Object.values(profileMappings).filter((m) => m.selected).length} de{" "}
                      {audit.pppoe.profiles.length} seleccionados
                    </p>
                    <button
                      onClick={handleImportPlans}
                      disabled={importingPlans || plansImported || Object.values(profileMappings).filter((m) => m.selected).length === 0}
                      className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#0057cc] disabled:opacity-50"
                    >
                      {importingPlans ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : plansImported ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {plansImported ? "Planes importados" : importingPlans ? "Importando..." : "Importar planes"}
                    </button>
                  </div>

                  {importResult?.plans && plansImported && (
                    <div className="mt-3 rounded-xl bg-[#f0fdf4] px-4 py-3 text-xs text-[#16a34a]">
                      {importResult.plans.imported} planes importados, {importResult.plans.skipped} omitidos
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Clientes section */}
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-[#006fff]" />
                  <h3 className="text-base font-semibold text-[#0f172a]">
                    Clientes detectados ({audit.pppoe.secrets.length})
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  {clientsImported && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-[#16a34a]">
                      <CheckCircle className="h-4 w-4" />
                      Importados
                    </span>
                  )}
                  <button
                    onClick={toggleAllClients}
                    disabled={clientsImported}
                    className="text-xs font-medium text-[#006fff] transition-colors hover:text-[#0057cc] disabled:opacity-50"
                  >
                    {selectedClients.size === audit.pppoe.secrets.length
                      ? "Deseleccionar todos"
                      : "Seleccionar todos"}
                  </button>
                </div>
              </div>

              {audit.pppoe.secrets.length === 0 ? (
                <p className="mt-4 text-sm text-[#94a3b8]">
                  No se encontraron clientes PPPoE
                </p>
              ) : (
                <>
                  <div className="mt-4 max-h-80 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-[#e2e8f0] text-left text-xs text-[#94a3b8]">
                          <th className="pb-2 pr-4 pl-1">
                            <input
                              type="checkbox"
                              checked={
                                selectedClients.size === audit.pppoe.secrets.length &&
                                audit.pppoe.secrets.length > 0
                              }
                              onChange={toggleAllClients}
                              disabled={clientsImported}
                              className="rounded border-[#e2e8f0]"
                            />
                          </th>
                          <th className="pb-2 pr-4">Nombre</th>
                          <th className="pb-2 pr-4">Perfil</th>
                          <th className="pb-2 pr-4">Estado</th>
                          <th className="pb-2">Ultima desconexion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.pppoe.secrets.map((secret) => (
                          <tr
                            key={secret.name}
                            className={`border-b border-[#e2e8f0]/50 ${
                              secret.disabled ? "opacity-60" : ""
                            }`}
                          >
                            <td className="py-2.5 pr-4 pl-1">
                              <input
                                type="checkbox"
                                checked={selectedClients.has(secret.name)}
                                onChange={() => {
                                  setSelectedClients((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(secret.name)) {
                                      next.delete(secret.name);
                                    } else {
                                      next.add(secret.name);
                                    }
                                    return next;
                                  });
                                }}
                                disabled={clientsImported}
                                className="rounded border-[#e2e8f0]"
                              />
                            </td>
                            <td className="py-2.5 pr-4 text-xs font-medium text-[#0f172a]">
                              {secret.comment || secret.name}
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-xs text-[#475569]">
                              {secret.profile}
                            </td>
                            <td className="py-2.5 pr-4">
                              {secret.disabled ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[#fef2f2] px-2 py-0.5 text-[10px] font-medium text-[#dc2626]">
                                  <EyeOff className="h-3 w-3" />
                                  Deshabilitado
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[#f0fdf4] px-2 py-0.5 text-[10px] font-medium text-[#16a34a]">
                                  <Eye className="h-3 w-3" />
                                  Activo
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 text-xs text-[#94a3b8]">
                              {secret.lastLoggedOut !== "-" ? secret.lastLoggedOut : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-[#94a3b8]">
                      {selectedClients.size} de {audit.pppoe.secrets.length} seleccionados
                    </p>
                    <button
                      onClick={handleImportClients}
                      disabled={importingClients || clientsImported || selectedClients.size === 0}
                      className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#0057cc] disabled:opacity-50"
                    >
                      {importingClients ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : clientsImported ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {clientsImported
                        ? "Clientes importados"
                        : importingClients
                          ? "Importando..."
                          : "Importar clientes"}
                    </button>
                  </div>

                  {importResult?.clients && clientsImported && (
                    <div className="mt-3 rounded-xl bg-[#f0fdf4] px-4 py-3 text-xs text-[#16a34a]">
                      {importResult.clients.imported} clientes importados, {importResult.clients.skipped} omitidos
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Import errors */}
            {importResult?.errors && importResult.errors.length > 0 && (
              <div className="rounded-2xl border border-[#dc2626]/20 bg-[#fef2f2] p-4">
                <p className="text-xs font-medium text-[#dc2626]">Errores durante la importacion:</p>
                <ul className="mt-2 space-y-1">
                  {importResult.errors.map((e, idx) => (
                    <li key={idx} className="text-xs text-[#dc2626]">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                onClick={goBack}
                className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa]"
              >
                <ChevronLeft className="h-4 w-4" />
                Atras
              </button>
              <button
                onClick={goNext}
                className="flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#0057cc]"
              >
                Continuar a Mejorar
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP 3: MEJORAR
        ═══════════════════════════════════════════════════════════════════ */}
        {currentStep === 2 && audit && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-[#0f172a]">
                Mejoras recomendadas
              </h2>
              <p className="mt-1 text-sm text-[#475569]">
                Aplica las mejores practicas de seguridad y rendimiento
              </p>
            </div>

            {/* Safety warning */}
            <div className="flex items-start gap-3 rounded-2xl border border-[#006fff]/20 bg-[#eff6ff] p-4">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#006fff]" />
              <div className="text-xs text-[#475569]">
                <p className="font-medium text-[#0f172a]">Modo seguro</p>
                <p className="mt-0.5">
                  Las reglas existentes NO se eliminaran. Solo se agregan las faltantes.
                  Todas las reglas de Linker llevan el prefijo &quot;LK:&quot; para identificarlas.
                </p>
              </div>
            </div>

            {/* Admin password warning */}
            {audit.security.vulnerabilities.some((v) =>
              v.toLowerCase().includes("admin")
            ) && (
              <div className="flex items-start gap-3 rounded-2xl border border-[#dc2626]/30 bg-[#fef2f2] p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#dc2626]" />
                <div className="text-xs">
                  <p className="font-medium text-[#dc2626]">Cambia el password del administrador</p>
                  <p className="mt-0.5 text-[#dc2626]/80">
                    El usuario admin esta habilitado con un posible password vacio. Cambialo desde Winbox o la terminal del MikroTik.
                  </p>
                </div>
              </div>
            )}

            {/* Firewall recommendation */}
            {audit.firewall.level !== "professional" && (
              <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f5f7fa]">
                      <Shield className="h-5 w-5 text-[#006fff]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[#0f172a]">Firewall Profesional</h3>
                      <p className="mt-1 text-xs text-[#475569]">
                        Tu firewall tiene {audit.firewall.totalFilterRules} reglas ({firewallLevelLabel(audit.firewall.level)}).
                        Recomendamos agregar reglas adicionales de proteccion para INPUT, FORWARD, anti-SYN flood, anti-port scan y anti-brute force.
                      </p>
                    </div>
                  </div>
                  {firewallApplied && (
                    <CheckCircle className="h-5 w-5 shrink-0 text-[#16a34a]" />
                  )}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => applyImprovement("firewall")}
                    disabled={applyingFirewall || firewallApplied}
                    className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#0057cc] disabled:opacity-50"
                  >
                    {applyingFirewall ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : firewallApplied ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    {firewallApplied ? "Aplicado" : applyingFirewall ? "Aplicando..." : "Aplicar"}
                  </button>
                  {!firewallApplied && (
                    <button
                      onClick={goNext}
                      className="rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa]"
                    >
                      Saltar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* QoS recommendation */}
            {audit.qos.type === "none" && (
              <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f5f7fa]">
                      <Layers className="h-5 w-5 text-[#006fff]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[#0f172a]">Control de Calidad de Servicio (QoS)</h3>
                      <p className="mt-1 text-xs text-[#475569]">
                        No tienes control de calidad de servicio. Recomendamos configurar Queue Trees
                        para distribuir el ancho de banda equitativamente entre tus clientes.
                      </p>
                    </div>
                  </div>
                  {qosApplied && (
                    <CheckCircle className="h-5 w-5 shrink-0 text-[#16a34a]" />
                  )}
                </div>
                {/* Bandwidth inputs */}
                <div className="mt-4 flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[#475569]">Bajada total:</label>
                    <div className="flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-[#f5f7fa] px-2.5 py-1.5">
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={bwDown}
                        onChange={(e) => setBwDown(parseInt(e.target.value) || 1)}
                        disabled={qosApplied}
                        className="w-16 bg-transparent text-xs text-[#0f172a] outline-none"
                      />
                      <span className="text-[10px] text-[#94a3b8]">Mbps</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[#475569]">Subida total:</label>
                    <div className="flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-[#f5f7fa] px-2.5 py-1.5">
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={bwUp}
                        onChange={(e) => setBwUp(parseInt(e.target.value) || 1)}
                        disabled={qosApplied}
                        className="w-16 bg-transparent text-xs text-[#0f172a] outline-none"
                      />
                      <span className="text-[10px] text-[#94a3b8]">Mbps</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => applyImprovement("qos")}
                    disabled={applyingQos || qosApplied}
                    className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#0057cc] disabled:opacity-50"
                  >
                    {applyingQos ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : qosApplied ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <Layers className="h-4 w-4" />
                    )}
                    {qosApplied ? "Aplicado" : applyingQos ? "Aplicando..." : "Aplicar"}
                  </button>
                  {!qosApplied && (
                    <button
                      onClick={() => {}}
                      className="rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa]"
                    >
                      Saltar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Anti-DDoS recommendation */}
            {!audit.security.vulnerabilities.length ||
              audit.firewall.score < 80 ? (
              <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f5f7fa]">
                      <ShieldCheck className="h-5 w-5 text-[#006fff]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[#0f172a]">Proteccion Anti-DDoS</h3>
                      <p className="mt-1 text-xs text-[#475569]">
                        Tu red no tiene proteccion contra ataques de denegacion de servicio.
                        Agrega reglas para detectar y bloquear SYN flood, ICMP flood y UDP flood.
                      </p>
                    </div>
                  </div>
                  {antiDdosApplied && (
                    <CheckCircle className="h-5 w-5 shrink-0 text-[#16a34a]" />
                  )}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => applyImprovement("antiDdos")}
                    disabled={applyingAntiDdos || antiDdosApplied}
                    className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#0057cc] disabled:opacity-50"
                  >
                    {applyingAntiDdos ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : antiDdosApplied ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    {antiDdosApplied ? "Aplicado" : applyingAntiDdos ? "Aplicando..." : "Aplicar"}
                  </button>
                  {!antiDdosApplied && (
                    <button
                      onClick={() => {}}
                      className="rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa]"
                    >
                      Saltar
                    </button>
                  )}
                </div>
              </div>
            ) : null}

            {/* No recommendations needed */}
            {audit.firewall.level === "professional" &&
              audit.qos.type !== "none" && (
                <div className="rounded-2xl border border-[#16a34a]/20 bg-[#f0fdf4] p-6 text-center">
                  <CheckCircle className="mx-auto h-8 w-8 text-[#16a34a]" />
                  <p className="mt-3 text-sm font-medium text-[#16a34a]">
                    Tu MikroTik ya tiene una buena configuracion
                  </p>
                </div>
              )}

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                onClick={goBack}
                className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa]"
              >
                <ChevronLeft className="h-4 w-4" />
                Atras
              </button>
              <button
                onClick={goNext}
                className="flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#0057cc]"
              >
                Finalizar
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP 4: LISTO
        ═══════════════════════════════════════════════════════════════════ */}
        {currentStep === 3 && (
          <div className="flex flex-col items-center py-12">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#f0fdf4]">
              <CheckCircle className="h-10 w-10 text-[#16a34a]" />
            </div>

            <h2 className="mt-6 text-2xl font-bold text-[#0f172a]">
              Tu red esta configurada!
            </h2>
            <p className="mt-2 text-sm text-[#475569]">
              Linker esta listo para administrar tu red
            </p>

            {/* Summary */}
            <div className="mt-8 w-full max-w-md rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0f172a]">Resumen</h3>
              <div className="mt-4 space-y-3">
                {summary.plansImported > 0 && (
                  <div className="flex items-center gap-3 text-sm text-[#475569]">
                    <CheckCircle className="h-4 w-4 shrink-0 text-[#16a34a]" />
                    {summary.plansImported} planes importados
                  </div>
                )}
                {summary.clientsImported > 0 && (
                  <div className="flex items-center gap-3 text-sm text-[#475569]">
                    <CheckCircle className="h-4 w-4 shrink-0 text-[#16a34a]" />
                    {summary.clientsImported} clientes importados
                  </div>
                )}
                {summary.firewallApplied && (
                  <div className="flex items-center gap-3 text-sm text-[#475569]">
                    <CheckCircle className="h-4 w-4 shrink-0 text-[#16a34a]" />
                    Firewall profesional aplicado
                  </div>
                )}
                {summary.qosApplied && (
                  <div className="flex items-center gap-3 text-sm text-[#475569]">
                    <CheckCircle className="h-4 w-4 shrink-0 text-[#16a34a]" />
                    QoS configurado
                  </div>
                )}
                {summary.antiDdosApplied && (
                  <div className="flex items-center gap-3 text-sm text-[#475569]">
                    <CheckCircle className="h-4 w-4 shrink-0 text-[#16a34a]" />
                    Proteccion Anti-DDoS aplicada
                  </div>
                )}
                {!summary.plansImported &&
                  !summary.clientsImported &&
                  !summary.firewallApplied &&
                  !summary.qosApplied &&
                  !summary.antiDdosApplied && (
                    <p className="text-sm text-[#94a3b8]">
                      No se realizaron cambios. Puedes configurar todo desde el panel de Seguridad.
                    </p>
                  )}
              </div>
            </div>

            <button
              onClick={() => router.push("/")}
              className="mt-8 flex items-center gap-2 rounded-xl bg-[#006fff] px-8 py-3 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#0057cc]"
            >
              <LayoutDashboard className="h-4 w-4" />
              Ir al Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
