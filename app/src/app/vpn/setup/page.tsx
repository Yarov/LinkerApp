"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Server,
  Network,
  Key,
  Wifi,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Shield,
  Radio,
  Monitor,
  Info,
} from "lucide-react";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface SetupResult {
  success: boolean;
  error?: string;
  publicKey?: string;
}

interface TestResult {
  vps: { reachable: boolean; latency: number | null };
  mikrotik: { reachable: boolean; latency: number | null };
}

// ──────────────────────────────────────────────
// Step indicator
// ──────────────────────────────────────────────

function StepIndicator({
  steps,
  current,
}: {
  steps: { label: string; icon: React.ElementType }[];
  current: number;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isActive = i === current;
        const isDone = i < current;
        return (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-0.5 w-8 rounded-full transition-colors ${
                  isDone ? "bg-[#006fff]" : "bg-[#e2e8f0]"
                }`}
              />
            )}
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
                isActive
                  ? "bg-[#006fff] text-white shadow-lg shadow-[#006fff]/20"
                  : isDone
                  ? "bg-[#006fff]/10 text-[#006fff]"
                  : "bg-[#f5f7fa] text-[#94a3b8]"
              }`}
            >
              {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </div>
            <span
              className={`hidden text-xs font-medium sm:block ${
                isActive ? "text-[#0f172a]" : isDone ? "text-[#006fff]" : "text-[#94a3b8]"
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────
// Setup Wizard
// ──────────────────────────────────────────────

const STEPS = [
  { label: "Servidor", icon: Server },
  { label: "Direcciones", icon: Network },
  { label: "Llaves", icon: Key },
  { label: "Conectar", icon: Wifi },
];

export default function VPNSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Step 1: Server
  const [vpsIp, setVpsIp] = useState("");
  const [vpsPort, setVpsPort] = useState("13231");
  const [vpsPeerKey, setVpsPeerKey] = useState("");

  // Step 2: Addresses
  const [localAddress, setLocalAddress] = useState("10.10.10.2/24");
  const [mikrotikAddress, setMikrotikAddress] = useState("10.10.10.3");
  const [dns, setDns] = useState("8.8.8.8");

  // Step 3: Keys
  const [generatedPublicKey, setGeneratedPublicKey] = useState("");
  const [generatingKeys, setGeneratingKeys] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);

  // Step 4: Connect
  const [setupState, setSetupState] = useState<
    "idle" | "creating" | "connecting" | "testing" | "success" | "error"
  >("idle");
  const [setupError, setSetupError] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // ── Step navigation ──

  function canProceed(): boolean {
    switch (step) {
      case 0:
        return vpsIp.trim().length > 0 && vpsPeerKey.trim().length > 0;
      case 1:
        return localAddress.trim().length > 0;
      case 2:
        return generatedPublicKey.length > 0;
      case 3:
        return true;
      default:
        return false;
    }
  }

  // ── Actions ──

  async function handleGenerateKeys() {
    setGeneratingKeys(true);
    try {
      // Call setup with generateOnly to get keys
      const res = await fetch("/api/vpn/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generateOnly: true,
          endpoint: `${vpsIp}:${vpsPort}`,
          peerPublicKey: vpsPeerKey,
          address: localAddress,
          dns,
        }),
      });
      const data = await res.json();
      if (data.publicKey) {
        setGeneratedPublicKey(data.publicKey);
      } else {
        setGeneratedPublicKey("");
        setSetupError(data.error || "Error al generar llaves");
      }
    } catch {
      setSetupError("Error de red al generar llaves");
    } finally {
      setGeneratingKeys(false);
    }
  }

  async function handleSetupAndConnect() {
    setSetupState("creating");
    setSetupError("");
    setTestResult(null);
    try {
      // Create config
      const setupRes = await fetch("/api/vpn/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: `${vpsIp}:${vpsPort}`,
          peerPublicKey: vpsPeerKey,
          address: localAddress,
          dns,
          allowedIPs: `10.10.10.0/24, 192.168.88.0/24`,
        }),
      });
      const setupData = await setupRes.json();
      if (!setupData.success) {
        setSetupState("error");
        setSetupError(setupData.error || "Error al crear configuracion");
        return;
      }

      // Connect
      setSetupState("connecting");
      const connRes = await fetch("/api/vpn/connect", { method: "POST" });
      const connData = await connRes.json();
      if (!connData.success) {
        if (connData.needsManual) {
          setSetupState("error");
          setSetupError(
            "Configuracion creada pero se requiere permisos de administrador. Ejecuta en la terminal: sudo wg-quick up wg0"
          );
        } else {
          setSetupState("error");
          setSetupError(connData.error || "Error al conectar");
        }
        return;
      }

      // Test
      setSetupState("testing");
      await new Promise((r) => setTimeout(r, 2000)); // Wait for tunnel to stabilize
      try {
        const testRes = await fetch("/api/vpn/test");
        if (testRes.ok) {
          const testData = await testRes.json();
          setTestResult(testData);
        }
      } catch {
        // Test failure is non-critical
      }

      setSetupState("success");
    } catch {
      setSetupState("error");
      setSetupError("Error de red durante la configuracion");
    }
  }

  function copyText(text: string, field: "key" | "cmd") {
    navigator.clipboard.writeText(text);
    if (field === "key") {
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } else {
      setCmdCopied(true);
      setTimeout(() => setCmdCopied(false), 2000);
    }
  }

  const vpsCommand = `sudo wg set wg0 peer ${generatedPublicKey || "[TU_LLAVE_PUBLICA]"} allowed-ips ${localAddress.split("/")[0]}/32`;

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#eff6ff]">
          <Shield className="h-8 w-8 text-[#006fff]" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0f172a]">
          Configuracion de VPN
        </h1>
        <p className="mt-1 text-sm text-[#475569]">
          Configura tu conexion WireGuard para acceder al MikroTik de forma segura
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator steps={STEPS} current={step} />

      {/* Step content */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 shadow-sm">
        {/* ── Step 0: Server ── */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-[#0f172a]">Configura tu servidor VPN</h2>
              <p className="mt-1 text-sm text-[#475569]">
                Tu VPS es el servidor intermedio que conecta esta computadora con el MikroTik a
                traves de WireGuard.
              </p>
            </div>

            <div className="rounded-xl border border-[#006fff]/10 bg-[#eff6ff] p-4">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#006fff]" />
                <p className="text-xs text-[#006fff]">
                  Un VPS (Virtual Private Server) actua como puente entre tu computadora y el
                  MikroTik. WireGuard crea un tunel encriptado para que puedas administrar la red de
                  forma segura desde cualquier lugar.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                  IP del VPS
                </label>
                <input
                  type="text"
                  value={vpsIp}
                  onChange={(e) => setVpsIp(e.target.value)}
                  placeholder="84.46.246.220"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#475569]">Puerto</label>
                <input
                  type="text"
                  value={vpsPort}
                  onChange={(e) => setVpsPort(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                  Llave publica del VPS
                </label>
                <input
                  type="text"
                  value={vpsPeerKey}
                  onChange={(e) => setVpsPeerKey(e.target.value)}
                  placeholder="aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789+/="
                  className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                />
                <p className="mt-1.5 text-xs text-[#94a3b8]">
                  Ejecuta <code className="rounded bg-[#1e293b] px-1.5 py-0.5 font-mono text-[#e2e8f0]">sudo wg show wg0 public-key</code> en tu VPS para obtenerla
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 1: Addresses ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-[#0f172a]">Direcciones de red</h2>
              <p className="mt-1 text-sm text-[#475569]">
                Configura las direcciones IP de la red VPN. Cada dispositivo tiene una IP unica
                dentro del tunel.
              </p>
            </div>

            {/* Mini topology */}
            <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-4">
              <div className="flex items-center justify-center gap-4 text-center">
                <div>
                  <Monitor className="mx-auto h-5 w-5 text-[#475569]" />
                  <div className="mt-1 text-[10px] font-medium text-[#0f172a]">Tu PC</div>
                  <div className="font-mono text-[10px] text-[#006fff]">
                    {localAddress.split("/")[0]}
                  </div>
                </div>
                <div className="h-0.5 w-6 bg-[#e2e8f0]" />
                <div>
                  <Server className="mx-auto h-5 w-5 text-[#475569]" />
                  <div className="mt-1 text-[10px] font-medium text-[#0f172a]">VPS</div>
                  <div className="font-mono text-[10px] text-[#006fff]">10.10.10.1</div>
                </div>
                <div className="h-0.5 w-6 bg-[#e2e8f0]" />
                <div>
                  <Radio className="mx-auto h-5 w-5 text-[#475569]" />
                  <div className="mt-1 text-[10px] font-medium text-[#0f172a]">MikroTik</div>
                  <div className="font-mono text-[10px] text-[#006fff]">{mikrotikAddress}</div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                  Tu direccion local (esta PC)
                </label>
                <input
                  type="text"
                  value={localAddress}
                  onChange={(e) => setLocalAddress(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                />
                <p className="mt-1.5 text-xs text-[#94a3b8]">
                  Direccion IP asignada a esta computadora dentro de la VPN
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                  Direccion del MikroTik
                </label>
                <input
                  type="text"
                  value={mikrotikAddress}
                  onChange={(e) => setMikrotikAddress(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#475569]">DNS</label>
                <input
                  type="text"
                  value={dns}
                  onChange={(e) => setDns(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
            </div>

            <div className="rounded-xl border border-[#006fff]/10 bg-[#eff6ff] p-4">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#006fff]" />
                <div className="text-xs text-[#006fff]">
                  <p>La red 10.10.10.0/24 es la subred de WireGuard:</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    <li>10.10.10.1 - VPS (servidor)</li>
                    <li>10.10.10.2 - Tu PC (este dispositivo)</li>
                    <li>10.10.10.3 - MikroTik (router)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Keys ── */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-[#0f172a]">Generar llaves</h2>
              <p className="mt-1 text-sm text-[#475569]">
                WireGuard usa un par de llaves (publica/privada) para la autenticacion. Genera las
                llaves y registra la llave publica en tu VPS.
              </p>
            </div>

            {!generatedPublicKey ? (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#eff6ff]">
                  <Key className="h-10 w-10 text-[#006fff]" />
                </div>
                <button
                  onClick={handleGenerateKeys}
                  disabled={generatingKeys}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#005ce6] disabled:opacity-50"
                >
                  {generatingKeys ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Key className="h-4 w-4" />
                  )}
                  {generatingKeys ? "Generando..." : "Generar par de llaves"}
                </button>
                {setupError && (
                  <p className="text-sm text-[#dc2626]">{setupError}</p>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-xl border border-[#16a34a]/20 bg-[#f0fdf4] p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-[#16a34a]" />
                    <span className="text-sm font-medium text-[#16a34a]">
                      Llaves generadas correctamente
                    </span>
                  </div>
                </div>

                {/* Public key */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#475569]">
                    Tu llave publica
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 truncate rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4 py-2.5 font-mono text-sm text-[#0f172a]">
                      {generatedPublicKey}
                    </div>
                    <button
                      onClick={() => copyText(generatedPublicKey, "key")}
                      className="rounded-xl border border-[#e2e8f0] bg-white p-2.5 text-[#94a3b8] transition-colors hover:bg-[#f5f7fa] hover:text-[#475569]"
                    >
                      {keyCopied ? (
                        <Check className="h-4 w-4 text-[#16a34a]" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Instruction */}
                <div className="rounded-xl border border-[#006fff]/10 bg-[#eff6ff] p-4">
                  <div className="flex items-start gap-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#006fff]" />
                    <p className="text-xs text-[#006fff]">
                      Agrega esta llave publica como peer en tu VPS. Ejecuta el siguiente comando en
                      la terminal del VPS:
                    </p>
                  </div>
                </div>

                {/* Command block */}
                <div className="relative">
                  <div className="overflow-x-auto rounded-xl bg-[#1e293b] px-5 py-4 font-mono text-xs leading-relaxed text-[#e2e8f0]">
                    {vpsCommand}
                  </div>
                  <button
                    onClick={() => copyText(vpsCommand, "cmd")}
                    className="absolute right-3 top-3 rounded-lg bg-[#334155] p-1.5 text-[#94a3b8] transition-colors hover:text-white"
                  >
                    {cmdCopied ? (
                      <Check className="h-3.5 w-3.5 text-[#16a34a]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Connect ── */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-[#0f172a]">Crear configuracion y conectar</h2>
              <p className="mt-1 text-sm text-[#475569]">
                Se creara el archivo de configuracion de WireGuard y se intentara conectar
                automaticamente.
              </p>
            </div>

            {/* Summary */}
            <div className="divide-y divide-[#e2e8f0] rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-4">
              <div className="flex items-center justify-between py-3">
                <span className="text-sm text-[#475569]">Servidor</span>
                <span className="font-mono text-sm font-medium text-[#0f172a]">
                  {vpsIp}:{vpsPort}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-sm text-[#475569]">IP local</span>
                <span className="font-mono text-sm font-medium text-[#0f172a]">{localAddress}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-sm text-[#475569]">DNS</span>
                <span className="font-mono text-sm font-medium text-[#0f172a]">{dns}</span>
              </div>
            </div>

            {setupState === "idle" && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleSetupAndConnect}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-8 py-3 text-base font-semibold text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#005ce6]"
                >
                  <Wifi className="h-5 w-5" />
                  Crear configuracion y conectar
                </button>
              </div>
            )}

            {/* Progress */}
            {(setupState === "creating" ||
              setupState === "connecting" ||
              setupState === "testing") && (
              <div className="space-y-3 py-4">
                <ProgressStep
                  label="Creando configuracion..."
                  state={
                    setupState === "creating"
                      ? "active"
                      : "done"
                  }
                />
                <ProgressStep
                  label="Conectando VPN..."
                  state={
                    setupState === "connecting"
                      ? "active"
                      : setupState === "creating"
                      ? "pending"
                      : "done"
                  }
                />
                <ProgressStep
                  label="Probando conexion..."
                  state={
                    setupState === "testing"
                      ? "active"
                      : "pending"
                  }
                />
              </div>
            )}

            {/* Success */}
            {setupState === "success" && (
              <div className="space-y-4 py-4">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f0fdf4]">
                    <CheckCircle className="h-8 w-8 text-[#16a34a]" />
                  </div>
                  <h3 className="text-lg font-semibold text-[#16a34a]">VPN configurada y conectada</h3>
                </div>
                {testResult && (
                  <div className="flex items-center justify-center gap-6">
                    <div
                      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium ${
                        testResult.vps.reachable
                          ? "bg-[#f0fdf4] text-[#16a34a]"
                          : "bg-[#fef2f2] text-[#dc2626]"
                      }`}
                    >
                      <Server className="h-3.5 w-3.5" />
                      VPS:{" "}
                      {testResult.vps.reachable
                        ? `${Math.round(testResult.vps.latency || 0)} ms`
                        : "No alcanzable"}
                    </div>
                    <div
                      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium ${
                        testResult.mikrotik.reachable
                          ? "bg-[#f0fdf4] text-[#16a34a]"
                          : "bg-[#fef2f2] text-[#dc2626]"
                      }`}
                    >
                      <Radio className="h-3.5 w-3.5" />
                      MikroTik:{" "}
                      {testResult.mikrotik.reachable
                        ? `${Math.round(testResult.mikrotik.latency || 0)} ms`
                        : "No alcanzable"}
                    </div>
                  </div>
                )}
                <div className="flex justify-center pt-2">
                  <button
                    onClick={() => router.push("/vpn")}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#005ce6]"
                  >
                    Ir a administrar VPN
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {setupState === "error" && (
              <div className="space-y-4 py-4">
                <div className="flex items-start gap-3 rounded-2xl border border-[#dc2626]/20 bg-[#fef2f2] px-5 py-4 text-sm text-[#dc2626]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Error durante la configuracion</p>
                    <p className="mt-1">{setupError}</p>
                    {setupError.includes("terminal") && (
                      <div className="mt-3 rounded-xl bg-[#1e293b] px-4 py-3 font-mono text-xs text-[#e2e8f0]">
                        sudo wg-quick up wg0
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => {
                      setSetupState("idle");
                      setSetupError("");
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa]"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Reintentar
                  </button>
                  <button
                    onClick={() => router.push("/vpn")}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa]"
                  >
                    Ir a VPN
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                {/* Troubleshooting */}
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-4">
                  <p className="mb-2 text-xs font-medium text-[#475569]">Posibles soluciones:</p>
                  <ul className="space-y-1 text-xs text-[#94a3b8]">
                    <li>- Verifica que la IP del VPS sea correcta y accesible</li>
                    <li>- Confirma que WireGuard esta instalado en el VPS</li>
                    <li>- Asegurate de que el puerto {vpsPort} esta abierto en el firewall del VPS</li>
                    <li>- Verifica que la llave publica del VPS sea correcta</li>
                    <li>- Revisa que tu llave publica este agregada como peer en el VPS</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Navigation buttons */}
        <div className="mt-8 flex items-center justify-between border-t border-[#e2e8f0] pt-6">
          <button
            onClick={() => step > 0 && setStep(step - 1)}
            disabled={step === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f5f7fa] disabled:invisible"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => canProceed() && setStep(step + 1)}
              disabled={!canProceed()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#005ce6] disabled:opacity-40"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            setupState === "success" && (
              <button
                onClick={() => router.push("/vpn")}
                className="inline-flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#005ce6]"
              >
                Finalizar
                <ChevronRight className="h-4 w-4" />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Progress step component
// ──────────────────────────────────────────────

function ProgressStep({
  label,
  state,
}: {
  label: string;
  state: "pending" | "active" | "done";
}) {
  return (
    <div className="flex items-center gap-3">
      {state === "done" ? (
        <CheckCircle className="h-5 w-5 text-[#16a34a]" />
      ) : state === "active" ? (
        <RefreshCw className="h-5 w-5 animate-spin text-[#006fff]" />
      ) : (
        <div className="h-5 w-5 rounded-full border-2 border-[#e2e8f0]" />
      )}
      <span
        className={`text-sm ${
          state === "done"
            ? "text-[#16a34a]"
            : state === "active"
            ? "font-medium text-[#006fff]"
            : "text-[#94a3b8]"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
