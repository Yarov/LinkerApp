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
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Zap,
  ChevronDown,
  ChevronUp,
  Trash2,
  Clock,
  Activity,
  AlertTriangle,
  Eye,
  ToggleLeft,
  ToggleRight,
  Info,
  List,
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

interface NetworkLogEntry {
  id: string;
  action: string;
  status: string;
  message: string;
  details: string | null;
  createdAt: string;
}

interface RuleInfo {
  id: string;
  category: string;
  chain?: string;
  action: string;
  comment: string;
  isLinker: boolean;
  disabled: boolean;
  details: Record<string, string>;
  explanation: string;
}

interface CategorySummary {
  total: number;
  linker: number;
  existing: number;
  disabled: number;
  rules: RuleInfo[];
}

interface PreviewRule {
  chain: string;
  action: string;
  comment: string;
  explanation: string;
}

interface PreviewData {
  willCreate: PreviewRule[];
  willSkip: { comment: string; reason: string }[];
  existingRules: number;
  newRules: number;
  totalPlanned: number;
  warning?: string;
}

type ActionKey = "firewall" | "qos" | "dns" | "clientIsolation" | "antiDdos" | "backup";

interface CardConfig {
  key: ActionKey;
  rulesType: string;
  title: string;
  description: string;
  icon: React.ElementType;
  getStatus: (health: NetworkHealth) => "configured" | "basic" | "none";
  getStatusLabel: (health: NetworkHealth) => string;
  getDetail: (health: NetworkHealth) => string;
}

// ─── Card Configurations ─────────────────────────────────────────────────────

const cards: CardConfig[] = [
  {
    key: "firewall",
    rulesType: "firewall",
    title: "Firewall Profesional",
    description: "Protege tu red de ataques y accesos no autorizados. 30+ reglas de seguridad.",
    icon: Shield,
    getStatus: (h) => h.firewall.status === "professional" ? "configured" : h.firewall.status === "basic" ? "basic" : "none",
    getStatusLabel: (h) => h.firewall.ruleCount > 0 ? `${h.firewall.ruleCount} reglas activas` : "Sin reglas",
    getDetail: (h) => h.firewall.ruleCount > 0 ? `${h.firewall.ruleCount} reglas de firewall configuradas` : "No hay reglas configuradas",
  },
  {
    key: "qos",
    rulesType: "qos",
    title: "QoS (Calidad de Servicio)",
    description: "Distribuye el ancho de banda equitativamente. Evita que un cliente sature la red.",
    icon: Gauge,
    getStatus: (h) => h.qos.status,
    getStatusLabel: (h) => h.qos.queueCount > 0 ? `${h.qos.queueCount} queues activos` : "Sin queues",
    getDetail: (h) => h.qos.queueCount > 0 ? `${h.qos.queueCount} queue trees configurados` : "No hay queues configurados",
  },
  {
    key: "dns",
    rulesType: "dns",
    title: "DNS Cache",
    description: "Navegacion mas rapida para tus clientes. Reduce consumo de ancho de banda.",
    icon: Globe,
    getStatus: (h) => h.dns.cacheEnabled ? "configured" : "none",
    getStatusLabel: (h) => h.dns.cacheEnabled ? `${h.dns.servers.length} servidores` : "Deshabilitado",
    getDetail: (h) => h.dns.cacheEnabled ? `Servidores: ${h.dns.servers.join(", ")}` : "DNS cache no esta habilitado",
  },
  {
    key: "clientIsolation",
    rulesType: "isolation",
    title: "Aislamiento de Clientes",
    description: "Los clientes no pueden verse entre si. Protege la privacidad.",
    icon: Lock,
    getStatus: (h) => h.clientIsolation ? "configured" : "none",
    getStatusLabel: () => "",
    getDetail: (h) => h.clientIsolation ? "Aislamiento activo en bridges" : "Los clientes pueden verse entre si",
  },
  {
    key: "antiDdos",
    rulesType: "antiddos",
    title: "Proteccion Anti-DDoS",
    description: "Proteccion contra ataques de denegacion de servicio y escaneo de puertos.",
    icon: ShieldAlert,
    getStatus: (h) => h.antiDdos ? "configured" : "none",
    getStatusLabel: () => "",
    getDetail: (h) => h.antiDdos ? "Reglas anti-DDoS activas en raw table" : "Sin proteccion anti-DDoS",
  },
  {
    key: "backup",
    rulesType: "",
    title: "Backup",
    description: "Respaldo de la configuracion del MikroTik. Recuperate de cualquier problema.",
    icon: Save,
    getStatus: (h) => h.backup.lastBackup ? "configured" : "none",
    getStatusLabel: (h) => h.backup.lastBackup ? `Ultimo: ${h.backup.lastBackup}` : "Sin backups",
    getDetail: (h) => h.backup.lastBackup ? `Ultimo backup: ${h.backup.lastBackup}` : "No se han creado backups",
  },
];

// ─── Action label map ────────────────────────────────────────────────────────

const actionLabels: Record<string, string> = {
  firewall: "Firewall aplicado",
  qos: "QoS configurado",
  dns: "DNS Cache activado",
  clientIsolation: "Aislamiento configurado",
  antiDdos: "Anti-DDoS aplicado",
  backup: "Backup creado",
};

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "configured" | "basic" | "none" }) {
  const config = {
    configured: {
      label: "Activo",
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

// ─── Chain Badge ─────────────────────────────────────────────────────────────

function ChainBadge({ chain }: { chain: string }) {
  const colors: Record<string, string> = {
    input: "bg-[#eff6ff] text-[#2563eb] border-[#2563eb]/20",
    forward: "bg-[#f0fdf4] text-[#16a34a] border-[#16a34a]/20",
    srcnat: "bg-[#f5f3ff] text-[#7c3aed] border-[#7c3aed]/20",
    prerouting: "bg-[#fdf4ff] text-[#a21caf] border-[#a21caf]/20",
    global: "bg-[#f0f9ff] text-[#0891b2] border-[#0891b2]/20",
    simple: "bg-[#fff7ed] text-[#c2410c] border-[#c2410c]/20",
    config: "bg-[#f5f7fa] text-[#475569] border-[#e2e8f0]",
  };
  const cls = colors[chain] || "bg-[#f5f7fa] text-[#475569] border-[#e2e8f0]";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {chain}
    </span>
  );
}

// ─── Action Badge ────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    accept: "bg-[#f0fdf4] text-[#16a34a] border-[#16a34a]/20",
    drop: "bg-[#fef2f2] text-[#dc2626] border-[#dc2626]/20",
    "fasttrack connection": "bg-[#ecfeff] text-[#0891b2] border-[#0891b2]/20",
    "add-src-to-address-list": "bg-[#fffbeb] text-[#b45309] border-[#f59e0b]/20",
    queue: "bg-[#f0f9ff] text-[#0891b2] border-[#0891b2]/20",
    pcq: "bg-[#ecfeff] text-[#0891b2] border-[#0891b2]/20",
    set: "bg-[#f5f3ff] text-[#7c3aed] border-[#7c3aed]/20",
    habilitado: "bg-[#f0fdf4] text-[#16a34a] border-[#16a34a]/20",
    deshabilitado: "bg-[#fef2f2] text-[#dc2626] border-[#dc2626]/20",
  };
  const label = action.length > 20 ? action.slice(0, 17) + "..." : action;
  const cls = colors[action] || "bg-[#f5f7fa] text-[#475569] border-[#e2e8f0]";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ─── Toggle Switch ───────────────────────────────────────────────────────────

function ToggleSwitch({
  enabled,
  disabled: isDisabledProp,
  loading,
  onToggle,
}: {
  enabled: boolean;
  disabled?: boolean;
  loading?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={isDisabledProp || loading}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
        enabled ? "bg-[#16a34a]" : "bg-[#e2e8f0]"
      } ${isDisabledProp ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {loading ? (
        <Loader2 className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
      ) : (
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            enabled ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      )}
    </button>
  );
}

// ─── Relative time helper ────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "hace un momento";
  if (diffMins < 60) return `hace ${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `hace ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `hace ${diffDays}d`;
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

// ─── Rule Viewer Component ──────────────────────────────────────────────────

function RuleViewer({
  category,
  rulesData,
  rulesLoading,
  onToggleRule,
  togglingRules,
}: {
  category: CategorySummary | null;
  rulesData: CategorySummary | null;
  rulesLoading: boolean;
  onToggleRule: (ruleId: string, currentDisabled: boolean) => void;
  togglingRules: Set<string>;
}) {
  if (rulesLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="h-5 w-16 rounded-md" />
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto h-5 w-9 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  const data = rulesData || category;
  if (!data || data.rules.length === 0) {
    return (
      <div className="py-6 text-center">
        <List className="mx-auto h-6 w-6 text-[#e2e8f0]" />
        <p className="mt-2 text-xs text-[#94a3b8]">No hay reglas configuradas</p>
      </div>
    );
  }

  const linkerRules = data.rules.filter((r) => r.isLinker);
  const existingRules = data.rules.filter((r) => !r.isLinker);

  return (
    <div>
      {/* Summary bar */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 rounded-lg bg-[#eff6ff] px-2.5 py-1 text-[11px] font-medium text-[#2563eb]">
          <Shield className="h-3 w-3" />
          {data.linker} Linker
        </span>
        {data.existing > 0 && (
          <span className="flex items-center gap-1.5 rounded-lg bg-[#f5f7fa] px-2.5 py-1 text-[11px] font-medium text-[#475569]">
            {data.existing} existentes
          </span>
        )}
        {data.disabled > 0 && (
          <span className="flex items-center gap-1.5 rounded-lg bg-[#fffbeb] px-2.5 py-1 text-[11px] font-medium text-[#b45309]">
            {data.disabled} desactivadas
          </span>
        )}
        <span className="ml-auto text-[11px] text-[#94a3b8]">
          {data.total} reglas en total
        </span>
      </div>

      {/* Rules table */}
      <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
              <th className="px-3 py-2.5 text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                Cadena
              </th>
              <th className="px-3 py-2.5 text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                Accion
              </th>
              <th className="px-3 py-2.5 text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                Descripcion
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Linker rules */}
            {linkerRules.map((rule, idx) => (
              <tr
                key={rule.id}
                className={`border-l-2 transition-colors ${
                  idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                } border-l-[#006fff]/30 hover:bg-[#eff6ff]/50`}
              >
                <td className="px-3 py-2">
                  {rule.chain && <ChainBadge chain={rule.chain} />}
                </td>
                <td className="px-3 py-2">
                  <ActionBadge action={rule.action} />
                </td>
                <td className="px-3 py-2">
                  <div>
                    <p className="text-xs font-medium text-[#0f172a]">
                      {rule.explanation}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[#94a3b8]">
                      {rule.comment}
                    </p>
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className={`text-[10px] font-medium ${rule.disabled ? "text-[#94a3b8]" : "text-[#16a34a]"}`}>
                      {rule.disabled ? "Inactiva" : "Activa"}
                    </span>
                    <ToggleSwitch
                      enabled={!rule.disabled}
                      loading={togglingRules.has(rule.id)}
                      onToggle={() => onToggleRule(rule.id, rule.disabled)}
                    />
                  </div>
                </td>
              </tr>
            ))}

            {/* Separator */}
            {existingRules.length > 0 && linkerRules.length > 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-[#e2e8f0]" />
                    <span className="text-[10px] font-medium text-[#94a3b8]">
                      Reglas existentes (no Linker)
                    </span>
                    <div className="h-px flex-1 bg-[#e2e8f0]" />
                  </div>
                </td>
              </tr>
            )}

            {/* Existing rules */}
            {existingRules.map((rule, idx) => (
              <tr
                key={rule.id}
                className={`border-l-2 border-l-[#e2e8f0] transition-colors ${
                  idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                } hover:bg-[#f5f7fa]`}
              >
                <td className="px-3 py-2">
                  {rule.chain && <ChainBadge chain={rule.chain} />}
                </td>
                <td className="px-3 py-2">
                  <ActionBadge action={rule.action} />
                </td>
                <td className="px-3 py-2">
                  <div>
                    <p className="text-xs text-[#475569]">
                      {rule.comment || rule.explanation}
                    </p>
                    {rule.comment && (
                      <p className="mt-0.5 text-[10px] text-[#cbd5e1]">
                        {rule.explanation}
                      </p>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={`text-[10px] font-medium ${rule.disabled ? "text-[#94a3b8]" : "text-[#475569]"}`}>
                    {rule.disabled ? "Inactiva" : "Activa"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Preview Modal ──────────────────────────────────────────────────────────

function PreviewModal({
  actionKey,
  title,
  previewData,
  previewLoading,
  onConfirm,
  onCancel,
  confirming,
}: {
  actionKey: ActionKey;
  title: string;
  previewData: PreviewData | null;
  previewLoading: boolean;
  onConfirm: (action: ActionKey) => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-xl">
        {/* Header */}
        <div className="border-b border-[#e2e8f0] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#eff6ff] p-2">
              <Eye className="h-5 w-5 text-[#006fff]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#0f172a]">
                Reglas que se van a aplicar
              </h3>
              <p className="text-xs text-[#475569]">{title}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[50vh] overflow-y-auto px-6 py-4">
          {previewLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-5 w-16 rounded-md" />
                  <Skeleton className="h-5 w-14 rounded-md" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </div>
          ) : previewData ? (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5 rounded-lg bg-[#f0fdf4] px-3 py-1.5 text-xs font-medium text-[#16a34a]">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Se crearan {previewData.newRules} reglas nuevas
                </span>
                {previewData.willSkip.length > 0 && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-[#fffbeb] px-3 py-1.5 text-xs font-medium text-[#b45309]">
                    <Info className="h-3.5 w-3.5" />
                    {previewData.willSkip.length} ya existen
                  </span>
                )}
                {previewData.existingRules > 0 && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-[#f5f7fa] px-3 py-1.5 text-xs font-medium text-[#475569]">
                    Se mantendran {previewData.existingRules} reglas existentes
                  </span>
                )}
              </div>

              {previewData.warning && (
                <div className="flex items-start gap-2 rounded-xl bg-[#fffbeb] px-3 py-2 text-xs text-[#b45309]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{previewData.warning}</span>
                </div>
              )}

              {/* Rules that will be created */}
              {previewData.willCreate.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                    Reglas nuevas
                  </p>
                  <div className="space-y-1.5">
                    {previewData.willCreate.map((rule, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-3 rounded-lg border-l-2 border-l-[#006fff]/30 px-3 py-2 ${
                          idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                        }`}
                      >
                        <ChainBadge chain={rule.chain} />
                        <ActionBadge action={rule.action} />
                        <div className="flex-1">
                          <p className="text-xs text-[#0f172a]">{rule.explanation}</p>
                          <p className="mt-0.5 text-[10px] text-[#94a3b8]">{rule.comment}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rules that already exist */}
              {previewData.willSkip.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                    Ya existentes (se omitiran)
                  </p>
                  <div className="space-y-1">
                    {previewData.willSkip.map((rule, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 rounded-lg bg-[#f5f7fa] px-3 py-1.5 text-xs text-[#94a3b8]"
                      >
                        <CheckCircle className="h-3 w-3 shrink-0 text-[#16a34a]" />
                        <span>{rule.comment}</span>
                        <span className="ml-auto text-[10px]">{rule.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center">
              <AlertCircle className="mx-auto h-6 w-6 text-[#dc2626]" />
              <p className="mt-2 text-sm text-[#dc2626]">Error al cargar vista previa</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-[#e2e8f0] px-6 py-4">
          <button
            onClick={() => onConfirm(actionKey)}
            disabled={confirming || previewLoading || !previewData}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc] disabled:opacity-50"
          >
            {confirming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            {confirming ? "Aplicando..." : "Confirmar y aplicar"}
          </button>
          <button
            onClick={onCancel}
            disabled={confirming}
            className="rounded-xl border border-[#e2e8f0] bg-white px-6 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa] disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SeguridadPage() {
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

  // Expanded card
  const [expandedCard, setExpandedCard] = useState<ActionKey | null>(null);

  // Rules data
  const [rulesData, setRulesData] = useState<Record<string, CategorySummary>>({});
  const [rulesLoading, setRulesLoading] = useState<Record<string, boolean>>({});
  const [togglingRules, setTogglingRules] = useState<Set<string>>(new Set());

  // Activity log
  const [logs, setLogs] = useState<NetworkLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsTotal, setLogsTotal] = useState(0);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Last applied timestamps (from logs)
  const [lastApplied, setLastApplied] = useState<Record<string, string>>({});

  // Firewall safe mode dialog
  const [showFirewallWarning, setShowFirewallWarning] = useState(false);
  const [firewallExistingCount, setFirewallExistingCount] = useState(0);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);

  // Preview modal
  const [previewAction, setPreviewAction] = useState<ActionKey | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  // ── Fetch logs ──

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/network/log?limit=20");
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setLogsTotal(data.total || 0);
        const applied: Record<string, string> = {};
        for (const log of data.logs || []) {
          if (log.status === "success" && !applied[log.action]) {
            applied[log.action] = log.createdAt;
          }
        }
        setLastApplied(applied);
      }
    } catch {
      // ignore
    } finally {
      setLogsLoading(false);
    }
  }, []);

  // ── Fetch rules for a category ──

  const fetchRules = useCallback(async (type: string) => {
    setRulesLoading((prev) => ({ ...prev, [type]: true }));
    try {
      const res = await fetch(`/api/network/rules?type=${type}`);
      if (res.ok) {
        const data = await res.json();
        if (!data.error) {
          setRulesData((prev) => ({ ...prev, ...data }));
        }
      }
    } catch {
      // ignore
    } finally {
      setRulesLoading((prev) => ({ ...prev, [type]: false }));
    }
  }, []);

  // ── Toggle rule ──

  const toggleRule = useCallback(async (ruleId: string, currentDisabled: boolean) => {
    setTogglingRules((prev) => new Set(prev).add(ruleId));
    try {
      const res = await fetch(`/api/network/rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: !currentDisabled }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message, "success");
        // Update rule in local state
        setRulesData((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            next[key] = {
              ...next[key],
              rules: next[key].rules.map((r) =>
                r.id === ruleId ? { ...r, disabled: !currentDisabled } : r
              ),
              disabled: next[key].rules.reduce(
                (count, r) => count + (r.id === ruleId ? (!currentDisabled ? 1 : 0) : r.disabled ? 1 : 0),
                0
              ),
            };
          }
          return next;
        });
      } else {
        showToast(data.error || "Error al modificar regla", "error");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error de red", "error");
    } finally {
      setTogglingRules((prev) => {
        const next = new Set(prev);
        next.delete(ruleId);
        return next;
      });
    }
  }, []);

  // ── Fetch preview ──

  const fetchPreview = useCallback(async (action: ActionKey) => {
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const res = await fetch("/api/network/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data: PreviewData = await res.json();
        setPreviewData(data);
      }
    } catch {
      // ignore
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mikrotikConnected) {
      fetchHealth();
    } else {
      setHealthLoading(false);
      setHealthError("MikroTik no esta conectado");
    }
    fetchLogs();
  }, [mikrotikConnected, fetchHealth, fetchLogs]);

  // When a card is expanded, fetch its rules
  useEffect(() => {
    if (expandedCard && expandedCard !== "backup") {
      const card = cards.find((c) => c.key === expandedCard);
      if (card && card.rulesType) {
        fetchRules(card.rulesType);
      }
    }
  }, [expandedCard, fetchRules]);

  // ── Apply single action ──

  const doApplyAction = async (action: ActionKey) => {
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
      fetchHealth();
      fetchLogs();
      // Refresh rules if the card is expanded
      const card = cards.find((c) => c.key === action);
      if (card && card.rulesType && expandedCard === action) {
        fetchRules(card.rulesType);
      }
    }
  };

  // ── Show preview before applying ──

  const applyAction = async (action: ActionKey) => {
    if (action === "backup") {
      // Backup doesn't need preview
      doApplyAction(action);
      return;
    }

    // For firewall with existing rules, show firewall warning first
    if (action === "firewall" && health && health.firewall.ruleCount > 0) {
      const nonLinkerCount = health.firewall.ruleCount;
      setFirewallExistingCount(nonLinkerCount);
      setShowFirewallWarning(true);
      return;
    }

    // Show preview modal
    setPreviewAction(action);
    fetchPreview(action);
  };

  const handlePreviewConfirm = (action: ActionKey) => {
    setPreviewAction(null);
    setPreviewData(null);
    doApplyAction(action);
  };

  const handlePreviewCancel = () => {
    setPreviewAction(null);
    setPreviewData(null);
  };

  const handleFirewallAddMissing = () => {
    setShowFirewallWarning(false);
    // Show preview after firewall warning
    setPreviewAction("firewall");
    fetchPreview("firewall");
  };

  const handleFirewallReplaceAll = () => {
    setShowFirewallWarning(false);
    setShowReplaceConfirm(true);
  };

  const confirmReplaceAll = () => {
    setShowReplaceConfirm(false);
    doApplyAction("firewall");
  };

  // ── Bulk toggle all LK rules ──

  const bulkToggleRules = async (category: string, disable: boolean) => {
    const data = rulesData[category];
    if (!data) return;
    const linkerRules = data.rules.filter((r) => r.isLinker && r.disabled !== disable);
    for (const rule of linkerRules) {
      await toggleRule(rule.id, rule.disabled);
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
      fetchLogs();
    }
  };

  // ── Toast helper ──

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  };

  // ── Health score ──

  const getHealthScore = (): { configured: number; total: number } => {
    if (!health) return { configured: 0, total: 6 };
    let configured = 0;
    for (const card of cards) {
      if (card.getStatus(health) === "configured") configured++;
    }
    return { configured, total: 6 };
  };

  const healthScore = getHealthScore();

  // ── Disconnected state ──

  if (!mikrotikConnected && !healthLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
            Seguridad y Optimizacion de Red
          </h1>
          <p className="mt-0.5 text-sm text-[#475569]">
            Configura tu MikroTik con las mejores practicas para WISP
          </p>
        </div>

        <div className="flex flex-col items-center justify-center py-20">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fef2f2]">
              <AlertCircle className="h-7 w-7 text-[#dc2626]" />
            </div>
            <h2 className="text-lg font-semibold text-[#0f172a]">MikroTik Desconectado</h2>
            <p className="mt-2 max-w-sm text-sm text-[#475569]">
              La seccion de seguridad necesita una conexion activa con tu MikroTik para analizar y configurar la red.
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
            Seguridad y Optimizacion de Red
          </h1>
          <p className="mt-0.5 text-sm text-[#475569]">
            {healthLoading
              ? "Analizando estado de la red..."
              : healthError
                ? "Error al analizar la red"
                : `${healthScore.configured}/${healthScore.total} configuraciones aplicadas`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchHealth(); fetchLogs(); }}
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

      {/* Health Progress Bar */}
      {!healthLoading && !healthError && health && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#006fff]" />
              <span className="text-sm font-medium text-[#0f172a]">Estado de Seguridad</span>
            </div>
            <span className="text-sm font-semibold text-[#006fff]">
              {Math.round((healthScore.configured / healthScore.total) * 100)}%
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#006fff] to-[#38bdf8] transition-all duration-700 ease-out"
              style={{ width: `${(healthScore.configured / healthScore.total) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-xs text-[#475569]">
              <span className="inline-block h-2 w-2 rounded-full bg-[#16a34a]" />
              {healthScore.configured} configuradas
            </span>
            <span className="flex items-center gap-1.5 text-xs text-[#475569]">
              <span className="inline-block h-2 w-2 rounded-full bg-[#dc2626]" />
              {healthScore.total - healthScore.configured} pendientes
            </span>
          </div>
        </div>
      )}

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
            const isExpanded = expandedCard === card.key;
            const lastAppliedTime = lastApplied[card.key];
            const categoryData = rulesData[card.rulesType] || null;
            const isRulesLoading = rulesLoading[card.rulesType] || false;

            return (
              <div
                key={card.key}
                className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300 ${
                  isExpanded ? "md:col-span-2 lg:col-span-3" : ""
                } ${
                  isApplying
                    ? "border-[#006fff]/40 shadow-md shadow-[#006fff]/10"
                    : result?.success
                      ? "border-[#16a34a]/30"
                      : result && !result.success
                        ? "border-[#dc2626]/30"
                        : isConfigured
                          ? "border-[#16a34a]/20"
                          : "border-[#e2e8f0]"
                }`}
              >
                {/* Green check overlay for configured */}
                {isConfigured && !isApplying && (
                  <div className="absolute right-3 top-3">
                    <CheckCircle className="h-5 w-5 text-[#16a34a]" />
                  </div>
                )}

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
                      <Icon className="h-6 w-6" />
                    </div>
                    <StatusBadge status={status} />
                  </div>

                  {/* Title & Description */}
                  <h3 className="mt-4 text-base font-semibold text-[#0f172a]">{card.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#475569]">{card.description}</p>

                  {/* Status detail */}
                  {statusLabel && (
                    <p className="mt-2 text-xs font-medium text-[#0f172a]">{statusLabel}</p>
                  )}

                  {/* Last applied */}
                  {lastAppliedTime && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-[#94a3b8]">
                      <Clock className="h-3 w-3" />
                      Ultima aplicacion: {timeAgo(lastAppliedTime)}
                    </p>
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

                  {/* Action buttons */}
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => applyAction(card.key)}
                      disabled={isApplying || applyingAll}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 disabled:opacity-50 ${
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
                    {card.rulesType && (
                      <button
                        onClick={() => setExpandedCard(isExpanded ? null : card.key)}
                        className="flex items-center gap-1 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-xs font-medium text-[#475569] transition-all hover:bg-[#f5f7fa] hover:text-[#0f172a]"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        Detalles
                      </button>
                    )}
                    {!card.rulesType && (
                      <button
                        onClick={() => setExpandedCard(isExpanded ? null : card.key)}
                        className="flex items-center gap-1 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-xs font-medium text-[#475569] transition-all hover:bg-[#f5f7fa] hover:text-[#0f172a]"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        Detalles
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-[#e2e8f0] bg-[#f8f9fb] px-6 py-4">
                    {/* Rule viewer for categories with rules */}
                    {card.rulesType ? (
                      <div>
                        <div className="mb-4 flex items-center justify-between">
                          <p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                            Reglas configuradas
                          </p>
                          {categoryData && categoryData.linker > 0 && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => bulkToggleRules(card.rulesType, true)}
                                className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa]"
                              >
                                <ToggleLeft className="h-3 w-3" />
                                Desactivar todas LK
                              </button>
                              <button
                                onClick={() => bulkToggleRules(card.rulesType, false)}
                                className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa]"
                              >
                                <ToggleRight className="h-3 w-3" />
                                Activar todas LK
                              </button>
                            </div>
                          )}
                        </div>

                        <RuleViewer
                          category={categoryData}
                          rulesData={categoryData}
                          rulesLoading={isRulesLoading}
                          onToggleRule={toggleRule}
                          togglingRules={togglingRules}
                        />
                      </div>
                    ) : (
                      <div>
                        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                          Detalles
                        </p>
                        <p className="text-sm text-[#475569]">{card.getDetail(health)}</p>
                      </div>
                    )}

                    {/* Relevant logs for this action */}
                    {logs.filter((l) => l.action === card.key).length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                          Historial reciente
                        </p>
                        <div className="space-y-1.5">
                          {logs
                            .filter((l) => l.action === card.key)
                            .slice(0, 5)
                            .map((log) => (
                              <div
                                key={log.id}
                                className="flex items-center gap-2 text-xs text-[#475569]"
                              >
                                {log.status === "success" ? (
                                  <CheckCircle className="h-3 w-3 shrink-0 text-[#16a34a]" />
                                ) : (
                                  <XCircle className="h-3 w-3 shrink-0 text-[#dc2626]" />
                                )}
                                <span className="flex-1 truncate">{log.message}</span>
                                <span className="shrink-0 text-[#94a3b8]">
                                  {timeAgo(log.createdAt)}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Remove rules button (danger) */}
                    {isConfigured && card.key !== "backup" && (
                      <button
                        className="mt-4 flex items-center gap-2 rounded-xl border border-[#dc2626]/20 bg-[#fef2f2] px-4 py-2 text-xs font-medium text-[#dc2626] transition-all hover:bg-[#fee2e2]"
                        onClick={() => {
                          showToast("Funcion de eliminacion de reglas en desarrollo", "error");
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Eliminar reglas Linker
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ─── Activity Log ─── */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#f5f3ff] p-2.5">
              <Clock className="h-5 w-5 text-[#7c4dff]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#0f172a]">Historial de Configuraciones</h2>
              <p className="text-xs text-[#94a3b8]">
                {logsTotal} {logsTotal === 1 ? "registro" : "registros"} en total
              </p>
            </div>
          </div>
          <button
            onClick={fetchLogs}
            disabled={logsLoading}
            className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-medium text-[#475569] transition-all hover:bg-[#f5f7fa] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${logsLoading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>

        <div className="px-6 py-4">
          {logsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center">
              <Clock className="mx-auto h-8 w-8 text-[#e2e8f0]" />
              <p className="mt-3 text-sm text-[#94a3b8]">
                No hay registros de configuraciones aplicadas
              </p>
              <p className="mt-1 text-xs text-[#cbd5e1]">
                Los registros apareceran aqui despues de aplicar configuraciones
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e2e8f0]">
                    <th className="pb-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                      Fecha
                    </th>
                    <th className="pb-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                      Accion
                    </th>
                    <th className="pb-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                      Estado
                    </th>
                    <th className="pb-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                      Detalles
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f5f9]">
                  {logs.map((log) => (
                    <tr key={log.id} className="transition-colors hover:bg-[#f8f9fb]">
                      <td className="py-3 pr-4">
                        <span className="text-xs text-[#475569]">
                          {new Date(log.createdAt).toLocaleDateString("es-MX", {
                            day: "2-digit",
                            month: "short",
                          })}{" "}
                          {new Date(log.createdAt).toLocaleTimeString("es-MX", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-sm font-medium text-[#0f172a]">
                          {actionLabels[log.action] || log.action}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        {log.status === "success" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#16a34a]">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Exitoso
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#dc2626]">
                            <XCircle className="h-3.5 w-3.5" />
                            Error
                          </span>
                        )}
                      </td>
                      <td className="py-3">
                        <span className="text-xs text-[#475569]">{log.message}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Firewall Safe Mode Warning Dialog */}
      {showFirewallWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fffbeb]">
                <AlertCircle className="h-5 w-5 text-[#f59e0b]" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#0f172a]">
                  Reglas existentes detectadas
                </h3>
                <p className="mt-2 text-sm text-[#475569]">
                  Se detectaron {firewallExistingCount} reglas existentes. Las reglas de Linker se agregaran sin eliminar las existentes. Todas las reglas de Linker llevan el prefijo &quot;LK:&quot; para identificarlas.
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleFirewallAddMissing}
                className="flex-1 rounded-xl bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
              >
                Solo agregar faltantes
              </button>
              <button
                onClick={handleFirewallReplaceAll}
                className="rounded-xl border border-[#dc2626]/30 bg-white px-4 py-2.5 text-sm font-medium text-[#dc2626] transition-colors hover:bg-[#fef2f2]"
              >
                Reemplazar todo
              </button>
            </div>
            <button
              onClick={() => setShowFirewallWarning(false)}
              className="mt-3 w-full rounded-xl border border-[#e2e8f0] bg-white px-4 py-2 text-sm text-[#475569] transition-colors hover:bg-[#f5f7fa]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Replace All Confirmation Dialog */}
      {showReplaceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-[#dc2626]/20 bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fef2f2]">
                <AlertTriangle className="h-5 w-5 text-[#dc2626]" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#dc2626]">
                  Confirmar reemplazo completo
                </h3>
                <p className="mt-2 text-sm text-[#475569]">
                  Esto eliminara TODAS las reglas de firewall existentes y las reemplazara con las de Linker. Esta accion no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={confirmReplaceAll}
                className="flex-1 rounded-xl bg-[#dc2626] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#b91c1c]"
              >
                Si, reemplazar todo
              </button>
              <button
                onClick={() => setShowReplaceConfirm(false)}
                className="flex-1 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa]"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewAction && (
        <PreviewModal
          actionKey={previewAction}
          title={cards.find((c) => c.key === previewAction)?.title || ""}
          previewData={previewData}
          previewLoading={previewLoading}
          onConfirm={handlePreviewConfirm}
          onCancel={handlePreviewCancel}
          confirming={applyingActions.has(previewAction)}
        />
      )}

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
