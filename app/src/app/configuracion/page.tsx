"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Server,
  Shield,
  Key,
  Info,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Database,
  Users,
  Radio,
  AlertTriangle,
  Copy,
  Check,
  Network,
  Download,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import Skeleton from "@/components/Skeleton";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface MikroTikStatus {
  resource?: {
    uptime: string;
    cpuLoad: string;
    freeMemory: string;
    totalMemory: string;
    architecture: string;
    board: string;
    version: string;
  };
  error?: string;
}

interface VpnStatus {
  connected: boolean;
  interface: string | null;
  peers: { endpoint: string; lastHandshake: string }[];
  error?: string;
}

interface SystemInfo {
  version: string;
  database: { type: string; sizeBytes: number; sizeMB: string };
  counts: { nodes: number; clients: number; plans: number; alerts: number };
  lastMonitoring: string | null;
}

// ──────────────────────────────────────────────
// Section Card wrapper
// ──────────────────────────────────────────────

function SectionCard({
  title,
  icon: Icon,
  children,
  accent = "blue",
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  accent?: "blue" | "green" | "purple" | "red";
}) {
  const accentColors = {
    blue: "from-[#006fff]",
    green: "from-[#16a34a]",
    purple: "from-[#7c4dff]",
    red: "from-[#dc2626]",
  };
  const iconColors = {
    blue: "bg-[#eff6ff] text-[#006fff]",
    green: "bg-[#f0fdf4] text-[#16a34a]",
    purple: "bg-[#f5f3ff] text-[#7c4dff]",
    red: "bg-[#fef2f2] text-[#dc2626]",
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
      <div
        className={`absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b ${accentColors[accent]} to-transparent`}
      />
      <div className="flex items-center gap-3 border-b border-[#e2e8f0] px-6 py-4">
        <div className={`rounded-xl p-2.5 ${iconColors[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold text-[#0f172a]">{title}</h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Info row
// ──────────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-[#475569]">{label}</span>
      <span className={`text-sm font-medium text-[#0f172a] ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────
// Status badge inline
// ──────────────────────────────────────────────

function StatusPill({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        connected
          ? "border border-[#16a34a]/20 bg-[#f0fdf4] text-[#16a34a]"
          : "border border-[#dc2626]/20 bg-[#fef2f2] text-[#dc2626]"
      }`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          connected ? "bg-[#16a34a] animate-pulse" : "bg-[#dc2626]"
        }`}
      />
      {label ?? (connected ? "Conectado" : "Desconectado")}
    </span>
  );
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────

export default function ConfiguracionPage() {
  // MikroTik
  const [mikrotik, setMikrotik] = useState<MikroTikStatus | null>(null);
  const [mikrotikLoading, setMikrotikLoading] = useState(true);
  const [mikrotikTesting, setMikrotikTesting] = useState(false);

  // VPN
  const [vpn, setVpn] = useState<VpnStatus | null>(null);
  const [vpnLoading, setVpnLoading] = useState(true);
  const [vpnToggling, setVpnToggling] = useState(false);
  const [vpnMessage, setVpnMessage] = useState("");

  // System
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [systemLoading, setSystemLoading] = useState(true);

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  // Clipboard feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Credentials collapsible
  const [showCredentials, setShowCredentials] = useState(false);

  // DB reset
  const [resetStep, setResetStep] = useState(0); // 0=idle, 1=first confirm, 2=second confirm
  const [resetting, setResetting] = useState(false);

  // ── Fetchers ──

  const fetchMikrotik = useCallback(async () => {
    setMikrotikLoading(true);
    try {
      const res = await fetch("/api/mikrotik/status");
      if (res.ok) {
        const data = await res.json();
        setMikrotik(data);
      } else {
        setMikrotik({ error: "Sin conexion" });
      }
    } catch {
      setMikrotik({ error: "Sin conexion" });
    } finally {
      setMikrotikLoading(false);
    }
  }, []);

  const fetchVpn = useCallback(async () => {
    setVpnLoading(true);
    try {
      const res = await fetch("/api/config/vpn");
      const data = await res.json();
      setVpn(data);
    } catch {
      setVpn({ connected: false, interface: null, peers: [] });
    } finally {
      setVpnLoading(false);
    }
  }, []);

  const fetchSystem = useCallback(async () => {
    setSystemLoading(true);
    try {
      const res = await fetch("/api/config/system");
      if (res.ok) {
        const data = await res.json();
        setSystem(data);
      }
    } catch {
      // ignore
    } finally {
      setSystemLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMikrotik();
    fetchVpn();
    fetchSystem();
  }, [fetchMikrotik, fetchVpn, fetchSystem]);

  // ── Handlers ──

  async function handleTestMikrotik() {
    setMikrotikTesting(true);
    await fetchMikrotik();
    setMikrotikTesting(false);
  }

  async function handleVpnToggle(action: "up" | "down") {
    setVpnToggling(true);
    setVpnMessage("");
    try {
      const res = await fetch("/api/config/vpn/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        setVpnMessage(action === "up" ? "VPN conectada" : "VPN desconectada");
        setTimeout(() => fetchVpn(), 2000);
      } else {
        setVpnMessage(data.error || "Error al cambiar VPN");
      }
    } catch {
      setVpnMessage("Error de red al cambiar VPN");
    } finally {
      setVpnToggling(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMessage(null);

    if (newPassword !== confirmPassword) {
      setPwMessage({ type: "error", text: "Las contrasenas no coinciden" });
      return;
    }
    if (newPassword.length < 6) {
      setPwMessage({ type: "error", text: "La contrasena debe tener al menos 6 caracteres" });
      return;
    }

    setPwLoading(true);
    try {
      const res = await fetch("/api/config/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPwMessage({ type: "success", text: data.message || "Contrasena actualizada" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPwMessage({ type: "error", text: data.error || "Error al cambiar contrasena" });
      }
    } catch {
      setPwMessage({ type: "error", text: "Error de red" });
    } finally {
      setPwLoading(false);
    }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  async function handleExportDb() {
    try {
      const res = await fetch("/api/config/export-db");
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `linker-backup-${new Date().toISOString().split("T")[0]}.db`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // ignore
    }
  }

  // ── Derived ──

  const mikrotikConnected = !!(mikrotik?.resource && !mikrotik.error);

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0f172a]">Configuracion</h1>
        <p className="mt-1 text-sm text-[#475569]">
          Gestiona la conexion, credenciales y base de datos del sistema
        </p>
      </div>

      {/* ─── Section 1: Conexion ─── */}
      <div>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-[#94a3b8]">
          Conexion
        </h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* MikroTik Card */}
          <SectionCard title="Conexion MikroTik" icon={Server} accent="blue">
            {mikrotikLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[#0f172a]">Estado</span>
                  <StatusPill connected={mikrotikConnected} />
                </div>
                <div className="divide-y divide-[#e2e8f0] rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4">
                  <InfoRow label="Host" value={process.env.NEXT_PUBLIC_MIKROTIK_HOST || "10.10.10.3"} mono />
                  <InfoRow label="Puerto" value="8728" mono />
                  <InfoRow label="Usuario" value="admin" />
                  {mikrotik?.resource && (
                    <>
                      <InfoRow label="RouterOS" value={mikrotik.resource.version || "N/A"} />
                      <InfoRow label="Board" value={mikrotik.resource.board || "N/A"} />
                      <InfoRow label="Uptime" value={mikrotik.resource.uptime || "N/A"} />
                      <InfoRow label="CPU" value={`${mikrotik.resource.cpuLoad || 0}%`} />
                      <InfoRow label="Arquitectura" value={mikrotik.resource.architecture || "N/A"} />
                    </>
                  )}
                  {mikrotik?.error && (
                    <div className="flex items-center gap-2 py-3 text-sm text-[#dc2626]">
                      <XCircle className="h-4 w-4" />
                      <span>{mikrotik.error}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleTestMikrotik}
                  disabled={mikrotikTesting}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#005ce6] disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${mikrotikTesting ? "animate-spin" : ""}`} />
                  Probar Conexion
                </button>
              </div>
            )}
          </SectionCard>

          {/* VPN Card */}
          <SectionCard title="VPN WireGuard" icon={Shield} accent="green">
            {vpnLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[#0f172a]">Estado</span>
                  <StatusPill connected={vpn?.connected ?? false} />
                </div>

                {/* Mini topology */}
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-4">
                  <div className="flex items-center justify-center gap-0">
                    <div className="flex flex-col items-center">
                      <div className={`rounded-xl border-2 px-3 py-2 text-center ${vpn?.connected ? "border-[#16a34a] bg-[#f0fdf4]" : "border-[#e2e8f0] bg-white"}`}>
                        <div className="text-[10px] font-medium text-[#475569]">Mac</div>
                        <div className="font-mono text-[10px] font-semibold text-[#0f172a]">10.10.10.2</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-center px-1.5">
                      <div className={`h-0.5 w-8 ${vpn?.connected ? "bg-[#16a34a]" : "bg-[#e2e8f0]"}`} />
                    </div>
                    <div className="flex flex-col items-center">
                      <div className={`rounded-xl border-2 px-3 py-2 text-center ${vpn?.connected ? "border-[#006fff] bg-[#eff6ff]" : "border-[#e2e8f0] bg-white"}`}>
                        <div className="text-[10px] font-medium text-[#475569]">VPS</div>
                        <div className="font-mono text-[10px] font-semibold text-[#0f172a]">10.10.10.1</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-center px-1.5">
                      <div className={`h-0.5 w-8 ${vpn?.connected ? "bg-[#16a34a]" : "bg-[#e2e8f0]"}`} />
                    </div>
                    <div className="flex flex-col items-center">
                      <div className={`rounded-xl border-2 px-3 py-2 text-center ${vpn?.connected ? "border-[#16a34a] bg-[#f0fdf4]" : "border-[#e2e8f0] bg-white"}`}>
                        <div className="text-[10px] font-medium text-[#475569]">MikroTik</div>
                        <div className="font-mono text-[10px] font-semibold text-[#0f172a]">10.10.10.3</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Link to VPN page */}
                <a
                  href="/vpn"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#005ce6]"
                >
                  <Shield className="h-4 w-4" />
                  Administrar VPN
                </a>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* ─── Section 2: Cuenta ─── */}
      <div>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-[#94a3b8]">
          Cuenta
        </h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Change password */}
          <SectionCard title="Cambiar Contrasena" icon={Key} accent="purple">
            <form onSubmit={handleChangePassword} className="space-y-3">
              {/* Current password */}
              <div>
                <label className="mb-1 block text-sm text-[#475569]">Contrasena actual</label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 pr-10 text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#475569]"
                  >
                    {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div>
                <label className="mb-1 block text-sm text-[#475569]">Nueva contrasena</label>
                <div className="relative">
                  <input
                    type={showNewPw ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 pr-10 text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(!showNewPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#475569]"
                  >
                    {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label className="mb-1 block text-sm text-[#475569]">Confirmar contrasena</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                  required
                  minLength={6}
                />
              </div>

              {pwMessage && (
                <div
                  className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
                    pwMessage.type === "success"
                      ? "border border-[#16a34a]/20 bg-[#f0fdf4] text-[#16a34a]"
                      : "border border-[#dc2626]/20 bg-[#fef2f2] text-[#dc2626]"
                  }`}
                >
                  {pwMessage.type === "success" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0" />
                  )}
                  {pwMessage.text}
                </div>
              )}

              <button
                type="submit"
                disabled={pwLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#005ce6] disabled:opacity-50"
              >
                {pwLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
                Cambiar contrasena
              </button>
            </form>
          </SectionCard>

          {/* App Info & Credentials */}
          <SectionCard title="Informacion de la App" icon={Info} accent="blue">
            <div className="space-y-5">
              {systemLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  ))}
                </div>
              ) : system ? (
                <div className="divide-y divide-[#e2e8f0] rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4">
                  <InfoRow label="Version" value={`v${system.version}`} />
                  <InfoRow
                    label="Ultimo monitoreo"
                    value={
                      system.lastMonitoring
                        ? new Date(system.lastMonitoring).toLocaleString("es-MX", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "Sin datos"
                    }
                  />
                </div>
              ) : (
                <p className="text-sm text-[#dc2626]">Error al cargar informacion</p>
              )}

              {/* Collapsible credentials */}
              <div className="rounded-xl border border-[#e2e8f0]">
                <button
                  onClick={() => setShowCredentials(!showCredentials)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[#475569] transition-colors hover:bg-[#f5f7fa]"
                >
                  <span className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-[#94a3b8]" />
                    Credenciales
                  </span>
                  {showCredentials ? (
                    <ChevronUp className="h-4 w-4 text-[#94a3b8]" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-[#94a3b8]" />
                  )}
                </button>
                {showCredentials && (
                  <div className="border-t border-[#e2e8f0] px-4 py-3 space-y-4">
                    {/* MikroTik */}
                    <div>
                      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                        MikroTik
                      </p>
                      <div className="divide-y divide-[#e2e8f0] rounded-lg border border-[#e2e8f0] bg-[#f5f7fa] px-3">
                        <div className="flex items-center justify-between py-2">
                          <span className="text-xs text-[#475569]">Host</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-medium text-[#0f172a]">10.10.10.3</span>
                            <button
                              onClick={() => copyToClipboard("10.10.10.3", "mk-host")}
                              className="text-[#94a3b8] hover:text-[#475569]"
                            >
                              {copiedField === "mk-host" ? <Check className="h-3 w-3 text-[#16a34a]" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-xs text-[#475569]">Puerto</span>
                          <span className="font-mono text-xs font-medium text-[#0f172a]">8728</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-xs text-[#475569]">Usuario</span>
                          <span className="text-xs font-medium text-[#0f172a]">admin</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-xs text-[#475569]">Contrasena</span>
                          <span className="text-xs text-[#94a3b8]">(en .env)</span>
                        </div>
                      </div>
                    </div>
                    {/* Antenas */}
                    <div>
                      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-[#94a3b8]">
                        Antenas
                      </p>
                      <div className="divide-y divide-[#e2e8f0] rounded-lg border border-[#e2e8f0] bg-[#f5f7fa] px-3">
                        <div className="flex items-center justify-between py-2">
                          <span className="text-xs text-[#475569]">Usuario</span>
                          <span className="text-xs font-medium text-[#0f172a]">ubnt</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-xs text-[#475569]">Contrasena</span>
                          <span className="text-xs text-[#94a3b8]">(en .env)</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#94a3b8]">
                      Las credenciales solo se modifican desde el archivo .env
                    </p>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ─── Section 3: Base de Datos ─── */}
      <div>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-[#94a3b8]">
          Base de Datos
        </h2>
        <SectionCard title="Base de Datos" icon={Database} accent="blue">
          {systemLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : system ? (
            <div className="space-y-5">
              <div className="divide-y divide-[#e2e8f0] rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4">
                <InfoRow label="Motor" value={system.database.type} />
                <InfoRow label="Tamano" value={`${system.database.sizeMB} MB`} />
              </div>

              {/* Entity counts */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-3.5 text-center">
                  <Radio className="mx-auto h-4 w-4 text-[#006fff]" />
                  <p className="mt-1.5 text-xl font-bold text-[#0f172a]">{system.counts.nodes}</p>
                  <p className="text-[10px] text-[#94a3b8]">Nodos</p>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-3.5 text-center">
                  <Users className="mx-auto h-4 w-4 text-[#16a34a]" />
                  <p className="mt-1.5 text-xl font-bold text-[#0f172a]">{system.counts.clients}</p>
                  <p className="text-[10px] text-[#94a3b8]">Clientes</p>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-3.5 text-center">
                  <Network className="mx-auto h-4 w-4 text-[#7c4dff]" />
                  <p className="mt-1.5 text-xl font-bold text-[#0f172a]">{system.counts.plans}</p>
                  <p className="text-[10px] text-[#94a3b8]">Planes</p>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-3.5 text-center">
                  <Database className="mx-auto h-4 w-4 text-[#00bcd4]" />
                  <p className="mt-1.5 text-xl font-bold text-[#0f172a]">{system.counts.alerts}</p>
                  <p className="text-[10px] text-[#94a3b8]">Alertas</p>
                </div>
              </div>

              {/* DB actions */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleExportDb}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa] hover:text-[#0f172a]"
                >
                  <Download className="h-4 w-4" />
                  Exportar base de datos
                </button>
                <button
                  onClick={fetchSystem}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa]"
                >
                  <RefreshCw className="h-4 w-4" />
                  Actualizar info
                </button>
              </div>

              {/* Danger zone */}
              <div className="rounded-xl border border-[#dc2626]/20 bg-[#fef2f2]/50 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#dc2626]">
                  Zona peligrosa
                </p>
                {resetStep === 0 && (
                  <button
                    onClick={() => setResetStep(1)}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#dc2626]/30 bg-white px-4 py-2.5 text-sm font-medium text-[#dc2626] transition-all hover:bg-[#fef2f2]"
                  >
                    <Trash2 className="h-4 w-4" />
                    Reiniciar base de datos
                  </button>
                )}
                {resetStep === 1 && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-xl border border-[#dc2626]/20 bg-white px-4 py-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#dc2626]" />
                      <div>
                        <p className="text-sm font-medium text-[#dc2626]">
                          Esto eliminara TODOS los datos
                        </p>
                        <p className="mt-1 text-xs text-[#475569]">
                          Nodos, clientes, pagos, planes y alertas seran eliminados permanentemente.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setResetStep(2)}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#dc2626] px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#b91c1c]"
                      >
                        Si, continuar
                      </button>
                      <button
                        onClick={() => setResetStep(0)}
                        className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {resetStep === 2 && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-xl border-2 border-[#dc2626] bg-white px-4 py-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#dc2626]" />
                      <div>
                        <p className="text-sm font-bold text-[#dc2626]">
                          Ultima confirmacion
                        </p>
                        <p className="mt-1 text-xs text-[#475569]">
                          Esta accion es IRREVERSIBLE. Se recomienda exportar la base de datos antes de continuar.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          setResetting(true);
                          try {
                            const res = await fetch("/api/config/reset-db", { method: "POST" });
                            if (res.ok) {
                              setResetStep(0);
                              fetchSystem();
                            }
                          } catch {
                            // ignore
                          } finally {
                            setResetting(false);
                          }
                        }}
                        disabled={resetting}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#dc2626] px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#991b1b] disabled:opacity-50"
                      >
                        {resetting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        Eliminar todos los datos
                      </button>
                      <button
                        onClick={() => setResetStep(0)}
                        className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#dc2626]">Error al cargar informacion del sistema</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
