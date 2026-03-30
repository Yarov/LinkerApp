"use client";

import { useState, useEffect, useRef } from "react";
import {
  Server,
  Cpu,
  HardDrive,
  Clock,
  AlertTriangle,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { WifiOff } from "lucide-react";
import Skeleton from "@/components/Skeleton";
import TableSkeleton from "@/components/skeletons/TableSkeleton";
import { useMikrotik } from "@/contexts/MikrotikContext";

interface SystemStatus {
  uptime: string;
  version: string;
  cpu: string;
  memory: string;
  freeMemory: string;
  totalMemory: string;
}

interface PPPoESession {
  name: string;
  address: string;
  uptime: string;
  service: string;
  callerId: string;
}

export default function MikroTikPage() {
  const { connected: mikrotikConnected, retry: retryConnection } = useMikrotik();
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [pppoeList, setPppoeList] = useState<PPPoESession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = (isManual?: boolean) => {
    if (isManual) setRefreshing(true);

    Promise.all([
      fetch("/api/mikrotik/status", { redirect: "error" }).then((r) => {
        if (!r.ok) throw new Error("Error al conectar con MikroTik");
        return r.json();
      }).catch(() => ({ resource: {} })),
      fetch("/api/mikrotik/pppoe", { redirect: "error" }).then((r) => {
        if (!r.ok) return [];
        return r.json();
      }).catch(() => []),
    ])
      .then(([statusData, pppoeData]) => {
        const res = statusData?.resource ?? {};
        const free = parseInt(res.freeMemory ?? "0", 10);
        const total = parseInt(res.totalMemory ?? "1", 10);
        const cpuLoad = res.cpuLoad ?? "0";
        const memPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
        const freeStr = free > 1048576 ? `${Math.round(free / 1048576)}MB` : `${Math.round(free / 1024)}KB`;
        const totalStr = total > 1048576 ? `${Math.round(total / 1048576)}MB` : `${Math.round(total / 1024)}KB`;
        setSystemStatus({
          uptime: res.uptime ?? "-",
          version: res.version ?? "-",
          cpu: cpuLoad,
          memory: String(memPercent),
          freeMemory: freeStr,
          totalMemory: totalStr,
        });
        setPppoeList(Array.isArray(pppoeData) ? pppoeData : []);
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
    intervalRef.current = setInterval(() => {
      fetchData();
    }, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const cpuNum = parseInt((systemStatus?.cpu ?? "0").replace("%", ""), 10) || 0;
  const memNum =
    parseInt((systemStatus?.memory ?? "0").replace("%", ""), 10) || 0;

  if (loading)
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-28" />
            <Skeleton className="mt-2 h-4 w-52" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-36 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
        </div>
        {/* 4 stat cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"
            >
              <div className="absolute left-0 top-0 h-full w-[3px] bg-[#e2e8f0]" />
              <div className="flex items-center justify-between">
                <div>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-3 h-7 w-16" />
                </div>
                <Skeleton className="h-12 w-12 rounded-xl" />
              </div>
              {i < 2 && <Skeleton className="mt-4 h-2 w-full rounded-full" />}
            </div>
          ))}
        </div>
        {/* PPPoE table */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-[#e2e8f0] px-5 py-4">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-5 w-8 rounded-lg" />
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
                {Array.from({ length: 5 }).map((_, col) => (
                  <th key={col} className="px-5 py-3">
                    <Skeleton className="h-3 w-20" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, row) => (
                <tr
                  key={row}
                  className={`border-b border-[#e2e8f0] last:border-b-0 ${
                    row % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                  }`}
                >
                  {Array.from({ length: 5 }).map((_, col) => (
                    <td key={col} className="px-5 py-3">
                      <Skeleton
                        className={`h-4 ${col === 0 ? "w-28" : col === 1 ? "w-24" : "w-16"}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
          <p className="mt-4 text-sm text-[#dc2626]">{error}</p>
          <button
            onClick={() => {
              setError("");
              setLoading(true);
              fetchData();
            }}
            className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
            MikroTik
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            {systemStatus
              ? `RouterOS ${systemStatus.version ?? "-"} \u2014 Uptime: ${systemStatus.uptime ?? "-"}`
              : "Administracion del router"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs text-[#94a3b8]">
            <div className="h-1.5 w-1.5 rounded-full bg-[#16a34a] status-dot-online" />
            Auto-refresco 30s
          </div>
          <button
            onClick={() => {
              if (!mikrotikConnected) {
                retryConnection();
              }
              fetchData(true);
            }}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-transparent px-4 py-2 text-sm text-[#475569] transition-all duration-200 hover:bg-[#f5f7fa] hover:text-[#0f172a] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {mikrotikConnected ? "Actualizar" : "Reintentar conexion"}
          </button>
        </div>
      </div>

      {/* Disconnected state */}
      {!mikrotikConnected && !systemStatus && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e2e8f0] bg-white py-16 shadow-sm">
          <div className="rounded-2xl bg-[#fffbeb] p-4">
            <WifiOff className="h-12 w-12 text-[#f59e0b]" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-[#0f172a]">
            Sin conexion a MikroTik
          </h2>
          <p className="mt-2 text-sm text-[#94a3b8]">
            No se puede conectar al router. Verifica que el equipo este
            encendido y accesible.
          </p>
          <button
            onClick={() => {
              retryConnection();
              fetchData(true);
            }}
            disabled={refreshing}
            className="mt-5 flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Reintentar conexion
          </button>
        </div>
      )}

      {/* System Status Cards */}
      {systemStatus && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* CPU Card */}
          <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#006fff] to-transparent" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  CPU
                </p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-[#0f172a]">
                  {systemStatus.cpu ?? "0%"}
                </p>
              </div>
              <div className="rounded-xl bg-[#eff6ff] p-3">
                <Cpu className="h-6 w-6 text-[#006fff]" />
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  cpuNum > 80
                    ? "bg-gradient-to-r from-[#dc2626] to-[#ef4444]"
                    : cpuNum > 50
                      ? "bg-gradient-to-r from-[#f59e0b] to-[#fbbf24]"
                      : "bg-gradient-to-r from-[#006fff] to-[#4da6ff]"
                }`}
                style={{ width: `${cpuNum}%` }}
              />
            </div>
          </div>

          {/* Memory Card */}
          <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#7c4dff] to-transparent" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Memoria
                </p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-[#0f172a]">
                  {systemStatus.memory ?? "0%"}
                </p>
              </div>
              <div className="rounded-xl bg-[#f5f3ff] p-3">
                <HardDrive className="h-6 w-6 text-[#7c4dff]" />
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  memNum > 80
                    ? "bg-gradient-to-r from-[#dc2626] to-[#ef4444]"
                    : memNum > 50
                      ? "bg-gradient-to-r from-[#f59e0b] to-[#fbbf24]"
                      : "bg-gradient-to-r from-[#7c4dff] to-[#b388ff]"
                }`}
                style={{ width: `${memNum}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[#94a3b8]">
              {systemStatus.freeMemory ?? "?"} libre de{" "}
              {systemStatus.totalMemory ?? "?"}
            </p>
          </div>

          {/* Uptime Card */}
          <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#16a34a] to-transparent" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Uptime
                </p>
                <p className="mt-2 text-lg font-bold tracking-tight text-[#0f172a]">
                  {systemStatus.uptime ?? "-"}
                </p>
              </div>
              <div className="rounded-xl bg-[#f0fdf4] p-3">
                <Clock className="h-6 w-6 text-[#16a34a]" />
              </div>
            </div>
          </div>

          {/* Version Card */}
          <div className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#00bcd4] to-transparent" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Version
                </p>
                <p className="mt-2 text-lg font-bold tracking-tight text-[#0f172a]">
                  {systemStatus.version ?? "-"}
                </p>
              </div>
              <div className="rounded-xl bg-[#ecfeff] p-3">
                <Server className="h-6 w-6 text-[#00bcd4]" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active PPPoE Sessions */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-4">
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-[#006fff]" />
            <h2 className="text-base font-semibold tracking-tight text-[#0f172a]">
              Sesiones PPPoE Activas
            </h2>
            <span className="rounded-lg bg-[#eff6ff] px-2.5 py-0.5 text-xs font-bold text-[#006fff]">
              {pppoeList.length}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Usuario
                </th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Direccion IP
                </th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Uptime
                </th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Servicio
                </th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  MAC (Caller ID)
                </th>
              </tr>
            </thead>
            <tbody>
              {pppoeList.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-12 text-center text-sm text-[#94a3b8]"
                  >
                    No hay sesiones PPPoE activas
                  </td>
                </tr>
              ) : (
                pppoeList.map((session, idx) => (
                  <tr
                    key={`${session.name ?? ""}-${idx}`}
                    className={`transition-colors hover:bg-[#f8f9fb] ${
                      idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                    }`}
                  >
                    <td className="px-5 py-3 font-medium text-[#0f172a]">
                      {session.name ?? "-"}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-[#475569]">
                      {session.address ?? "-"}
                    </td>
                    <td className="px-5 py-3 text-[#475569]">
                      {session.uptime ?? "-"}
                    </td>
                    <td className="px-5 py-3">
                      <span className="rounded-md bg-[#f5f7fa] px-2.5 py-1 text-[10px] font-medium text-[#475569] border border-[#e2e8f0]">
                        {session.service ?? "-"}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-[#94a3b8]">
                      {session.callerId ?? "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
