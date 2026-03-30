"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Wifi,
  Clock,
  Users,
  AlertTriangle,
  RefreshCw,
  Signal,
  Radio,
  Activity,
  Cpu,
  HardDrive,
} from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import Skeleton from "@/components/Skeleton";

interface NodeDetail {
  id: string;
  name: string;
  type: string;
  ip: string;
  status: string;
  lastSeen: string;
  signal: number | null;
  children: Array<{
    id: string;
    name: string;
    type: string;
    ip: string;
    status: string;
  }>;
}

interface ConnectedClient {
  name: string;
  mac?: string;
  signal?: string;
  ip?: string;
  txRate?: string;
  rxRate?: string;
  ccq?: string;
  uptime?: string;
  callerId?: string;
  plan?: { name: string };
}

interface NodeStatus {
  // Antenna fields
  signal?: number | null;
  noiseFloor?: number | null;
  frequency?: string | null;
  channelWidth?: string | null;
  txRate?: string | null;
  rxRate?: string | null;
  uptime?: string | null;
  distance?: string | null;
  ccq?: string | null;
  deviceName?: string | null;
  stations?: Array<Record<string, unknown>>;
  connectedClients?: ConnectedClient[];
  // Router fields
  cpuLoad?: string;
  memoryUsage?: string;
  version?: string;
  board?: string;
  pppoeActive?: number;
  interfaces?: Array<{
    name: string;
    type: string;
    txBytes?: string;
    rxBytes?: string;
  }>;
  // Common
  error?: string | null;
}

export default function NodeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [liveStatus, setLiveStatus] = useState<NodeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = () => {
    const isRefresh = !loading;
    if (isRefresh) setRefreshing(true);

    Promise.all([
      fetch(`/api/nodes/${id}`).then((r) => {
        if (!r.ok) throw new Error("Error al cargar nodo");
        return r.json();
      }),
      fetch(`/api/nodes/${id}/status`).then((r) => {
        if (!r.ok) return null;
        return r.json();
      }),
    ])
      .then(([nodeData, statusData]) => {
        setNode(nodeData ?? null);
        if (statusData) {
          setLiveStatus(statusData as NodeStatus);
        } else {
          setLiveStatus(null);
        }
        setLoading(false);
        setRefreshing(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-2xl" />
            <div>
              <Skeleton className="h-7 w-36" />
              <div className="mt-2 flex items-center gap-2">
                <Skeleton className="h-5 w-12 rounded-md" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-28 rounded-xl" />
            <Skeleton className="h-6 w-16 rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-24" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"
            >
              <Skeleton className="mb-4 h-5 w-40" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div
                    key={j}
                    className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5"
                  >
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
          <p className="mt-4 text-sm text-[#dc2626]">{error}</p>
          <Link
            href="/red"
            className="mt-4 inline-block text-sm text-[#006fff] hover:text-[#0057cc]"
          >
            Volver a Red
          </Link>
        </div>
      </div>
    );
  }
  if (!node) return null;

  const isAntenna =
    (node.type ?? "").toUpperCase() === "AP" ||
    (node.type ?? "").toUpperCase() === "CPE";
  const isRouter = (node.type ?? "").toUpperCase() === "ROUTER";
  const isOnline = (node.status ?? "").toUpperCase() === "ONLINE";
  const hasError = !!liveStatus?.error;

  const connectedClients = liveStatus?.connectedClients ?? [];

  // Signal from live status, fallback to DB
  const signalValue =
    liveStatus?.signal != null
      ? liveStatus.signal
      : node.signal != null
        ? node.signal
        : null;

  const signalColor =
    signalValue != null
      ? signalValue > -60
        ? "text-[#16a34a]"
        : signalValue > -75
          ? "text-[#f59e0b]"
          : "text-[#dc2626]"
      : "text-[#94a3b8]";

  const signalBgColor =
    signalValue != null
      ? signalValue > -60
        ? "bg-[#f0fdf4]"
        : signalValue > -75
          ? "bg-[#fffbeb]"
          : "bg-[#fef2f2]"
      : "bg-[#f5f7fa]";

  return (
    <div className="space-y-6">
      {/* Navigation */}
      <Link
        href="/red"
        className="inline-flex items-center gap-2 text-sm text-[#475569] transition-colors hover:text-[#0f172a]"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a Red
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
              isOnline ? "bg-[#f0fdf4]" : "bg-[#fef2f2]"
            }`}
          >
            <Radio
              className={`h-6 w-6 ${
                isOnline ? "text-[#16a34a]" : "text-[#dc2626]"
              }`}
            />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
              {node.name ?? "-"}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-md bg-[#f5f7fa] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#475569] border border-[#e2e8f0]">
                {node.type ?? "-"}
              </span>
              <span className="font-mono text-sm text-[#94a3b8]">
                {node.ip ?? "-"}
              </span>
              {liveStatus?.deviceName && (
                <span className="text-xs text-[#94a3b8]">
                  ({liveStatus.deviceName})
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-transparent px-4 py-2 text-sm text-[#475569] transition-all duration-200 hover:bg-[#f5f7fa] hover:text-[#0f172a] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Actualizar
          </button>
          <StatusBadge status={node.status ?? "unknown"} />
        </div>
      </div>

      {/* Connection error banner */}
      {hasError && (
        <div className="flex items-center gap-3 rounded-xl border border-[#f59e0b]/30 bg-[#fffbeb] px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#f59e0b]" />
          <p className="text-sm text-[#92400e]">
            {liveStatus?.error || "Sin conexion al dispositivo"}
          </p>
        </div>
      )}

      {/* ── ANTENNA Info Grid ───────────────────────────────────────────── */}
      {isAntenna && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* Signal */}
          <div
            className={`rounded-2xl border border-[#e2e8f0] p-5 shadow-sm ${signalBgColor}`}
          >
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
              <Signal className="h-3.5 w-3.5" />
              Signal
            </div>
            <p className={`mt-3 text-2xl font-bold ${signalColor}`}>
              {signalValue != null ? `${signalValue} dBm` : "N/A"}
            </p>
            {liveStatus?.noiseFloor != null && (
              <p className="mt-1 text-xs text-[#94a3b8]">
                Ruido: {liveStatus.noiseFloor} dBm
              </p>
            )}
          </div>

          {/* Connected Clients */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
              <Users className="h-3.5 w-3.5" />
              Clientes Conectados
            </div>
            <p className="mt-3 text-2xl font-bold text-[#0f172a]">
              {connectedClients.length}
            </p>
          </div>

          {/* TX / RX Rate */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
              TX / RX Rate
            </div>
            <p className="mt-3 text-lg font-bold text-[#0f172a]">
              <span className="text-[#16a34a]">
                {liveStatus?.txRate && liveStatus.txRate !== "-"
                  ? liveStatus.txRate
                  : "-"}
              </span>
              <span className="mx-2 text-[#94a3b8]">/</span>
              <span className="text-[#006fff]">
                {liveStatus?.rxRate && liveStatus.rxRate !== "-"
                  ? liveStatus.rxRate
                  : "-"}
              </span>
            </p>
          </div>

          {/* Uptime */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
              <Clock className="h-3.5 w-3.5" />
              Uptime
            </div>
            <p className="mt-3 text-sm font-medium text-[#0f172a]">
              {liveStatus?.uptime
                ? liveStatus.uptime
                : node.lastSeen
                  ? `Visto: ${new Date(node.lastSeen).toLocaleString("es-MX")}`
                  : "N/A"}
            </p>
          </div>
        </div>
      )}

      {/* ── ROUTER Info Grid ────────────────────────────────────────────── */}
      {isRouter && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* CPU */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
              <Cpu className="h-3.5 w-3.5" />
              CPU
            </div>
            <p className="mt-3 text-2xl font-bold text-[#0f172a]">
              {liveStatus?.cpuLoad ? `${liveStatus.cpuLoad}%` : "N/A"}
            </p>
            {liveStatus?.board && (
              <p className="mt-1 text-xs text-[#94a3b8]">{liveStatus.board}</p>
            )}
          </div>

          {/* Memory */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
              <HardDrive className="h-3.5 w-3.5" />
              Memoria
            </div>
            <p className="mt-3 text-2xl font-bold text-[#0f172a]">
              {liveStatus?.memoryUsage || "N/A"}
            </p>
          </div>

          {/* PPPoE Active */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
              <Users className="h-3.5 w-3.5" />
              PPPoE Activos
            </div>
            <p className="mt-3 text-2xl font-bold text-[#0f172a]">
              {liveStatus?.pppoeActive ?? 0}
            </p>
          </div>

          {/* Uptime */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
              <Clock className="h-3.5 w-3.5" />
              Uptime
            </div>
            <p className="mt-3 text-sm font-medium text-[#0f172a]">
              {liveStatus?.uptime || "N/A"}
            </p>
            {liveStatus?.version && (
              <p className="mt-1 text-xs text-[#94a3b8]">
                v{liveStatus.version}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Non-antenna/non-router fallback grid ────────────────────────── */}
      {!isAntenna && !isRouter && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
              <Clock className="h-3.5 w-3.5" />
              Ultima Conexion
            </div>
            <p className="mt-3 text-sm font-medium text-[#0f172a]">
              {node.lastSeen
                ? new Date(node.lastSeen).toLocaleString("es-MX")
                : "N/A"}
            </p>
          </div>
        </div>
      )}

      {/* Details */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Node Info */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold tracking-tight text-[#0f172a]">
            Informacion del Nodo
          </h3>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
              <dt className="text-[#475569]">IP</dt>
              <dd className="font-mono text-[#0f172a]">{node.ip ?? "-"}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
              <dt className="text-[#475569]">Tipo</dt>
              <dd className="text-[#0f172a]">{node.type ?? "-"}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
              <dt className="text-[#475569]">Estado</dt>
              <dd>
                <StatusBadge status={node.status ?? "unknown"} size="sm" />
              </dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
              <dt className="text-[#475569]">Ultima vez visto</dt>
              <dd className="text-[#0f172a]">
                {node.lastSeen
                  ? new Date(node.lastSeen).toLocaleString("es-MX")
                  : "-"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Live Status (Antenna) */}
        {isAntenna && (
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-base font-semibold tracking-tight text-[#0f172a]">
              <Wifi className="h-4 w-4 text-[#006fff]" />
              Estado en Vivo (SSH)
            </h3>
            {hasError && !liveStatus?.signal ? (
              <div className="flex flex-col items-center justify-center py-8">
                <AlertTriangle className="h-8 w-8 text-[#94a3b8]" />
                <p className="mt-3 text-sm text-[#94a3b8]">
                  Sin conexion al dispositivo
                </p>
              </div>
            ) : (
              <dl className="space-y-3 text-sm">
                {liveStatus?.signal != null && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Signal</dt>
                    <dd className={signalColor}>
                      {liveStatus.signal} dBm
                    </dd>
                  </div>
                )}
                {liveStatus?.noiseFloor != null && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Piso de Ruido</dt>
                    <dd className="text-[#0f172a]">
                      {liveStatus.noiseFloor} dBm
                    </dd>
                  </div>
                )}
                {liveStatus?.frequency && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Frecuencia</dt>
                    <dd className="text-[#0f172a]">
                      {liveStatus.frequency} MHz
                    </dd>
                  </div>
                )}
                {liveStatus?.channelWidth && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Ancho de Canal</dt>
                    <dd className="text-[#0f172a]">
                      {liveStatus.channelWidth} MHz
                    </dd>
                  </div>
                )}
                {liveStatus?.txRate && liveStatus.txRate !== "-" && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">TX Rate</dt>
                    <dd className="text-[#16a34a]">{liveStatus.txRate}</dd>
                  </div>
                )}
                {liveStatus?.rxRate && liveStatus.rxRate !== "-" && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">RX Rate</dt>
                    <dd className="text-[#006fff]">{liveStatus.rxRate}</dd>
                  </div>
                )}
                {liveStatus?.distance && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Distancia</dt>
                    <dd className="text-[#0f172a]">
                      {liveStatus.distance} m
                    </dd>
                  </div>
                )}
                {liveStatus?.ccq && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">CCQ</dt>
                    <dd className="text-[#0f172a]">{liveStatus.ccq}%</dd>
                  </div>
                )}
                {liveStatus?.uptime && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Uptime</dt>
                    <dd className="text-[#0f172a]">{liveStatus.uptime}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        )}

        {/* Live Status (Router) */}
        {isRouter && (
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-base font-semibold tracking-tight text-[#0f172a]">
              <Activity className="h-4 w-4 text-[#006fff]" />
              Estado en Vivo (API)
            </h3>
            {hasError ? (
              <div className="flex flex-col items-center justify-center py-8">
                <AlertTriangle className="h-8 w-8 text-[#94a3b8]" />
                <p className="mt-3 text-sm text-[#94a3b8]">
                  Sin conexion al router
                </p>
              </div>
            ) : (
              <dl className="space-y-3 text-sm">
                {liveStatus?.cpuLoad && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Carga CPU</dt>
                    <dd className="text-[#0f172a]">{liveStatus.cpuLoad}%</dd>
                  </div>
                )}
                {liveStatus?.memoryUsage && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Memoria</dt>
                    <dd className="text-[#0f172a]">
                      {liveStatus.memoryUsage}
                    </dd>
                  </div>
                )}
                {liveStatus?.version && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Version</dt>
                    <dd className="text-[#0f172a]">{liveStatus.version}</dd>
                  </div>
                )}
                {liveStatus?.uptime && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Uptime</dt>
                    <dd className="text-[#0f172a]">{liveStatus.uptime}</dd>
                  </div>
                )}
                {liveStatus?.pppoeActive != null && (
                  <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                    <dt className="text-[#475569]">Sesiones PPPoE</dt>
                    <dd className="text-[#0f172a]">
                      {liveStatus.pppoeActive}
                    </dd>
                  </div>
                )}
                {liveStatus?.interfaces &&
                  liveStatus.interfaces.length > 0 && (
                    <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-2.5">
                      <dt className="text-[#475569]">Interfaces Activas</dt>
                      <dd className="text-[#0f172a]">
                        {liveStatus.interfaces.length}
                      </dd>
                    </div>
                  )}
              </dl>
            )}
          </div>
        )}
      </div>

      {/* Child Nodes */}
      {(node.children ?? []).length > 0 && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold tracking-tight text-[#0f172a]">
            Nodos Hijos ({(node.children ?? []).length})
          </h3>
          <div className="space-y-1.5">
            {(node.children ?? []).map((child) => {
              const childOnline =
                (child.status ?? "").toUpperCase() === "ONLINE";
              return (
                <Link
                  key={child.id}
                  href={`/red/${child.id}`}
                  className="flex items-center justify-between rounded-xl px-4 py-3 transition-all duration-200 hover:bg-[#f8f9fb]"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2.5 w-2.5 rounded-full ${
                        childOnline
                          ? "bg-[#16a34a] status-dot-online"
                          : "bg-[#dc2626]"
                      }`}
                    />
                    <span className="text-sm font-medium text-[#0f172a]">
                      {child.name ?? "-"}
                    </span>
                    <span className="rounded-md bg-[#f5f7fa] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#475569] border border-[#e2e8f0]">
                      {child.type ?? "-"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge
                      status={child.status ?? "unknown"}
                      size="sm"
                    />
                    <span className="font-mono text-xs text-[#94a3b8]">
                      {child.ip ?? "-"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Connected Stations / Clients */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold tracking-tight text-[#0f172a]">
          <Users className="h-4 w-4 text-[#006fff]" />
          {isRouter ? "Clientes PPPoE Activos" : "Estaciones Conectadas"} (
          {connectedClients.length})
        </h3>
        {connectedClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Users className="h-8 w-8 text-[#94a3b8]" />
            <p className="mt-3 text-sm text-[#94a3b8]">
              {hasError
                ? "Sin conexion al dispositivo"
                : isRouter
                  ? "No hay sesiones PPPoE activas"
                  : "No hay estaciones conectadas"}
            </p>
          </div>
        ) : isRouter ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0]">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                    Usuario
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                    IP
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                    Caller ID
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                    Uptime
                  </th>
                </tr>
              </thead>
              <tbody>
                {connectedClients.map((client, idx) => (
                  <tr
                    key={idx}
                    className={`transition-colors hover:bg-[#f8f9fb] ${
                      idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium text-[#0f172a]">
                      {client.name ?? "-"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[#475569]">
                      {client.ip ?? "-"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[#475569]">
                      {client.callerId ?? "-"}
                    </td>
                    <td className="px-4 py-2.5 text-[#475569]">
                      {client.uptime ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0]">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                    Nombre
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                    MAC
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                    Signal
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                    IP
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                    TX / RX
                  </th>
                </tr>
              </thead>
              <tbody>
                {connectedClients.map((station, idx) => {
                  const stSignal = station.signal
                    ? parseInt(station.signal, 10)
                    : null;
                  const stSignalColor =
                    stSignal != null
                      ? stSignal > -60
                        ? "text-[#16a34a]"
                        : stSignal > -75
                          ? "text-[#f59e0b]"
                          : "text-[#dc2626]"
                      : "text-[#94a3b8]";
                  return (
                    <tr
                      key={station.mac ?? idx}
                      className={`transition-colors hover:bg-[#f8f9fb] ${
                        idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-[#0f172a]">
                        {station.name ?? "-"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[#475569]">
                        {station.mac ?? "-"}
                      </td>
                      <td className={`px-4 py-2.5 font-medium ${stSignalColor}`}>
                        {station.signal && station.signal !== "-"
                          ? `${station.signal} dBm`
                          : "-"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[#475569]">
                        {station.ip ?? "-"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[#475569]">
                        <span className="text-[#16a34a]">
                          {station.txRate ?? "-"}
                        </span>
                        <span className="mx-1 text-[#94a3b8]">/</span>
                        <span className="text-[#006fff]">
                          {station.rxRate ?? "-"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
