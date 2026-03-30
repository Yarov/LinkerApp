"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  Gauge,
  Globe,
  Lock,
  ShieldAlert,
  Save,
  ArrowLeft,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Zap,
} from "lucide-react";
import Skeleton from "@/components/Skeleton";
import { useMikrotik } from "@/contexts/MikrotikContext";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NetworkHealth {
  firewall: { status: "professional" | "basic" | "none"; ruleCount: number };
  qos: { status: "configured" | "basic" | "none"; queueCount: number };
  dns: { cacheEnabled: boolean; servers: string[] };
  clientIsolation: boolean;
  antiDdos: boolean;
  pppoeServer: { active: boolean; clientCount: number };
  backup: { lastBackup: string | null };
  nat: { masquerade: boolean };
  error?: string;
}

interface ActionResult {
  success: boolean;
  message: string;
}

interface ApplyResponse {
  results: Record<string, ActionResult>;
  errors: string[];
  error?: string;
}

type ActionKey = "firewall" | "qos" | "dns" | "clientIsolation" | "antiDdos" | "backup";

interface CardConfig {
  key: ActionKey;
  title: string;
  description: string;
  icon: React.ElementType;
  getStatus: (health: NetworkHealth) => "configured" | "basic" | "none";
  getStatusLabel: (health: NetworkHealth) => string;
}

// ─── Card Configurations ─────────────────────────────────────────────────────

const cards: CardConfig[] = [
  {
    key: "firewall",
    title: "Firewall Profesional",
    description: "Protege tu red de ataques y accesos no autorizados. 30+ reglas de seguridad.",
    icon: Shield,
    getStatus: (h) => h.firewall.status === "professional" ? "configured" : h.firewall.status === "basic" ? "basic" : "none",
    getStatusLabel: (h) => h.firewall.ruleCount > 0 ? `${h.firewall.ruleCount} reglas` : "Sin reglas",
  },
  {
    key: "qos",
    title: "QoS (Calidad de Servicio)",
    description: "Distribuye el ancho de banda equitativamente. Evita que un cliente sature la red.",
    icon: Gauge,
    getStatus: (h) => h.qos.status,
    getStatusLabel: (h) => h.qos.queueCount > 0 ? `${h.qos.queueCount} queues` : "Sin queues",
  },
  {
    key: "dns",
    title: "DNS Cache",
    description: "Navegacion mas rapida para tus clientes. Reduce consumo de ancho de banda.",
    icon: Globe,
    getStatus: (h) => h.dns.cacheEnabled ? "configured" : "none",
    getStatusLabel: (h) => h.dns.cacheEnabled ? h.dns.servers.join(", ") : "Deshabilitado",
  },
  {
    key: "clientIsolation",
    title: "Aislamiento de Clientes",
    description: "Los clientes no pueden verse entre si. Protege la privacidad.",
    icon: Lock,
    getStatus: (h) => h.clientIsolation ? "configured" : "none",
    getStatusLabel: () => "",
  },
  {
    key: "antiDdos",
    title: "Proteccion Anti-DDoS",
    description: "Proteccion contra ataques de denegacion de servicio y escaneo de puertos.",
    icon: ShieldAlert,
    getStatus: (h) => h.antiDdos ? "configured" : "none",
    getStatusLabel: () => "",
  },
  {
    key: "backup",
    title: "Backup",
    description: "Respaldo de la configuracion del MikroTik. Recuperate de cualquier problema.",
    icon: Save,
    getStatus: (h) => h.backup.lastBackup ? "configured" : "none",
    getStatusLabel: (h) => h.backup.lastBackup ? `Ultimo: ${h.backup.lastBackup}` : "Sin backups",
  },
];

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadgeWizard({ status }: { status: "configured" | "basic" | "none" }) {
  const config = {
    configured: {
      label: "Configurado",
      bg: "bg-[#f0fdf4]",
      text: "text-[#16a34a]",
      border: "border-[#16a34a]/20",
      dot: "bg-[#16a34a]",
    },
    basic: {
      label: "Basico",
      bg: "bg-[#fffbeb]",
      text: "text-[#b45309]",
      border: "border-[#f59e0b]/20",
      dot: "bg-[#f59e0b]",
    },
    none: {
      label: "No configurado",
      bg: "bg-[#fef2f2]",
      text: "text-[#dc2626]",
      border: "border-[#dc2626]/20",
      dot: "bg-[#dc2626]",
    },
  };

  const c = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${c.bg} ${c.text} ${c.border}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function WizardPage() {
  const router = useRouter();
  const { connected: mikrotikConnected } = useMikrotik();

  // Health state
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState("");

  // QoS bandwidth inputs
  const [bwDown, setBwDown] = useState(50);
  const [bwUp, setBwUp] = useState(50);

  // Apply state
  const [applyingActions, setApplyingActions] = useState<Set<ActionKey>>(new Set());
  const [applyResults, setApplyResults] = useState<Record<string, ActionResult>>({});
  const [applyingAll, setApplyingAll] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // ── Fetch health ──

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError("");
    try {
      const res = await fetch("/api/network/health");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al obtener estado de la red");
      }
      const data: NetworkHealth = await res.json();
      setHealth(data);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mikrotikConnected) {
      fetchHealth();
    } else {
      setHealthLoading(false);
      setHealthError("MikroTik no esta conectado");
    }
  }, [mikrotikConnected, fetchHealth]);

  // ── Apply single action ──

  const applyAction = async (action: ActionKey) => {
    setApplyingActions((prev) => new Set(prev).add(action));
    setApplyResults((prev) => {
      const next = { ...prev };
      delete next[action];
      return next;
    });

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

      const data: ApplyResponse = await res.json();

      if (data.error) {
        setApplyResults((prev) => ({
          ...prev,
          [action]: { success: false, message: data.error! },
        }));
        showToast(data.error, "error");
      } else if (data.results[action]) {
        setApplyResults((prev) => ({ ...prev, [action]: data.results[action] }));
        if (data.results[action].success) {
          showToast(data.results[action].message, "success");
        } else {
          showToast(data.results[action].message, "error");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de red";
      setApplyResults((prev) => ({
        ...prev,
        [action]: { success: false, message: msg },
      }));
      showToast(msg, "error");
    } finally {
      setApplyingActions((prev) => {
        const next = new Set(prev);
        next.delete(action);
        return next;
      });
      // Refresh health after applying
      fetchHealth();
    }
  };

  // ── Apply all actions ──

  const applyAll = async () => {
    setApplyingAll(true);
    setApplyResults({});
    const allKeys: ActionKey[] = ["firewall", "qos", "dns", "clientIsolation", "antiDdos", "backup"];
    setApplyingActions(new Set(allKeys));

    try {
      const res = await fetch("/api/network/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actions: ["all"],
          totalBandwidthDown: bwDown,
          totalBandwidthUp: bwUp,
        }),
      });

      const data: ApplyResponse = await res.json();

      if (data.error) {
        showToast(data.error, "error");
      } else {
        setApplyResults(data.results);
        const successCount = Object.values(data.results).filter((r) => r.success).length;
        const failCount = Object.values(data.results).filter((r) => !r.success).length;
        if (failCount === 0) {
          showToast(`Todas las mejoras aplicadas correctamente (${successCount})`, "success");
        } else {
          showToast(`${successCount} aplicadas, ${failCount} con errores`, "error");
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error de red", "error");
    } finally {
      setApplyingAll(false);
      setApplyingActions(new Set());
      fetchHealth();
    }
  };

  // ── Toast helper ──

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  };

  // ── Disconnected state ──

  if (!mikrotikConnected && !healthLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/red")}
            className="rounded-xl p-2 text-[#475569] transition-colors hover:bg-[#f5f7fa] hover:text-[#0f172a]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
              Asistente de Red
            </h1>
            <p className="mt-0.5 text-sm text-[#475569]">
              Configura tu MikroTik con las mejores practicas para WISP
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-20">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fef2f2]">
              <AlertCircle className="h-7 w-7 text-[#dc2626]" />
            </div>
            <h2 className="text-lg font-semibold text-[#0f172a]">MikroTik Desconectado</h2>
            <p className="mt-2 max-w-sm text-sm text-[#475569]">
              El asistente de red necesita una conexion activa con tu MikroTik para analizar y configurar la red.
            </p>
            <button
              onClick={() => router.push("/configuracion")}
              className="mt-6 rounded-xl bg-[#006fff] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
            >
              Ir a Configuracion
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/red")}
            className="rounded-xl p-2 text-[#475569] transition-colors hover:bg-[#f5f7fa] hover:text-[#0f172a]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
              Asistente de Red
            </h1>
            <p className="mt-0.5 text-sm text-[#475569]">
              Configura tu MikroTik con las mejores practicas para WISP
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchHealth}
            disabled={healthLoading}
            className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa] hover:text-[#0f172a] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${healthLoading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <button
            onClick={applyAll}
            disabled={applyingAll || healthLoading || !!healthError}
            className="flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#0057cc] hover:shadow-[#006fff]/30 disabled:opacity-50 disabled:shadow-none"
          >
            {applyingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {applyingAll ? "Aplicando..." : "Aplicar Todas las Mejoras"}
          </button>
        </div>
      </div>

      {/* Error state */}
      {healthError && !healthLoading && (
        <div className="rounded-2xl border border-[#dc2626]/20 bg-[#fef2f2] p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-[#dc2626]" />
          <p className="mt-3 text-sm font-medium text-[#dc2626]">{healthError}</p>
          <button
            onClick={fetchHealth}
            className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Network Info Summary */}
      {health && !healthError && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-[#eff6ff] p-2.5">
                <Shield className="h-5 w-5 text-[#006fff]" />
              </div>
              <div>
                <p className="text-xs text-[#94a3b8]">Firewall</p>
                <p className="text-lg font-semibold text-[#0f172a]">{health.firewall.ruleCount} reglas</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-[#f0fdf4] p-2.5">
                <Zap className="h-5 w-5 text-[#16a34a]" />
              </div>
              <div>
                <p className="text-xs text-[#94a3b8]">PPPoE Clientes</p>
                <p className="text-lg font-semibold text-[#0f172a]">
                  {health.pppoeServer.clientCount} activos
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-[#f5f3ff] p-2.5">
                <Globe className="h-5 w-5 text-[#7c4dff]" />
              </div>
              <div>
                <p className="text-xs text-[#94a3b8]">NAT</p>
                <p className="text-lg font-semibold text-[#0f172a]">
                  {health.nat.masquerade ? "Masquerade activo" : "Sin NAT"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Health Cards Grid */}
      {healthLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="mt-4 h-5 w-40" />
              <Skeleton className="mt-2 h-4 w-full" />
              <Skeleton className="mt-1 h-4 w-3/4" />
              <Skeleton className="mt-5 h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : health && !healthError ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            const status = card.getStatus(health);
            const statusLabel = card.getStatusLabel(health);
            const isApplying = applyingActions.has(card.key);
            const result = applyResults[card.key];
            const isConfigured = status === "configured";

            return (
              <div
                key={card.key}
                className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300 ${
                  isApplying
                    ? "border-[#006fff]/40 shadow-md shadow-[#006fff]/10"
                    : result?.success
                      ? "border-[#16a34a]/30"
                      : result && !result.success
                        ? "border-[#dc2626]/30"
                        : "border-[#e2e8f0]"
                }`}
              >
                {/* Applying overlay */}
                {isApplying && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-[#006fff]" />
                      <p className="text-sm font-medium text-[#006fff]">Configurando...</p>
                    </div>
                  </div>
                )}

                <div className="p-6">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div
                      className={`rounded-xl p-2.5 ${
                        isConfigured
                          ? "bg-[#f0fdf4] text-[#16a34a]"
                          : status === "basic"
                            ? "bg-[#fffbeb] text-[#b45309]"
                            : "bg-[#f5f7fa] text-[#94a3b8]"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <StatusBadgeWizard status={status} />
                  </div>

                  {/* Title & Description */}
                  <h3 className="mt-4 text-sm font-semibold text-[#0f172a]">{card.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#475569]">{card.description}</p>

                  {/* Status detail */}
                  {statusLabel && (
                    <p className="mt-2 font-mono text-[10px] text-[#94a3b8]">{statusLabel}</p>
                  )}

                  {/* QoS bandwidth inputs */}
                  {card.key === "qos" && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                        Ancho de banda total
                      </p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-[#f5f7fa] px-2.5 py-1.5">
                            <input
                              type="number"
                              min={1}
                              max={10000}
                              value={bwDown}
                              onChange={(e) => setBwDown(parseInt(e.target.value) || 1)}
                              className="w-full bg-transparent text-xs text-[#0f172a] outline-none"
                            />
                            <span className="shrink-0 text-[10px] text-[#94a3b8]">Mbps</span>
                          </div>
                          <p className="mt-0.5 text-center text-[9px] text-[#94a3b8]">Bajada</p>
                        </div>
                        <span className="text-xs text-[#94a3b8]">/</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-[#f5f7fa] px-2.5 py-1.5">
                            <input
                              type="number"
                              min={1}
                              max={10000}
                              value={bwUp}
                              onChange={(e) => setBwUp(parseInt(e.target.value) || 1)}
                              className="w-full bg-transparent text-xs text-[#0f172a] outline-none"
                            />
                            <span className="shrink-0 text-[10px] text-[#94a3b8]">Mbps</span>
                          </div>
                          <p className="mt-0.5 text-center text-[9px] text-[#94a3b8]">Subida</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Result message */}
                  {result && (
                    <div
                      className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                        result.success
                          ? "bg-[#f0fdf4] text-[#16a34a]"
                          : "bg-[#fef2f2] text-[#dc2626]"
                      }`}
                    >
                      {result.success ? (
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{result.message}</span>
                    </div>
                  )}

                  {/* Action button */}
                  <button
                    onClick={() => applyAction(card.key)}
                    disabled={isApplying || applyingAll}
                    className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 disabled:opacity-50 ${
                      isConfigured
                        ? "border border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f5f7fa] hover:text-[#0f172a]"
                        : "bg-[#006fff] text-white shadow-sm hover:bg-[#0057cc]"
                    }`}
                  >
                    {isApplying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isConfigured ? (
                      <RefreshCw className="h-4 w-4" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    {isConfigured ? "Actualizar" : "Configurar"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div
            className={`flex items-center gap-3 rounded-xl border px-5 py-3.5 shadow-lg ${
              toast.type === "success"
                ? "border-[#16a34a]/30 bg-[#f0fdf4] text-[#16a34a]"
                : "border-[#dc2626]/30 bg-[#fef2f2] text-[#dc2626]"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle className="h-5 w-5 shrink-0" />
            ) : (
              <XCircle className="h-5 w-5 shrink-0" />
            )}
            <p className="text-sm font-medium">{toast.message}</p>
            <button
              onClick={() => setToast(null)}
              className="ml-2 text-current opacity-60 hover:opacity-100"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
