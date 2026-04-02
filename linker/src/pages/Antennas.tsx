import { useState, useEffect, useCallback, useRef } from "react";
import {
  Radio, Cable, Network, Search, Wifi, ArrowLeftRight, Loader2,
  CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp,
  ArrowLeft, ArrowRight, Plus, Settings2, Signal, Trash2,
  RefreshCw, Eye, EyeOff, Zap, Monitor, Save,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
type ConnectionMethod = "direct" | "network" | "scan";
type AntennaRole = "station" | "ap" | "ptp";
type PushMethod = "http" | "ssh";

interface ScannedDevice {
  model: string;
  mac: string;
  ip: string;
  firmware?: string;
}

interface DeviceInfo {
  model: string;
  firmware: string;
  mac: string;
  ip: string;
  is_factory: boolean;
  ssid?: string;
  wireless_mode?: string;
  firmware_latest?: boolean;
}

interface SavedAP {
  id: string;
  name: string;
  ssid: string;
  frequency: number;
  channel_width: number;
  wpa_key: string;
  ip: string;
}

interface SavedAntenna {
  id: string;
  name: string;
  model: string;
  role: AntennaRole;
  ip: string;
  mac: string;
  ssid: string;
  created_at: string;
  signal_dbm?: number;
}

interface PushStep {
  label: string;
  status: "pending" | "running" | "success" | "error";
  error?: string;
}

interface VerificationResult {
  ping_ok: boolean;
  signal_dbm?: number;
  ccq?: number;
  tx_rate?: number;
  rx_rate?: number;
}

// ---------------------------------------------------------------------------
// Reusable sub-components
// ---------------------------------------------------------------------------
function StepIndicator({ current, total = 6 }: { current: WizardStep; total?: number }) {
  return (
    <div className="flex items-center justify-center gap-1">
      {Array.from({ length: total }, (_, i) => {
        const step = (i + 1) as WizardStep;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} className="flex items-center gap-1">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                active
                  ? "bg-[#006fff] text-white shadow-md shadow-[#006fff]/25"
                  : done
                    ? "bg-[#16a34a] text-white"
                    : "bg-[#f1f5f9] text-[#94a3b8]"
              }`}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : step}
            </div>
            {step < total && (
              <div
                className={`h-0.5 w-6 rounded-full ${
                  done ? "bg-[#16a34a]" : "bg-[#e2e8f0]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SelectableCard({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: typeof Cable;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border-2 p-5 text-center transition-all ${
        selected
          ? "border-[#006fff] bg-[#eff6ff] shadow-md shadow-[#006fff]/10"
          : "border-[#e2e8f0] bg-white hover:border-[#cbd5e1] hover:shadow-sm"
      }`}
    >
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${
          selected ? "bg-[#006fff] text-white" : "bg-[#f1f5f9] text-[#64748b]"
        }`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className={`text-sm font-semibold ${selected ? "text-[#006fff]" : "text-[#0f172a]"}`}>
          {title}
        </p>
        <p className="mt-0.5 text-xs text-[#94a3b8]">{description}</p>
      </div>
    </button>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-[#94a3b8]">{label}</p>
      <p className="text-sm font-medium text-[#0f172a]">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function Antennas() {
  // --- Page state ---
  const [showWizard, setShowWizard] = useState(false);
  const [savedAntennas, setSavedAntennas] = useState<SavedAntenna[]>([]);
  const [loadingAntennas, setLoadingAntennas] = useState(true);

  // --- Wizard state ---
  const [step, setStep] = useState<WizardStep>(1);
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>("direct");
  const [ip, setIp] = useState("192.168.1.20");
  const [username, setUsername] = useState("ubnt");
  const [password, setPassword] = useState("ubnt");
  const [showPassword, setShowPassword] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  // Scan
  const [scanning, setScanning] = useState(false);
  const [scannedDevices, setScannedDevices] = useState<ScannedDevice[]>([]);
  const [selectedScan, setSelectedScan] = useState<ScannedDevice | null>(null);

  // Step 2
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

  // Step 3
  const [role, setRole] = useState<AntennaRole>("station");

  // Step 4 — Station
  const [savedAPs, setSavedAPs] = useState<SavedAP[]>([]);
  const [loadingAPs, setLoadingAPs] = useState(false);
  const [selectedAP, setSelectedAP] = useState<SavedAP | null>(null);
  const [stationSSID, setStationSSID] = useState("");
  const [stationWPA, setStationWPA] = useState("");
  const [stationFreq, setStationFreq] = useState("");
  const [stationChWidth, setStationChWidth] = useState("20");
  const [stationMgmtIP, setStationMgmtIP] = useState("");
  const [stationName, setStationName] = useState("");
  const [stationTxPower, setStationTxPower] = useState(20);
  const [stationNetMode, setStationNetMode] = useState<"bridge" | "router">("bridge");

  // Step 4 — AP
  const [apSSID, setApSSID] = useState("");
  const [apWPA, setApWPA] = useState("");
  const [apFreq, setApFreq] = useState("5180");
  const [apChWidth, setApChWidth] = useState("40");
  const [apAirmax, setApAirmax] = useState(true);
  const [apMgmtIP, setApMgmtIP] = useState("");
  const [apName, setApName] = useState("");

  // Step 5
  const [pushMethod, setPushMethod] = useState<PushMethod>("http");
  const [pushSteps, setPushSteps] = useState<PushStep[]>([]);
  const [pushing, setPushing] = useState(false);
  const [pushDone, setPushDone] = useState(false);
  const [pushError, setPushError] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [pushLog, setPushLog] = useState<string[]>([]);

  // Step 6
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Load saved antennas ---
  const loadAntennas = useCallback(async () => {
    setLoadingAntennas(true);
    try {
      const result = await invoke<{ aps: any[] }>("get_saved_aps").then(r => (r?.aps ?? []).map((a: any) => ({ id: a.id, name: a.name, model: a.type || "", role: (a.type === "AP" ? "ap" : "station") as AntennaRole, ip: a.ip || "", mac: a.mac || "", ssid: "", created_at: "" })));
      setSavedAntennas(result);
    } catch {
      setSavedAntennas([]);
    } finally {
      setLoadingAntennas(false);
    }
  }, []);

  useEffect(() => {
    loadAntennas();
  }, [loadAntennas]);

  // --- Wizard helpers ---
  function resetWizard() {
    setStep(1);
    setConnectionMethod("direct");
    setIp("192.168.1.20");
    setUsername("ubnt");
    setPassword("ubnt");
    setConnecting(false);
    setConnectError("");
    setScanning(false);
    setScannedDevices([]);
    setSelectedScan(null);
    setDeviceInfo(null);
    setRole("station");
    setSavedAPs([]);
    setSelectedAP(null);
    setStationSSID("");
    setStationWPA("");
    setStationFreq("");
    setStationChWidth("20");
    setStationMgmtIP("");
    setStationName("");
    setStationTxPower(20);
    setStationNetMode("bridge");
    setApSSID("");
    setApWPA("");
    setApFreq("5180");
    setApChWidth("40");
    setApAirmax(true);
    setApMgmtIP("");
    setApName("");
    setPushMethod("http");
    setPushSteps([]);
    setPushing(false);
    setPushDone(false);
    setPushError(false);
    setShowLog(false);
    setPushLog([]);
    setVerifying(false);
    setCountdown(60);
    setVerification(null);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }

  function openWizard() {
    resetWizard();
    setShowWizard(true);
  }

  function closeWizard() {
    resetWizard();
    setShowWizard(false);
  }

  // --- Step 1: Connect ---
  async function handleConnect() {
    setConnecting(true);
    setConnectError("");
    const targetIp = connectionMethod === "scan" && selectedScan ? selectedScan.ip : ip;
    try {
      const raw = await invoke<any>("connect_ubnt_device", {
        ip: targetIp,
        username,
        password,
        method: "ssh",
      });
      const info: DeviceInfo = {
        model: raw.model || "Unknown",
        firmware: raw.firmware || "",
        mac: raw.mac || "",
        ip: raw.ip || targetIp,
        is_factory: raw.is_factory_default ?? false,
        ssid: raw.current_config?.ssid || "",
        wireless_mode: raw.current_config?.wireless_mode || "",
      };
      setDeviceInfo(info);
      setStep(2);
    } catch (err: any) {
      setConnectError(typeof err === "string" ? err : err?.message ?? "Error al conectar");
    } finally {
      setConnecting(false);
    }
  }

  async function handleScan() {
    setScanning(true);
    setScannedDevices([]);
    try {
      const devices = await invoke<{ devices: ScannedDevice[] }>("discover_ubnt_devices").then(r => r?.devices ?? []);
      setScannedDevices(devices);
    } catch {
      setScannedDevices([]);
    } finally {
      setScanning(false);
    }
  }

  // --- Step 3 → 4: Load APs ---
  async function loadSavedAPs() {
    setLoadingAPs(true);
    try {
      const result = await invoke<{ aps: any[] }>("get_saved_aps");
      setSavedAPs((result?.aps ?? []).map((a: any) => ({
        id: a.id, name: a.name, ssid: "", frequency: 0, channel_width: 40,
        wpa_key: "", ip: a.ip || "",
      })));
    } catch {
      setSavedAPs([]);
    } finally {
      setLoadingAPs(false);
    }
  }

  function selectAP(ap: SavedAP) {
    setSelectedAP(ap);
    setStationSSID(ap.ssid);
    setStationWPA(ap.wpa_key);
    setStationFreq(String(ap.frequency));
    setStationChWidth(String(ap.channel_width));
  }

  // --- Step 5: Push config ---
  async function handlePushConfig() {
    const steps: PushStep[] = [
      { label: "Conectando", status: "pending" },
      { label: "Autenticando", status: "pending" },
      { label: "Config wireless", status: "pending" },
      { label: "Config red", status: "pending" },
      { label: "Guardando", status: "pending" },
      { label: "Reiniciando", status: "pending" },
    ];
    setPushSteps(steps);
    setPushing(true);
    setPushDone(false);
    setPushError(false);
    setPushLog([]);

    const config = role === "station"
      ? {
          role,
          ssid: stationSSID,
          wpa_key: stationWPA,
          frequency: stationFreq,
          channel_width: stationChWidth,
          mgmt_ip: stationMgmtIP,
          device_name: stationName,
          tx_power: stationTxPower,
          net_mode: stationNetMode,
        }
      : {
          role,
          ssid: apSSID,
          wpa_key: apWPA,
          frequency: apFreq,
          channel_width: apChWidth,
          airmax: apAirmax,
          mgmt_ip: apMgmtIP,
          device_name: apName,
        };

    // Animate steps as we provision
    for (let i = 0; i < 3; i++) {
      setPushSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "running" } : s));
      await new Promise(r => setTimeout(r, 500));
      setPushSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "success" } : s));
    }

    // Step 4: Push config via provision_antenna
    setPushSteps(prev => prev.map((s, idx) => idx === 3 ? { ...s, status: "running" } : s));
    try {
      const result = await invoke<{ success: boolean; steps: any[]; reboot_ip: string }>("provision_antenna", {
        ip: deviceInfo?.ip ?? ip,
        username,
        password,
        method: pushMethod,
        config: JSON.stringify(config),
      });

      setPushLog(result.steps?.map((s: any) => `[${s.name}] ${s.status}: ${s.message}`) ?? []);

      if (!result.success) {
        const failedStep = result.steps?.find((s: any) => s.status === "error");
        setPushSteps(prev => prev.map((s, idx) => idx === 3 ? { ...s, status: "error", error: failedStep?.message || "Error" } : s));
        setPushError(true);
        setPushing(false);
        return;
      }

      // Mark remaining steps as success
      setPushSteps(prev => prev.map((s, idx) => idx >= 3 ? { ...s, status: "success" } : s));
      setPushing(false);
      setPushDone(true);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message ?? "Error";
      setPushLog(prev => [...prev, `ERROR: ${msg}`]);
      setPushSteps(prev => prev.map((s, idx) => idx === 3 ? { ...s, status: "error", error: msg } : s));
      setPushError(true);
      setPushing(false);
    }
  }

  // --- Step 6: Verification ---
  function startVerification() {
    setVerifying(true);
    setCountdown(60);
    setVerification(null);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          runVerification();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function runVerification() {
    try {
      const mgmtIp = role === "station" ? stationMgmtIP : apMgmtIP;
      const raw = await invoke<any>("verify_antenna", {
        ip: mgmtIp || deviceInfo?.ip || ip,
        username,
        password,
      });
      const result: VerificationResult = {
        ping_ok: raw.reachable ?? false,
        signal_dbm: raw.signal_dbm ?? undefined,
        ccq: raw.ccq ?? undefined,
        tx_rate: raw.tx_rate ?? undefined,
        rx_rate: raw.rx_rate ?? undefined,
      };
      setVerification(result);
    } catch {
      setVerification({ ping_ok: false });
    } finally {
      setVerifying(false);
    }
  }

  async function handleSaveAntenna() {
    const name = role === "station" ? stationName : apName;
    const ssid = role === "station" ? stationSSID : apSSID;
    const mgmtIp = role === "station" ? stationMgmtIP : apMgmtIP;
    try {
      await invoke("save_antenna_node", {
        name,
        ip: mgmtIp || deviceInfo?.ip || ip,
        mac: deviceInfo?.mac ?? "",
        model: deviceInfo?.model ?? "Unknown",
        firmware: deviceInfo?.firmware ?? "",
        role,
        parentId: selectedAP?.id ?? null,
        configJson: JSON.stringify({ ssid, role }),
      });
      await loadAntennas();
      closeWizard();
    } catch (err: any) {
      console.error("Error saving antenna:", err);
    }
  }

  async function handleDeleteAntenna(id: string) {
    try {
      await invoke("delete_node", { id });
      await loadAntennas();
    } catch (err: any) {
      console.error("Error deleting antenna:", err);
    }
  }

  // Navigation
  function goNext() {
    if (step === 3) {
      if (role === "station") loadSavedAPs();
      setStep(4);
    } else if (step === 5 && pushDone) {
      startVerification();
      setStep(6);
    } else {
      setStep(((step + 1) as WizardStep));
    }
  }

  function goBack() {
    if (step > 1) setStep((step - 1) as WizardStep);
  }

  const canGoNext = (): boolean => {
    switch (step) {
      case 1:
        return false; // "Conectar" button handles this
      case 2:
        return !!deviceInfo;
      case 3:
        return !!role;
      case 4:
        if (role === "station") return !!(stationSSID && stationMgmtIP && stationName);
        return !!(apSSID && apMgmtIP && apName);
      case 5:
        return pushDone;
      default:
        return false;
    }
  };

  // =========================================================================
  // RENDER — Antenna List (main page)
  // =========================================================================
  if (!showWizard) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#0f172a]">Antenas</h1>
            <p className="text-sm text-[#64748b]">
              Gestiona y provisiona antenas Ubiquiti en tu red
            </p>
          </div>
          <button
            onClick={openWizard}
            className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-[#006fff]/20 transition-all hover:bg-[#0058cc]"
          >
            <Plus className="h-4 w-4" />
            Agregar Antena
          </button>
        </div>

        {/* Saved antennas */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-[#475569]">
            Antenas Configuradas
          </p>

          {loadingAntennas ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#006fff]" />
            </div>
          ) : savedAntennas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f1f5f9]">
                <Radio className="h-7 w-7 text-[#94a3b8]" />
              </div>
              <p className="text-sm font-medium text-[#64748b]">
                No hay antenas configuradas
              </p>
              <p className="mt-1 text-xs text-[#94a3b8]">
                Usa el wizard para agregar tu primera antena
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#f1f5f9] text-xs font-medium uppercase tracking-wider text-[#94a3b8]">
                    <th className="pb-3 pr-4">Nombre</th>
                    <th className="pb-3 pr-4">Modelo</th>
                    <th className="pb-3 pr-4">Rol</th>
                    <th className="pb-3 pr-4">IP</th>
                    <th className="pb-3 pr-4">SSID</th>
                    <th className="pb-3 pr-4">MAC</th>
                    <th className="pb-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f5f9]">
                  {savedAntennas.map((a) => (
                    <tr key={a.id} className="group">
                      <td className="py-3 pr-4 font-medium text-[#0f172a]">{a.name}</td>
                      <td className="py-3 pr-4 text-[#64748b]">{a.model}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            a.role === "ap"
                              ? "bg-[#eff6ff] text-[#006fff]"
                              : a.role === "station"
                                ? "bg-[#f0fdf4] text-[#16a34a]"
                                : "bg-[#fef3c7] text-[#f59e0b]"
                          }`}
                        >
                          {a.role === "ap" ? "AP" : a.role === "station" ? "Estacion" : "PtP"}
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-[#64748b]">{a.ip}</td>
                      <td className="py-3 pr-4 text-[#64748b]">{a.ssid}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-[#94a3b8]">{a.mac}</td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleDeleteAntenna(a.id)}
                          className="rounded-lg p-1.5 text-[#94a3b8] opacity-0 transition-all hover:bg-red-50 hover:text-[#dc2626] group-hover:opacity-100"
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // RENDER — Wizard
  // =========================================================================
  return (
    <div className="space-y-6">
      {/* Wizard Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={closeWizard}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e2e8f0] text-[#64748b] transition-colors hover:bg-[#f8fafc] hover:text-[#0f172a]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-[#0f172a]">Agregar Antena</h1>
            <p className="text-sm text-[#64748b]">Wizard de provisionamiento</p>
          </div>
        </div>
        <StepIndicator current={step} />
      </div>

      {/* Step Content */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        {/* ---- STEP 1: Connection Method ---- */}
        {step === 1 && (
          <div className="space-y-6">
            <p className="text-sm font-semibold uppercase tracking-widest text-[#475569]">
              Paso 1 — Metodo de Conexion
            </p>

            <div className="flex gap-4">
              <SelectableCard
                icon={Cable}
                title="Conexion Directa"
                description="Antena nueva en 192.168.1.20"
                selected={connectionMethod === "direct"}
                onClick={() => {
                  setConnectionMethod("direct");
                  setIp("192.168.1.20");
                }}
              />
              <SelectableCard
                icon={Network}
                title="IP en Red"
                description="Antena con IP conocida"
                selected={connectionMethod === "network"}
                onClick={() => {
                  setConnectionMethod("network");
                  setIp("");
                }}
              />
              <SelectableCard
                icon={Search}
                title="Escanear Red"
                description="Descubrir dispositivos Ubiquiti"
                selected={connectionMethod === "scan"}
                onClick={() => setConnectionMethod("scan")}
              />
            </div>

            {/* Scan section */}
            {connectionMethod === "scan" && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleScan}
                    disabled={scanning}
                    className="flex items-center gap-2 rounded-xl bg-[#f1f5f9] px-4 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#e2e8f0] disabled:opacity-50"
                  >
                    {scanning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    {scanning ? "Escaneando..." : "Escanear Red"}
                  </button>
                </div>

                {scannedDevices.length > 0 && (
                  <div className="space-y-2">
                    {scannedDevices.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setSelectedScan(d);
                          setIp(d.ip);
                        }}
                        className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                          selectedScan?.mac === d.mac
                            ? "border-[#006fff] bg-[#eff6ff]"
                            : "border-[#e2e8f0] hover:border-[#cbd5e1]"
                        }`}
                      >
                        <Radio className="h-5 w-5 shrink-0 text-[#64748b]" />
                        <div className="flex-1">
                          <p className="font-medium text-[#0f172a]">{d.model}</p>
                          <p className="text-xs text-[#94a3b8]">
                            MAC: {d.mac} | IP: {d.ip}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* IP + Credentials */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Direccion IP
                </label>
                <input
                  type="text"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="192.168.1.20"
                  disabled={connectionMethod === "direct"}
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10 disabled:bg-[#f8fafc] disabled:text-[#94a3b8]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Usuario
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Contrasena
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 pr-10 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b]"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {connectError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#dc2626]">
                <XCircle className="h-4 w-4 shrink-0" />
                {connectError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleConnect}
                disabled={connecting || !ip}
                className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-[#006fff]/20 transition-all hover:bg-[#0058cc] disabled:opacity-50"
              >
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {connecting ? "Conectando..." : "Conectar"}
              </button>
            </div>
          </div>
        )}

        {/* ---- STEP 2: Device Info ---- */}
        {step === 2 && deviceInfo && (
          <div className="space-y-6">
            <p className="text-sm font-semibold uppercase tracking-widest text-[#475569]">
              Paso 2 — Informacion del Dispositivo
            </p>

            {/* Firmware banner */}
            <div
              className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
                deviceInfo.firmware_latest !== false
                  ? "bg-[#f0fdf4] text-[#16a34a]"
                  : "bg-[#fef3c7] text-[#f59e0b]"
              }`}
            >
              {deviceInfo.firmware_latest !== false ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Firmware actualizado
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4" />
                  Firmware desactualizado — se recomienda actualizar
                </>
              )}
            </div>

            <div className="grid grid-cols-3 gap-6">
              <InfoField label="Modelo" value={deviceInfo.model} />
              <InfoField label="Firmware" value={deviceInfo.firmware} />
              <InfoField label="MAC" value={deviceInfo.mac} />
              <InfoField label="IP Actual" value={deviceInfo.ip} />
              <InfoField
                label="Estado"
                value={deviceInfo.is_factory ? "Fabrica (sin config)" : "Configurado"}
              />
              {deviceInfo.ssid && <InfoField label="SSID Actual" value={deviceInfo.ssid} />}
              {deviceInfo.wireless_mode && (
                <InfoField label="Modo Wireless" value={deviceInfo.wireless_mode} />
              )}
            </div>

            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                deviceInfo.is_factory
                  ? "bg-[#eff6ff] text-[#006fff]"
                  : "bg-[#fef3c7] text-[#f59e0b]"
              }`}
            >
              <Settings2 className="h-3 w-3" />
              {deviceInfo.is_factory ? "Listo para configurar" : "Ya tiene configuracion"}
            </div>
          </div>
        )}

        {/* ---- STEP 3: Role Selection ---- */}
        {step === 3 && (
          <div className="space-y-6">
            <p className="text-sm font-semibold uppercase tracking-widest text-[#475569]">
              Paso 3 — Seleccionar Rol
            </p>

            <div className="flex gap-4">
              <SelectableCard
                icon={Wifi}
                title="Estacion (CPE)"
                description="Recibe senal de un AP"
                selected={role === "station"}
                onClick={() => setRole("station")}
              />
              <SelectableCard
                icon={Radio}
                title="Access Point (Sector)"
                description="Transmite senal a estaciones"
                selected={role === "ap"}
                onClick={() => setRole("ap")}
              />
              <SelectableCard
                icon={ArrowLeftRight}
                title="Punto a Punto"
                description="Enlace dedicado"
                selected={role === "ptp"}
                onClick={() => setRole("ptp")}
              />
            </div>
          </div>
        )}

        {/* ---- STEP 4: Configuration ---- */}
        {step === 4 && role === "station" && (
          <div className="space-y-6">
            <p className="text-sm font-semibold uppercase tracking-widest text-[#475569]">
              Paso 4 — Configuracion de Estacion
            </p>

            {/* AP selection */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                AP Padre
              </label>
              <div className="flex gap-3">
                <select
                  value={selectedAP?.id ?? ""}
                  onChange={(e) => {
                    const ap = savedAPs.find((a) => a.id === e.target.value);
                    if (ap) selectAP(ap);
                  }}
                  className="flex-1 rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                >
                  <option value="">Seleccionar AP...</option>
                  {savedAPs.map((ap) => (
                    <option key={ap.id} value={ap.id}>
                      {ap.name} — {ap.ssid} ({ap.ip})
                    </option>
                  ))}
                </select>
                <button
                  onClick={loadSavedAPs}
                  disabled={loadingAPs}
                  className="flex items-center gap-2 rounded-xl bg-[#f1f5f9] px-4 py-2.5 text-sm font-medium text-[#475569] transition-colors hover:bg-[#e2e8f0] disabled:opacity-50"
                >
                  {loadingAPs ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Escanear APs
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">SSID</label>
                <input
                  type="text"
                  value={stationSSID}
                  onChange={(e) => setStationSSID(e.target.value)}
                  placeholder="SSID del AP padre"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  WPA Key
                </label>
                <input
                  type="text"
                  value={stationWPA}
                  onChange={(e) => setStationWPA(e.target.value)}
                  placeholder="Contrasena WPA"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Frecuencia (MHz)
                </label>
                <input
                  type="text"
                  value={stationFreq}
                  onChange={(e) => setStationFreq(e.target.value)}
                  placeholder="5180"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Ancho de Canal
                </label>
                <div className="flex gap-2">
                  {["20", "40", "80"].map((w) => (
                    <button
                      key={w}
                      onClick={() => setStationChWidth(w)}
                      className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                        stationChWidth === w
                          ? "border-[#006fff] bg-[#eff6ff] text-[#006fff]"
                          : "border-[#e2e8f0] text-[#64748b] hover:border-[#cbd5e1]"
                      }`}
                    >
                      {w} MHz
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  IP de Gestion
                </label>
                <input
                  type="text"
                  value={stationMgmtIP}
                  onChange={(e) => setStationMgmtIP(e.target.value)}
                  placeholder="10.0.0.x"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Nombre del Dispositivo
                </label>
                <input
                  type="text"
                  value={stationName}
                  onChange={(e) => setStationName(e.target.value)}
                  placeholder="CPE-ClienteX"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
            </div>

            {/* TX Power */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                Potencia TX: {stationTxPower} dBm
              </label>
              <input
                type="range"
                min={1}
                max={30}
                value={stationTxPower}
                onChange={(e) => setStationTxPower(Number(e.target.value))}
                className="w-full accent-[#006fff]"
              />
              <div className="flex justify-between text-[10px] text-[#94a3b8]">
                <span>1 dBm</span>
                <span>30 dBm</span>
              </div>
            </div>

            {/* Network mode */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                Modo de Red
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setStationNetMode("bridge")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                    stationNetMode === "bridge"
                      ? "border-[#006fff] bg-[#eff6ff] text-[#006fff]"
                      : "border-[#e2e8f0] text-[#64748b] hover:border-[#cbd5e1]"
                  }`}
                >
                  Bridge
                  {stationNetMode === "bridge" && (
                    <span className="rounded-full bg-[#006fff] px-1.5 py-0.5 text-[10px] text-white">
                      Recomendado
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setStationNetMode("router")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                    stationNetMode === "router"
                      ? "border-[#006fff] bg-[#eff6ff] text-[#006fff]"
                      : "border-[#e2e8f0] text-[#64748b] hover:border-[#cbd5e1]"
                  }`}
                >
                  Router
                </button>
              </div>
            </div>

            {/* Info box */}
            <div className="flex items-start gap-3 rounded-xl bg-[#eff6ff] px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#006fff]" />
              <p className="text-xs leading-relaxed text-[#475569]">
                Modo <strong>Bridge</strong> es recomendado para estaciones CPE. En este modo, la
                antena actua como un puente transparente y el MikroTik maneja el DHCP y ruteo.
                Usa modo <strong>Router</strong> solo si necesitas NAT en la antena.
              </p>
            </div>
          </div>
        )}

        {step === 4 && (role === "ap" || role === "ptp") && (
          <div className="space-y-6">
            <p className="text-sm font-semibold uppercase tracking-widest text-[#475569]">
              Paso 4 — Configuracion de {role === "ap" ? "Access Point" : "Punto a Punto"}
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">SSID</label>
                <input
                  type="text"
                  value={apSSID}
                  onChange={(e) => setApSSID(e.target.value)}
                  placeholder="RedAmeca-Sector1"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  WPA Key
                </label>
                <input
                  type="text"
                  value={apWPA}
                  onChange={(e) => setApWPA(e.target.value)}
                  placeholder="Contrasena WPA"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Frecuencia (MHz)
                </label>
                <input
                  type="text"
                  value={apFreq}
                  onChange={(e) => setApFreq(e.target.value)}
                  placeholder="5180"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Ancho de Canal
                </label>
                <div className="flex gap-2">
                  {["20", "40", "80"].map((w) => (
                    <button
                      key={w}
                      onClick={() => setApChWidth(w)}
                      className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                        apChWidth === w
                          ? "border-[#006fff] bg-[#eff6ff] text-[#006fff]"
                          : "border-[#e2e8f0] text-[#64748b] hover:border-[#cbd5e1]"
                      }`}
                    >
                      {w} MHz
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  IP de Gestion
                </label>
                <input
                  type="text"
                  value={apMgmtIP}
                  onChange={(e) => setApMgmtIP(e.target.value)}
                  placeholder="10.0.0.x"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Nombre del Dispositivo
                </label>
                <input
                  type="text"
                  value={apName}
                  onChange={(e) => setApName(e.target.value)}
                  placeholder="AP-Sector1"
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#cbd5e1] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-2 focus:ring-[#006fff]/10"
                />
              </div>
            </div>

            {/* AirMax toggle */}
            {role === "ap" && (
              <div className="flex items-center justify-between rounded-xl border border-[#e2e8f0] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[#0f172a]">AirMax</p>
                  <p className="text-xs text-[#94a3b8]">
                    Protocolo propietario Ubiquiti para mejor rendimiento
                  </p>
                </div>
                <button
                  onClick={() => setApAirmax(!apAirmax)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    apAirmax ? "bg-[#006fff]" : "bg-[#e2e8f0]"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      apAirmax ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Show other APs' frequencies */}
            {savedAPs.length > 0 && (
              <div className="rounded-xl border border-[#fef3c7] bg-[#fffbeb] px-4 py-3">
                <p className="mb-2 text-xs font-semibold text-[#f59e0b]">
                  Frecuencias en uso por otros APs
                </p>
                <div className="flex flex-wrap gap-2">
                  {savedAPs.map((ap) => (
                    <span
                      key={ap.id}
                      className="rounded-full bg-[#fef3c7] px-2.5 py-1 text-xs font-medium text-[#92400e]"
                    >
                      {ap.name}: {ap.frequency} MHz
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- STEP 5: Push Config ---- */}
        {step === 5 && (
          <div className="space-y-6">
            <p className="text-sm font-semibold uppercase tracking-widest text-[#475569]">
              Paso 5 — Aplicar Configuracion
            </p>

            {/* Method toggle */}
            {!pushing && !pushDone && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#475569]">
                  Metodo de Envio
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setPushMethod("http")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                      pushMethod === "http"
                        ? "border-[#006fff] bg-[#eff6ff] text-[#006fff]"
                        : "border-[#e2e8f0] text-[#64748b] hover:border-[#cbd5e1]"
                    }`}
                  >
                    <Monitor className="h-4 w-4" />
                    HTTP API
                    {pushMethod === "http" && (
                      <span className="rounded-full bg-[#006fff] px-1.5 py-0.5 text-[10px] text-white">
                        Recomendado
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setPushMethod("ssh")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                      pushMethod === "ssh"
                        ? "border-[#006fff] bg-[#eff6ff] text-[#006fff]"
                        : "border-[#e2e8f0] text-[#64748b] hover:border-[#cbd5e1]"
                    }`}
                  >
                    <Settings2 className="h-4 w-4" />
                    SSH
                  </button>
                </div>
              </div>
            )}

            {/* Push button */}
            {!pushing && !pushDone && !pushError && (
              <div className="flex justify-center">
                <button
                  onClick={handlePushConfig}
                  className="flex items-center gap-2 rounded-xl bg-[#006fff] px-6 py-3 text-sm font-medium text-white shadow-md shadow-[#006fff]/20 transition-all hover:bg-[#0058cc]"
                >
                  <Zap className="h-4 w-4" />
                  Aplicar Configuracion
                </button>
              </div>
            )}

            {/* Stepper */}
            {pushSteps.length > 0 && (
              <div className="space-y-3">
                {pushSteps.map((s, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                      s.status === "running"
                        ? "border-[#006fff] bg-[#eff6ff]"
                        : s.status === "success"
                          ? "border-[#bbf7d0] bg-[#f0fdf4]"
                          : s.status === "error"
                            ? "border-red-200 bg-red-50"
                            : "border-[#e2e8f0] bg-[#f8fafc]"
                    }`}
                  >
                    {s.status === "running" && (
                      <Loader2 className="h-5 w-5 animate-spin text-[#006fff]" />
                    )}
                    {s.status === "success" && (
                      <CheckCircle2 className="h-5 w-5 text-[#16a34a]" />
                    )}
                    {s.status === "error" && <XCircle className="h-5 w-5 text-[#dc2626]" />}
                    {s.status === "pending" && (
                      <div className="h-5 w-5 rounded-full border-2 border-[#e2e8f0]" />
                    )}
                    <span
                      className={`text-sm font-medium ${
                        s.status === "running"
                          ? "text-[#006fff]"
                          : s.status === "success"
                            ? "text-[#16a34a]"
                            : s.status === "error"
                              ? "text-[#dc2626]"
                              : "text-[#94a3b8]"
                      }`}
                    >
                      {s.label}
                    </span>
                    {s.error && (
                      <span className="ml-auto text-xs text-[#dc2626]">{s.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Error retry */}
            {pushError && (
              <div className="flex justify-center">
                <button
                  onClick={handlePushConfig}
                  className="flex items-center gap-2 rounded-xl bg-[#dc2626] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#b91c1c]"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reintentar
                </button>
              </div>
            )}

            {/* Log */}
            {pushLog.length > 0 && (
              <div>
                <button
                  onClick={() => setShowLog(!showLog)}
                  className="flex items-center gap-1.5 text-xs font-medium text-[#64748b] hover:text-[#0f172a]"
                >
                  {showLog ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  Ver log
                </button>
                {showLog && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-[#e2e8f0] bg-[#0f172a] p-4 font-mono text-xs leading-relaxed text-[#e2e8f0]">
                    {pushLog.join("\n")}
                  </pre>
                )}
              </div>
            )}

            {/* Success banner */}
            {pushDone && (
              <div className="flex items-center gap-2 rounded-xl bg-[#f0fdf4] px-4 py-3 text-sm font-medium text-[#16a34a]">
                <CheckCircle2 className="h-5 w-5" />
                Configuracion aplicada exitosamente. El dispositivo se esta reiniciando.
              </div>
            )}
          </div>
        )}

        {/* ---- STEP 6: Verification ---- */}
        {step === 6 && (
          <div className="space-y-6">
            <p className="text-sm font-semibold uppercase tracking-widest text-[#475569]">
              Paso 6 — Verificacion
            </p>

            {/* Countdown */}
            {countdown > 0 && !verification && (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="relative mb-4 flex h-28 w-28 items-center justify-center">
                  <svg className="h-28 w-28 -rotate-90" viewBox="0 0 120 120">
                    <circle
                      cx="60"
                      cy="60"
                      r="54"
                      fill="none"
                      stroke="#e2e8f0"
                      strokeWidth="6"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      r="54"
                      fill="none"
                      stroke="#006fff"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 54}`}
                      strokeDashoffset={`${2 * Math.PI * 54 * (1 - countdown / 60)}`}
                      className="transition-all duration-1000"
                    />
                  </svg>
                  <span className="absolute text-2xl font-bold text-[#0f172a]">{countdown}s</span>
                </div>
                <p className="text-sm text-[#64748b]">
                  Esperando a que el dispositivo reinicie...
                </p>
              </div>
            )}

            {/* Verification results */}
            {verification && (
              <div className="space-y-6">
                {/* Ping */}
                <div className="flex items-center gap-3">
                  <div
                    className={`h-4 w-4 rounded-full ${
                      verification.ping_ok ? "bg-[#16a34a]" : "bg-[#dc2626]"
                    }`}
                  />
                  <span className="text-sm font-medium text-[#0f172a]">
                    Ping: {verification.ping_ok ? "Exitoso" : "Sin respuesta"}
                  </span>
                </div>

                {/* Signal stats (station only) */}
                {role === "station" && verification.ping_ok && (
                  <div className="grid grid-cols-4 gap-4">
                    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-center">
                      <Signal className="mx-auto mb-1 h-5 w-5 text-[#006fff]" />
                      <p className="text-lg font-bold text-[#0f172a]">
                        {verification.signal_dbm ?? "--"} dBm
                      </p>
                      <p className="text-xs text-[#94a3b8]">Senal</p>
                    </div>
                    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-center">
                      <Wifi className="mx-auto mb-1 h-5 w-5 text-[#16a34a]" />
                      <p className="text-lg font-bold text-[#0f172a]">
                        {verification.ccq ?? "--"}%
                      </p>
                      <p className="text-xs text-[#94a3b8]">CCQ</p>
                    </div>
                    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-center">
                      <ArrowRight className="mx-auto mb-1 h-5 w-5 text-[#f59e0b]" />
                      <p className="text-lg font-bold text-[#0f172a]">
                        {verification.tx_rate ?? "--"} Mbps
                      </p>
                      <p className="text-xs text-[#94a3b8]">TX Rate</p>
                    </div>
                    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-center">
                      <ArrowLeft className="mx-auto mb-1 h-5 w-5 text-[#8b5cf6]" />
                      <p className="text-lg font-bold text-[#0f172a]">
                        {verification.rx_rate ?? "--"} Mbps
                      </p>
                      <p className="text-xs text-[#94a3b8]">RX Rate</p>
                    </div>
                  </div>
                )}

                {/* Summary card */}
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#94a3b8]">
                    Resumen de Configuracion
                  </p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                    <InfoField label="Modelo" value={deviceInfo?.model ?? "-"} />
                    <InfoField label="Rol" value={role === "station" ? "Estacion" : role === "ap" ? "Access Point" : "Punto a Punto"} />
                    <InfoField label="SSID" value={role === "station" ? stationSSID : apSSID} />
                    <InfoField label="IP de Gestion" value={role === "station" ? stationMgmtIP : apMgmtIP} />
                    <InfoField label="Nombre" value={role === "station" ? stationName : apName} />
                    <InfoField label="MAC" value={deviceInfo?.mac ?? "-"} />
                    {role === "station" && (
                      <>
                        <InfoField label="Frecuencia" value={`${stationFreq} MHz`} />
                        <InfoField label="Ancho de Canal" value={`${stationChWidth} MHz`} />
                        <InfoField label="TX Power" value={`${stationTxPower} dBm`} />
                        <InfoField label="Modo Red" value={stationNetMode === "bridge" ? "Bridge" : "Router"} />
                      </>
                    )}
                    {(role === "ap" || role === "ptp") && (
                      <>
                        <InfoField label="Frecuencia" value={`${apFreq} MHz`} />
                        <InfoField label="Ancho de Canal" value={`${apChWidth} MHz`} />
                        {role === "ap" && <InfoField label="AirMax" value={apAirmax ? "Activado" : "Desactivado"} />}
                      </>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={handleSaveAntenna}
                    className="flex items-center gap-2 rounded-xl bg-[#16a34a] px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-[#16a34a]/20 transition-all hover:bg-[#15803d]"
                  >
                    <Save className="h-4 w-4" />
                    Guardar en Linker
                  </button>
                  <button
                    onClick={() => {
                      resetWizard();
                      setShowWizard(true);
                    }}
                    className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f8fafc]"
                  >
                    <Plus className="h-4 w-4" />
                    Configurar Otra
                  </button>
                  <button
                    onClick={() => setStep(4)}
                    className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f8fafc]"
                  >
                    <Settings2 className="h-4 w-4" />
                    Editar Config
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation bar */}
      {step !== 1 && step !== 6 && (
        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#475569] transition-all hover:bg-[#f8fafc]"
          >
            <ArrowLeft className="h-4 w-4" />
            Atras
          </button>

          {step !== 5 && (
            <button
              onClick={goNext}
              disabled={!canGoNext()}
              className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-[#006fff]/20 transition-all hover:bg-[#0058cc] disabled:opacity-50"
            >
              {step === 4 ? "Aplicar" : "Siguiente"}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}

          {step === 5 && pushDone && (
            <button
              onClick={goNext}
              className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-[#006fff]/20 transition-all hover:bg-[#0058cc]"
            >
              Verificar
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
