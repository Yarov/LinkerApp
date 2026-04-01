import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Download, ShieldCheck, CheckCircle, Loader2, AlertTriangle, Server, LayoutDashboard, ArrowLeft, X, Shield, Gauge, Globe, Lock, ShieldAlert, Save, Zap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface AuditCheck {
  name: string;
  status: string;
  description: string;
  data?: unknown[];
}

interface AuditResult {
  success: boolean;
  message: string;
  checks: AuditCheck[];
  system?: Record<string, string> | null;
}

interface ImportResult {
  success: boolean;
  message: string;
  imported: {
    plans: number;
    plans_skipped: number;
    clients: number;
    clients_skipped: number;
    profiles_found: number;
    secrets_found: number;
  };
}

const securityCards = [
  { key: "firewall", title: "Firewall Profesional", desc: "Protege tu red de ataques y accesos no autorizados.", icon: Shield },
  { key: "qos", title: "QoS (Calidad de Servicio)", desc: "Distribuye el ancho de banda equitativamente.", icon: Gauge },
  { key: "dns", title: "DNS Cache", desc: "Navegacion mas rapida para tus clientes.", icon: Globe },
  { key: "clientIsolation", title: "Aislamiento de Clientes", desc: "Los clientes no pueden verse entre si.", icon: Lock },
  { key: "antiDdos", title: "Proteccion Anti-DDoS", desc: "Proteccion contra ataques de denegacion de servicio.", icon: ShieldAlert },
  { key: "backup", title: "Backup", desc: "Respaldo de la configuracion del MikroTik.", icon: Save },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [analyzeStep, setAnalyzeStep] = useState("");
  const [selectedSecurity, setSelectedSecurity] = useState<Set<string>>(new Set(["firewall", "dns", "backup"]));
  const [applyingSecurity, setApplyingSecurity] = useState(false);
  const [securityResults, setSecurityResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const runAudit = async () => {
    setAnalyzing(true); setError(""); setAnalyzeStep("Conectando a MikroTik...");
    await new Promise(r => setTimeout(r, 100));
    setAnalyzeStep("Leyendo configuracion del sistema...");
    await new Promise(r => setTimeout(r, 50));
    try {
      const data = await invoke<AuditResult>("audit_mikrotik");
      setAnalyzeStep("Procesando resultados...");
      await new Promise(r => setTimeout(r, 200));
      setAudit(data);
      setStep(1);
    } catch (err) { setError(String(err)); } finally { setAnalyzing(false); setAnalyzeStep(""); }
  };

  const runImport = async () => {
    setImporting(true); setError("");
    try {
      const data = await invoke<ImportResult>("import_from_mikrotik");
      setImportResult(data);
      setStep(2);
    } catch (err) { setError(String(err)); } finally { setImporting(false); }
  };

  const toggleSecurity = (key: string) => {
    setSelectedSecurity(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const applySecurity = async () => {
    setApplyingSecurity(true); setError("");
    const results: Record<string, { success: boolean; message: string }> = {};
    for (const key of selectedSecurity) {
      try {
        const data = await invoke<{ success: boolean; message: string }>("apply_security", { ruleType: key });
        results[key] = { success: data.success, message: data.message };
      } catch (err) {
        results[key] = { success: false, message: String(err) };
      }
    }
    setSecurityResults(results);
    setApplyingSecurity(false);
    setStep(3);
  };

  // Audit summary helpers
  const pppoeProfiles = audit?.checks?.find(c => c.name === "PPPoE Profiles");
  const pppoeSecrets = audit?.checks?.find(c => c.name === "PPPoE Secrets");
  const pppoeActive = audit?.checks?.find(c => c.name === "PPPoE Active");
  const firewallFilter = audit?.checks?.find(c => c.name === "Firewall Filter");
  const firewallNat = audit?.checks?.find(c => c.name === "Firewall NAT");

  const statusColors: Record<string, string> = {
    ok: "border-[#16a34a]/30 bg-[#f0fdf4] text-[#16a34a]",
    error: "border-[#dc2626]/30 bg-[#fef2f2] text-[#dc2626]",
  };

  return (
    <div className="mx-auto max-w-3xl py-8">
      {/* Top navigation */}
      <div className="mb-6 flex items-center justify-between">
        <button onClick={() => step > 0 ? setStep(step - 1) : navigate("/")} className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2 text-sm text-[#475569] hover:bg-[#f5f7fa]">
          <ArrowLeft className="h-4 w-4" />{step > 0 ? "Paso anterior" : "Volver al Dashboard"}
        </button>
        <button onClick={() => navigate("/")} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-[#94a3b8] hover:text-[#475569]">
          <X className="h-4 w-4" />Cancelar
        </button>
      </div>
      <div className="mb-8 text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#eff6ff]"><Server className="h-8 w-8 text-[#006fff]" /></div><h1 className="text-2xl font-bold text-[#0f172a]">Importar Red Existente</h1><p className="mt-2 text-sm text-[#475569]">Analiza tu MikroTik e importa clientes y configuracion</p></div>

      {/* Step indicators */}
      <div className="mb-8 flex items-center justify-center gap-3">
        {[{ label: "Analizar", icon: Search }, { label: "Importar", icon: Download }, { label: "Seguridad", icon: ShieldCheck }, { label: "Listo", icon: CheckCircle }].map((s, i) => {
          const Icon = s.icon; const isActive = i === step; const isDone = i < step;
          return (<div key={i} className="flex items-center gap-2">{i > 0 && <div className={`h-0.5 w-6 rounded-full ${isDone ? "bg-[#006fff]" : "bg-[#e2e8f0]"}`} />}<div className={`flex h-9 w-9 items-center justify-center rounded-xl ${isActive ? "bg-[#006fff] text-white shadow-lg shadow-[#006fff]/20" : isDone ? "bg-[#006fff]/10 text-[#006fff]" : "bg-[#f5f7fa] text-[#94a3b8]"}`}><Icon className="h-4 w-4" /></div><span className={`text-xs font-medium hidden sm:inline ${isActive ? "text-[#0f172a]" : "text-[#94a3b8]"}`}>{s.label}</span></div>);
        })}
      </div>

      {error && <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[#dc2626]/20 bg-[#fef2f2] px-5 py-4 text-sm text-[#dc2626]"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}

      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 shadow-sm">
        {step === 0 && <div className="text-center space-y-6">
          <h2 className="text-lg font-semibold text-[#0f172a]">Paso 1: Analizar MikroTik</h2>
          <p className="text-sm text-[#475569]">Escanearemos tu MikroTik para encontrar clientes, planes y configuracion existente.</p>
          <button onClick={runAudit} disabled={analyzing} className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-8 py-3 text-base font-semibold text-white shadow-lg shadow-[#006fff]/20 hover:bg-[#005ce6] disabled:opacity-50">{analyzing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}{analyzing ? "Analizando..." : "Analizar MikroTik"}</button>
          {analyzing && analyzeStep && <p className="mt-3 text-sm text-[#006fff] animate-pulse">{analyzeStep}</p>}
        </div>}

        {step === 1 && <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-[#0f172a]">Paso 2: Resultados del Analisis</h2>
            {audit && <p className="mt-2 text-sm text-[#475569]">{audit.message}</p>}
          </div>

          {/* Summary cards */}
          {audit && (
            <div className="grid grid-cols-2 gap-3">
              {pppoeProfiles && (
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-4 text-center">
                  <p className="text-2xl font-bold text-[#006fff]">{Array.isArray(pppoeProfiles.data) ? pppoeProfiles.data.length : 0}</p>
                  <p className="text-xs text-[#475569]">Perfiles PPPoE</p>
                </div>
              )}
              {pppoeSecrets && (
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-4 text-center">
                  <p className="text-2xl font-bold text-[#006fff]">{Array.isArray(pppoeSecrets.data) ? pppoeSecrets.data.length : 0}</p>
                  <p className="text-xs text-[#475569]">Clientes (Secrets)</p>
                </div>
              )}
              {pppoeActive && (
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-4 text-center">
                  <p className="text-2xl font-bold text-[#16a34a]">{Array.isArray(pppoeActive.data) ? pppoeActive.data.length : 0}</p>
                  <p className="text-xs text-[#475569]">Sesiones activas</p>
                </div>
              )}
              {firewallFilter && (
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-4 text-center">
                  <p className="text-2xl font-bold text-[#f59e0b]">{(Array.isArray(firewallFilter.data) ? firewallFilter.data.length : 0) + (Array.isArray(firewallNat?.data) ? firewallNat.data.length : 0)}</p>
                  <p className="text-xs text-[#475569]">Reglas Firewall</p>
                </div>
              )}
            </div>
          )}

          {/* Show audit checks */}
          {audit && audit.checks && audit.checks.length > 0 && (
            <div className="space-y-2">
              {audit.checks.map((check, idx) => {
                const dataCount = Array.isArray(check.data) ? check.data.length : 0;
                return (
                  <div key={idx} className={`flex items-start gap-3 rounded-xl border px-4 py-2.5 ${statusColors[check.status] ?? "border-[#e2e8f0] bg-[#f5f7fa] text-[#475569]"}`}>
                    <div className="mt-0.5 shrink-0">
                      {check.status === "ok" ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{check.name}</p>
                      <p className="mt-0.5 text-xs opacity-80">{check.description}</p>
                      {dataCount > 0 && <p className="mt-0.5 text-xs opacity-60">{dataCount} elemento{dataCount !== 1 ? "s" : ""}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* System info */}
          {audit?.system && (
            <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-4">
              <h3 className="text-xs font-medium uppercase tracking-widest text-[#94a3b8] mb-2">Sistema</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-[#475569]">Version: </span><span className="font-medium text-[#0f172a]">{(audit.system as Record<string, string>)["version"] ?? "-"}</span></div>
                <div><span className="text-[#475569]">Board: </span><span className="font-medium text-[#0f172a]">{(audit.system as Record<string, string>)["board-name"] ?? "-"}</span></div>
                <div><span className="text-[#475569]">Uptime: </span><span className="font-medium text-[#0f172a]">{(audit.system as Record<string, string>)["uptime"] ?? "-"}</span></div>
              </div>
            </div>
          )}

          <div className="text-center">
            <button onClick={runImport} disabled={importing} className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-8 py-3 text-base font-semibold text-white shadow-lg shadow-[#006fff]/20 disabled:opacity-50">{importing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}{importing ? "Importando..." : "Importar Datos"}</button>
          </div>
        </div>}

        {step === 2 && <div className="space-y-6">
          <div className="text-center">
            <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-[#f0fdf4]"><CheckCircle className="h-8 w-8 text-[#16a34a]" /></div>
            <h2 className="mt-4 text-lg font-semibold text-[#16a34a]">Importacion completada</h2>
            <p className="mt-1 text-sm text-[#475569]">{importResult?.message ?? "Tus datos han sido importados correctamente."}</p>
          </div>

          {importResult?.imported && (
            <div className="mx-auto max-w-sm space-y-2 text-left">
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-sm text-[#475569]">Planes importados</span>
                <span className="text-sm font-bold text-[#0f172a]">{importResult.imported.plans}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-sm text-[#475569]">Planes ya existentes</span>
                <span className="text-sm font-medium text-[#94a3b8]">{importResult.imported.plans_skipped}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-sm text-[#475569]">Clientes importados</span>
                <span className="text-sm font-bold text-[#0f172a]">{importResult.imported.clients}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-sm text-[#475569]">Clientes ya existentes</span>
                <span className="text-sm font-medium text-[#94a3b8]">{importResult.imported.clients_skipped}</span>
              </div>
            </div>
          )}

          {/* Security recommendations */}
          <div className="border-t border-[#e2e8f0] pt-6">
            <h3 className="text-base font-semibold text-[#0f172a] mb-1">Paso 3: Seguridad Recomendada</h3>
            <p className="text-sm text-[#475569] mb-4">Selecciona las reglas de seguridad que quieres aplicar a tu MikroTik.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {securityCards.map(card => {
                const Icon = card.icon;
                const isSelected = selectedSecurity.has(card.key);
                return (
                  <button key={card.key} onClick={() => toggleSecurity(card.key)} className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${isSelected ? "border-[#006fff] bg-[#eff6ff]" : "border-[#e2e8f0] bg-white hover:border-[#cbd5e1]"}`}>
                    <div className={`shrink-0 rounded-lg p-2 ${isSelected ? "bg-[#006fff]/10 text-[#006fff]" : "bg-[#f5f7fa] text-[#94a3b8]"}`}><Icon className="h-4 w-4" /></div>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${isSelected ? "text-[#006fff]" : "text-[#0f172a]"}`}>{card.title}</p>
                      <p className="mt-0.5 text-xs text-[#475569]">{card.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-center gap-3">
            <button onClick={() => setStep(3)} className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] px-6 py-3 text-sm text-[#475569] hover:bg-[#f5f7fa]">Omitir seguridad</button>
            <button onClick={applySecurity} disabled={applyingSecurity || selectedSecurity.size === 0} className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 disabled:opacity-50">{applyingSecurity ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}{applyingSecurity ? "Aplicando..." : `Aplicar ${selectedSecurity.size} regla${selectedSecurity.size !== 1 ? "s" : ""}`}</button>
          </div>
        </div>}

        {step === 3 && <div className="text-center space-y-6">
          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-[#f0fdf4]"><CheckCircle className="h-8 w-8 text-[#16a34a]" /></div>
          <h2 className="text-lg font-semibold text-[#16a34a]">Configuracion completa</h2>
          <p className="text-sm text-[#475569]">Tu red ha sido importada y configurada correctamente.</p>

          {/* Security results */}
          {Object.keys(securityResults).length > 0 && (
            <div className="mx-auto max-w-sm space-y-2 text-left">
              {Object.entries(securityResults).map(([key, result]) => {
                const card = securityCards.find(c => c.key === key);
                return (
                  <div key={key} className={`flex items-center justify-between rounded-xl px-4 py-3 ${result.success ? "bg-[#f0fdf4]" : "bg-[#fef2f2]"}`}>
                    <span className="text-sm text-[#475569]">{card?.title ?? key}</span>
                    <span className={`text-xs font-medium ${result.success ? "text-[#16a34a]" : "text-[#dc2626]"}`}>{result.success ? "Aplicado" : "Error"}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Import summary */}
          {importResult?.imported && (
            <div className="mx-auto max-w-sm space-y-2 text-left">
              <p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8] mb-1">Resumen de importacion</p>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-sm text-[#475569]">Planes</span>
                <span className="text-sm font-bold text-[#0f172a]">{importResult.imported.plans} nuevos, {importResult.imported.plans_skipped} existentes</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-sm text-[#475569]">Clientes</span>
                <span className="text-sm font-bold text-[#0f172a]">{importResult.imported.clients} nuevos, {importResult.imported.clients_skipped} existentes</span>
              </div>
            </div>
          )}

          <button onClick={() => navigate("/")} className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white hover:bg-[#005ce6]"><LayoutDashboard className="h-4 w-4" />Ir al Dashboard</button>
        </div>}
      </div>
    </div>
  );
}
