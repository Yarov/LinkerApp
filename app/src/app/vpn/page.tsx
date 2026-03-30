"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Shield,
  Wifi,
  WifiOff,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Save,
  ArrowUpDown,
  Monitor,
  Server,
  Radio,
  Activity,
  ArrowUp,
  ArrowDown,
  Zap,
  Settings,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import Skeleton from "@/components/Skeleton";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface VpnStatus {
  connected: boolean;
  interface: string | null;
  peers: {
    endpoint: string;
    lastHandshake: string;
    transferRx?: number;
    transferTx?: number;
  }[];
  localIp: string | null;
  uptime?: string;
  lastHandshake?: string;
  transferRx?: number;
  transferTx?: number;
}

interface VpnConfig {
  privateKey: string;
  address: string;
  dns: string;
  peerPublicKey: string;
  endpoint: string;
  allowedIPs: string;
  configPath?: string;
}

interface VpnTestResult {
  vps: { reachable: boolean; latency: number | null };
  mikrotik: { reachable: boolean; latency: number | null };
}

type ConnectionState = "connected" | "disconnected" | "connecting" | "disconnecting" | "error";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "---";
  if (ms < 1) return "<1 ms";
  return `${Math.round(ms)} ms`;
}

// ──────────────────────────────────────────────
// Main VPN Page
// ──────────────────────────────────────────────

export default function VPNPage() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [config, setConfig] = useState<VpnConfig | null>(null);
  const [testResult, setTestResult] = useState<VpnTestResult | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [statusLoading, setStatusLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [noConfig, setNoConfig] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Config editing
  const [configExpanded, setConfigExpanded] = useState(false);
  const [editEndpoint, setEditEndpoint] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editAllowedIPs, setEditAllowedIPs] = useState("");
  const [editDns, setEditDns] = useState("");
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  // Clipboard
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // ── Fetchers ──

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/vpn/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setConnectionState(data.connected ? "connected" : "disconnected");
      } else if (res.status === 404) {
        setNoConfig(true);
      }
    } catch {
      setConnectionState("error");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/vpn/config");
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setEditEndpoint(data.endpoint || "");
        setEditAddress(data.address || "");
        setEditAllowedIPs(data.allowedIPs || "");
        setEditDns(data.dns || "");
        setNoConfig(false);
      } else if (res.status === 404) {
        setNoConfig(true);
      }
    } catch {
      // Config may not exist yet
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchConfig();
  }, [fetchStatus, fetchConfig]);

  // Poll status every 10s when connected
  useEffect(() => {
    if (connectionState !== "connected") return;
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [connectionState, fetchStatus]);

  // ── Actions ──

  async function handleConnect() {
    setConnectionState("connecting");
    setErrorMessage("");
    try {
      const res = await fetch("/api/vpn/connect", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage("VPN conectada correctamente");
        setTimeout(() => setSuccessMessage(""), 4000);
        setTimeout(fetchStatus, 1500);
      } else if (data.needsManual) {
        setConnectionState("disconnected");
        setErrorMessage(
          "Se requiere permisos de administrador. Abre la terminal y ejecuta: sudo wg-quick up wg0"
        );
      } else {
        setConnectionState("error");
        setErrorMessage(data.error || "Error al conectar la VPN");
      }
    } catch {
      setConnectionState("error");
      setErrorMessage("Error de red al intentar conectar");
    }
  }

  async function handleDisconnect() {
    setConnectionState("disconnecting");
    setErrorMessage("");
    try {
      const res = await fetch("/api/vpn/disconnect", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setConnectionState("disconnected");
        setStatus((prev) => (prev ? { ...prev, connected: false } : prev));
      } else {
        setConnectionState("connected");
        setErrorMessage(data.error || "Error al desconectar");
      }
    } catch {
      setConnectionState("connected");
      setErrorMessage("Error de red al intentar desconectar");
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/vpn/test");
      if (res.ok) {
        const data = await res.json();
        setTestResult(data);
      }
    } catch {
      // ignore
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveConfig() {
    setConfigSaving(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/vpn/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: editEndpoint,
          address: editAddress,
          allowedIPs: editAllowedIPs,
          dns: editDns,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMessage("Configuracion guardada");
        setTimeout(() => setSuccessMessage(""), 3000);
        fetchConfig();
      } else {
        setErrorMessage(data.error || "Error al guardar configuracion");
      }
    } catch {
      setErrorMessage("Error de red al guardar");
    } finally {
      setConfigSaving(false);
    }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  // ── Derived ──
  const isConnected = connectionState === "connected";
  const isTransitioning = connectionState === "connecting" || connectionState === "disconnecting";

  // If no config exists, redirect to setup
  if (!statusLoading && !configLoading && noConfig) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#eff6ff]">
            <Shield className="h-8 w-8 text-[#006fff]" />
          </div>
          <h2 className="text-xl font-bold text-[#0f172a]">VPN no configurada</h2>
          <p className="mt-2 text-sm text-[#475569]">
            Configura tu conexion VPN WireGuard para conectarte al MikroTik de forma segura.
          </p>
          <Link
            href="/vpn/setup"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#005ce6]"
          >
            <Zap className="h-4 w-4" />
            Configurar VPN
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0f172a]">VPN WireGuard</h1>
          <p className="mt-1 text-sm text-[#475569]">
            Administra tu conexion VPN al servidor y MikroTik
          </p>
        </div>
        <Link
          href="/vpn/setup"
          className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa]"
        >
          <Settings className="h-4 w-4" />
          Asistente de configuracion
        </Link>
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#dc2626]/20 bg-[#fef2f2] px-5 py-4 text-sm text-[#dc2626]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{errorMessage}</p>
            {errorMessage.includes("terminal") && (
              <div className="mt-3 rounded-xl bg-[#1e293b] px-4 py-3 font-mono text-xs text-[#e2e8f0]">
                sudo wg-quick up wg0
              </div>
            )}
          </div>
          <button
            onClick={() => setErrorMessage("")}
            className="ml-auto shrink-0 text-[#dc2626]/60 hover:text-[#dc2626]"
          >
            <span className="sr-only">Cerrar</span>
            &times;
          </button>
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#16a34a]/20 bg-[#f0fdf4] px-5 py-4 text-sm text-[#16a34a]">
          <Check className="h-4 w-4 shrink-0" />
          {successMessage}
        </div>
      )}

      {/* ─── Top: Connection Status Card ─── */}
      <div
        className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all ${
          isConnected
            ? "border-[#16a34a]/30"
            : connectionState === "error"
            ? "border-[#dc2626]/30"
            : "border-[#e2e8f0]"
        }`}
      >
        {/* Gradient accent top */}
        <div
          className={`h-1 ${
            isConnected
              ? "bg-gradient-to-r from-[#16a34a] to-[#22c55e]"
              : connectionState === "error"
              ? "bg-gradient-to-r from-[#dc2626] to-[#f87171]"
              : "bg-gradient-to-r from-[#94a3b8] to-[#cbd5e1]"
          }`}
        />

        {statusLoading ? (
          <div className="px-8 py-10">
            <div className="flex items-center gap-6">
              <Skeleton className="h-20 w-20 !rounded-full" />
              <div className="space-y-3">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </div>
        ) : (
          <div className="px-8 py-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              {/* Left: Status */}
              <div className="flex items-start gap-6">
                {/* Status circle */}
                <div className="relative shrink-0">
                  <div
                    className={`flex h-20 w-20 items-center justify-center rounded-full ${
                      isConnected
                        ? "bg-[#f0fdf4]"
                        : isTransitioning
                        ? "bg-[#eff6ff]"
                        : "bg-[#fef2f2]"
                    }`}
                  >
                    <div
                      className={`h-10 w-10 rounded-full ${
                        isConnected
                          ? "bg-[#16a34a] shadow-lg shadow-[#16a34a]/30"
                          : isTransitioning
                          ? "bg-[#006fff] animate-pulse shadow-lg shadow-[#006fff]/30"
                          : "bg-[#dc2626] shadow-lg shadow-[#dc2626]/20"
                      }`}
                    />
                  </div>
                  {isConnected && (
                    <div className="absolute inset-0 animate-ping rounded-full border-2 border-[#16a34a]/20" />
                  )}
                </div>

                <div>
                  <h2 className="text-xl font-bold text-[#0f172a]">
                    {isConnected
                      ? "VPN Conectada"
                      : connectionState === "connecting"
                      ? "Conectando..."
                      : connectionState === "disconnecting"
                      ? "Desconectando..."
                      : connectionState === "error"
                      ? "Error de conexion"
                      : "VPN Desconectada"}
                  </h2>

                  {isConnected && status && (
                    <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-[#475569]">IP Local:</span>
                        <span className="font-mono font-medium text-[#0f172a]">
                          {status.localIp || "10.10.10.2"}
                        </span>
                      </div>
                      {status.interface && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-[#475569]">Interfaz:</span>
                          <span className="font-mono font-medium text-[#0f172a]">
                            {status.interface}
                          </span>
                        </div>
                      )}
                      {status.lastHandshake && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-[#475569]">Ultimo handshake:</span>
                          <span className="font-medium text-[#0f172a]">
                            {status.lastHandshake}
                          </span>
                        </div>
                      )}
                      {status.uptime && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-[#475569]">Uptime:</span>
                          <span className="font-medium text-[#0f172a]">{status.uptime}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transfer stats */}
                  {isConnected && status && (status.transferRx || status.transferTx) && (
                    <div className="mt-3 flex items-center gap-4">
                      <div className="flex items-center gap-1.5 rounded-lg bg-[#f0fdf4] px-3 py-1.5">
                        <ArrowDown className="h-3.5 w-3.5 text-[#16a34a]" />
                        <span className="font-mono text-xs font-medium text-[#16a34a]">
                          {formatBytes(status.transferRx || 0)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-lg bg-[#eff6ff] px-3 py-1.5">
                        <ArrowUp className="h-3.5 w-3.5 text-[#006fff]" />
                        <span className="font-mono text-xs font-medium text-[#006fff]">
                          {formatBytes(status.transferTx || 0)}
                        </span>
                      </div>
                    </div>
                  )}

                  {!isConnected && !isTransitioning && (
                    <p className="mt-2 text-sm text-[#475569]">
                      La VPN no esta activa. Conecta para acceder al MikroTik de forma segura.
                    </p>
                  )}
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex shrink-0 items-center gap-3">
                {isConnected ? (
                  <>
                    <button
                      onClick={handleTest}
                      disabled={testing}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa] disabled:opacity-50"
                    >
                      <Activity className={`h-4 w-4 ${testing ? "animate-pulse" : ""}`} />
                      {testing ? "Probando..." : "Probar conexion"}
                    </button>
                    <button
                      onClick={handleDisconnect}
                      disabled={isTransitioning}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#dc2626] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#b91c1c] disabled:opacity-50"
                    >
                      <WifiOff className="h-4 w-4" />
                      Desconectar
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleConnect}
                    disabled={isTransitioning}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-8 py-3 text-base font-semibold text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#005ce6] disabled:opacity-50"
                  >
                    {isTransitioning ? (
                      <RefreshCw className="h-5 w-5 animate-spin" />
                    ) : (
                      <Wifi className="h-5 w-5" />
                    )}
                    {connectionState === "connecting" ? "Conectando..." : "Conectar VPN"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Middle: Topology Diagram ─── */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#0f172a]">Topologia de red</h3>
          {!testing && !testResult && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="inline-flex items-center gap-2 text-xs font-medium text-[#006fff] hover:text-[#005ce6]"
            >
              <Activity className="h-3.5 w-3.5" />
              Medir latencia
            </button>
          )}
        </div>

        <div className="flex items-center justify-center gap-0 py-4">
          {/* Node: Esta PC */}
          <div className="flex flex-col items-center">
            <div
              className={`relative rounded-2xl border-2 px-5 py-4 text-center transition-all ${
                isConnected
                  ? "border-[#16a34a]/40 bg-[#f0fdf4]"
                  : "border-[#e2e8f0] bg-[#f5f7fa]"
              }`}
            >
              <Monitor className="mx-auto mb-2 h-6 w-6 text-[#475569]" />
              <div className="text-xs font-semibold text-[#0f172a]">Esta PC</div>
              <div className="mt-1 font-mono text-[11px] text-[#475569]">10.10.10.2</div>
              <div className="mt-1.5 flex items-center justify-center gap-1">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    isConnected ? "bg-[#16a34a] animate-pulse" : "bg-[#94a3b8]"
                  }`}
                />
                <span className="text-[10px] text-[#94a3b8]">local</span>
              </div>
            </div>
          </div>

          {/* Line: PC → VPS */}
          <div className="relative mx-2 flex items-center lg:mx-4">
            <div
              className={`h-0.5 w-12 lg:w-20 ${
                isConnected
                  ? "animate-vpn-dash bg-[length:8px_4px] bg-repeat-x"
                  : "bg-[#e2e8f0]"
              }`}
              style={
                isConnected
                  ? {
                      backgroundImage:
                        "linear-gradient(to right, #16a34a 4px, transparent 4px)",
                      backgroundSize: "8px 2px",
                    }
                  : undefined
              }
            />
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium text-[#94a3b8]">
              WireGuard
            </span>
          </div>

          {/* Node: VPS */}
          <div className="flex flex-col items-center">
            <div
              className={`relative rounded-2xl border-2 px-5 py-4 text-center transition-all ${
                isConnected
                  ? "border-[#006fff]/40 bg-[#eff6ff]"
                  : "border-[#e2e8f0] bg-[#f5f7fa]"
              }`}
            >
              <Server className="mx-auto mb-2 h-6 w-6 text-[#475569]" />
              <div className="text-xs font-semibold text-[#0f172a]">VPS</div>
              <div className="mt-1 font-mono text-[11px] text-[#475569]">10.10.10.1</div>
              <div className="mt-1.5 flex items-center justify-center gap-1">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    testResult?.vps.reachable
                      ? "bg-[#16a34a]"
                      : testResult && !testResult.vps.reachable
                      ? "bg-[#dc2626]"
                      : "bg-[#94a3b8]"
                  }`}
                />
                <span className="font-mono text-[10px] text-[#94a3b8]">
                  {testResult ? formatLatency(testResult.vps.latency) : "---"}
                </span>
              </div>
            </div>
          </div>

          {/* Line: VPS → MikroTik */}
          <div className="relative mx-2 flex items-center lg:mx-4">
            <div
              className={`h-0.5 w-12 lg:w-20 ${
                isConnected
                  ? "animate-vpn-dash bg-[length:8px_4px] bg-repeat-x"
                  : "bg-[#e2e8f0]"
              }`}
              style={
                isConnected
                  ? {
                      backgroundImage:
                        "linear-gradient(to right, #16a34a 4px, transparent 4px)",
                      backgroundSize: "8px 2px",
                    }
                  : undefined
              }
            />
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium text-[#94a3b8]">
              WireGuard
            </span>
          </div>

          {/* Node: MikroTik */}
          <div className="flex flex-col items-center">
            <div
              className={`relative rounded-2xl border-2 px-5 py-4 text-center transition-all ${
                isConnected
                  ? "border-[#16a34a]/40 bg-[#f0fdf4]"
                  : "border-[#e2e8f0] bg-[#f5f7fa]"
              }`}
            >
              <Radio className="mx-auto mb-2 h-6 w-6 text-[#475569]" />
              <div className="text-xs font-semibold text-[#0f172a]">MikroTik</div>
              <div className="mt-1 font-mono text-[11px] text-[#475569]">10.10.10.3</div>
              <div className="mt-1.5 flex items-center justify-center gap-1">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    testResult?.mikrotik.reachable
                      ? "bg-[#16a34a]"
                      : testResult && !testResult.mikrotik.reachable
                      ? "bg-[#dc2626]"
                      : "bg-[#94a3b8]"
                  }`}
                />
                <span className="font-mono text-[10px] text-[#94a3b8]">
                  {testResult ? formatLatency(testResult.mikrotik.latency) : "---"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Test results summary */}
        {testing && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[#475569]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Midiendo latencia...
          </div>
        )}
        {testResult && !testing && (
          <div className="mt-4 flex items-center justify-center gap-6">
            <div
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium ${
                testResult.vps.reachable
                  ? "bg-[#f0fdf4] text-[#16a34a]"
                  : "bg-[#fef2f2] text-[#dc2626]"
              }`}
            >
              <Server className="h-3.5 w-3.5" />
              VPS: {testResult.vps.reachable ? formatLatency(testResult.vps.latency) : "No alcanzable"}
            </div>
            <div
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium ${
                testResult.mikrotik.reachable
                  ? "bg-[#f0fdf4] text-[#16a34a]"
                  : "bg-[#fef2f2] text-[#dc2626]"
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              MikroTik: {testResult.mikrotik.reachable ? formatLatency(testResult.mikrotik.latency) : "No alcanzable"}
            </div>
          </div>
        )}
      </div>

      {/* ─── Bottom: Configuration ─── */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <button
          onClick={() => setConfigExpanded(!configExpanded)}
          className="flex w-full items-center justify-between px-6 py-5 text-left"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#eff6ff] p-2.5">
              <Settings className="h-5 w-5 text-[#006fff]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#0f172a]">Configuracion</h3>
              <p className="text-xs text-[#94a3b8]">Parametros de la conexion WireGuard</p>
            </div>
          </div>
          {configExpanded ? (
            <ChevronUp className="h-5 w-5 text-[#94a3b8]" />
          ) : (
            <ChevronDown className="h-5 w-5 text-[#94a3b8]" />
          )}
        </button>

        {configExpanded && (
          <div className="border-t border-[#e2e8f0] px-6 py-6">
            {configLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-10 flex-1" />
                  </div>
                ))}
              </div>
            ) : config ? (
              <div className="space-y-5">
                {/* Endpoint */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                    Endpoint del VPS
                  </label>
                  <input
                    type="text"
                    value={editEndpoint}
                    onChange={(e) => setEditEndpoint(e.target.value)}
                    className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                  />
                </div>

                {/* Address */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                    Direccion local
                  </label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                  />
                </div>

                {/* Allowed IPs */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                    IPs permitidas
                  </label>
                  <input
                    type="text"
                    value={editAllowedIPs}
                    onChange={(e) => setEditAllowedIPs(e.target.value)}
                    placeholder="10.10.10.0/24, 192.168.88.0/24"
                    className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                  />
                </div>

                {/* DNS */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#475569]">DNS</label>
                  <input
                    type="text"
                    value={editDns}
                    onChange={(e) => setEditDns(e.target.value)}
                    className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                  />
                </div>

                {/* Public Key (read-only, copy) */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                    Llave publica del peer
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 truncate rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#475569]">
                      {config.peerPublicKey || "No configurada"}
                    </div>
                    {config.peerPublicKey && (
                      <button
                        onClick={() => copyToClipboard(config.peerPublicKey, "pubkey")}
                        className="rounded-xl border border-[#e2e8f0] bg-white p-2.5 text-[#94a3b8] transition-colors hover:bg-[#f5f7fa] hover:text-[#475569]"
                      >
                        {copiedField === "pubkey" ? (
                          <Check className="h-4 w-4 text-[#16a34a]" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Private Key (hidden, toggle) */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                    Llave privada
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 truncate rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#475569]">
                      {showPrivateKey
                        ? config.privateKey || "No configurada"
                        : config.privateKey
                        ? "************************************"
                        : "No configurada"}
                    </div>
                    {config.privateKey && (
                      <button
                        onClick={() => setShowPrivateKey(!showPrivateKey)}
                        className="rounded-xl border border-[#e2e8f0] bg-white p-2.5 text-[#94a3b8] transition-colors hover:bg-[#f5f7fa] hover:text-[#475569]"
                      >
                        {showPrivateKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Config file path */}
                {config.configPath && (
                  <div className="flex items-center gap-2 rounded-xl bg-[#f5f7fa] px-4 py-3 text-xs text-[#94a3b8]">
                    <span>Archivo:</span>
                    <span className="font-mono">{config.configPath}</span>
                  </div>
                )}

                {/* Save */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={handleSaveConfig}
                    disabled={configSaving}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#005ce6] disabled:opacity-50"
                  >
                    {configSaving ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Guardar cambios
                  </button>
                  <button
                    onClick={fetchConfig}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa]"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Recargar
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#94a3b8]">No se pudo cargar la configuracion.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
