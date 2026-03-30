"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Users,
  UserCheck,
  DollarSign,
  Wifi,
  AlertTriangle,
  RefreshCw,
  Activity,
  Bell,
  Server,
  Cpu,
  HardDrive,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import StatCard from "@/components/StatCard";
import Skeleton from "@/components/Skeleton";
import DashboardSkeleton from "@/components/skeletons/DashboardSkeleton";
import { useMikrotik } from "@/contexts/MikrotikContext";

interface NodeItem {
  id: string;
  name: string;
  status: string;
  type: string;
}

interface RecentPayment {
  id: string;
  client?: { name?: string };
  amount?: number;
  paidAt?: string;
  createdAt?: string;
}

interface AlertItem {
  id: string;
  severity: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface MikrotikStatus {
  uptime?: string;
  cpu?: string;
  memory?: string;
  freeMemory?: string;
  totalMemory?: string;
  version?: string;
}

export default function DashboardPage() {
  const { connected: mikrotikConnected } = useMikrotik();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [totalClients, setTotalClients] = useState(0);
  const [activeClients, setActiveClients] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  const [revenuePeriod, setRevenuePeriod] = useState("");
  const [pppoeActive, setPppoeActive] = useState(0);
  const [onlineNodes, setOnlineNodes] = useState(0);
  const [totalNodes, setTotalNodes] = useState(0);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [mikrotikStatus, setMikrotikStatus] = useState<MikrotikStatus | null>(null);
  const [mikrotikLoaded, setMikrotikLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const applyDashboardData = useCallback((raw: Record<string, unknown>) => {
    const clients = raw?.clients as Record<string, number> | undefined;
    const revenue = raw?.revenue as Record<string, unknown> | undefined;
    const nodesData = raw?.nodes as Record<string, unknown> | undefined;

    setTotalClients(clients?.total ?? 0);
    setActiveClients(clients?.active ?? 0);
    setMonthlyRevenue((revenue?.current as number) ?? 0);
    setRevenuePeriod((revenue?.period as string) ?? "");
    setPppoeActive((raw?.pppoeActive as number) ?? 0);
    setOnlineNodes((nodesData?.online as number) ?? 0);
    setTotalNodes((nodesData?.total as number) ?? 0);
    setNodes(
      ((nodesData?.list ?? []) as Record<string, string>[]).map((n) => ({
        id: n.id ?? "",
        name: n.name ?? "",
        status: n.status ?? "OFFLINE",
        type: n.type ?? "",
      }))
    );
    setRecentPayments((raw?.recentPayments as RecentPayment[]) ?? []);
    setAlerts((raw?.alerts as AlertItem[]) ?? []);

    const mk = raw?.mikrotik as Record<string, string> | undefined;
    if (mk && mk.uptime) {
      const free = parseInt(mk.freeMemory ?? "0", 10);
      const total = parseInt(mk.totalMemory ?? "1", 10);
      const memPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
      setMikrotikStatus({
        uptime: mk.uptime ?? "-",
        version: mk.version ?? "-",
        cpu: (mk.cpuLoad ?? "0") + "%",
        memory: memPercent + "%",
        freeMemory: free > 1048576 ? `${Math.round(free / 1048576)}MB` : "-",
        totalMemory: total > 1048576 ? `${Math.round(total / 1048576)}MB` : "-",
      });
    }
    setLastUpdate(new Date());
  }, []);

  const fetchData = useCallback(() => {
    // Phase 1: Quick load from DB only (instant)
    fetch("/api/dashboard?quick=true")
      .then((r) => {
        if (r.redirected || r.url.includes("/login")) {
          window.location.href = "/login";
          return null;
        }
        if (!r.ok) throw new Error("Error al cargar datos");
        return r.json();
      })
      .then((raw) => {
        if (!raw) return;
        applyDashboardData(raw);
        setLoading(false);

        // Phase 2: Full load with MikroTik data (background)
        fetch("/api/dashboard")
          .then((r) => r.ok ? r.json() : null)
          .then((fullRaw) => {
            if (fullRaw) applyDashboardData(fullRaw);
            setMikrotikLoaded(true);
          })
          .catch(() => {
            setMikrotikLoaded(true);
          });

        // Monitor check in background (non-blocking)
        fetch("/api/monitor").catch(() => {});
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [applyDashboardData]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 60000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return "";
    try {
      return formatDistanceToNow(new Date(dateStr), {
        addSuffix: true,
        locale: es,
      });
    } catch {
      return "";
    }
  };

  const cpuNum =
    parseInt((mikrotikStatus?.cpu ?? "0").replace("%", ""), 10) || 0;
  const memNum =
    parseInt((mikrotikStatus?.memory ?? "0").replace("%", ""), 10) || 0;

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
          <p className="mt-4 text-sm text-[#dc2626]">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const severityColors: Record<string, string> = {
    error: "bg-[#dc2626]",
    warning: "bg-[#f59e0b]",
    info: "bg-[#006fff]",
    success: "bg-[#16a34a]",
  };

  const unreadAlerts = (alerts ?? []).filter((a) => !a.isRead);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            Vista general de la red
            {revenuePeriod ? ` \u2014 ${revenuePeriod}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && (
            <span className="text-xs text-[#94a3b8]">
              Ultima actualizacion:{" "}
              {formatDistanceToNow(lastUpdate, { addSuffix: false, locale: es })
                .replace("menos de un minuto", "ahora")}{" "}
            </span>
          )}
          <div className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs text-[#94a3b8]">
            <div className="h-1.5 w-1.5 rounded-full bg-[#16a34a] status-dot-online" />
            Auto-refresco 60s
          </div>
        </div>
      </div>

      {/* Top row: 4 metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Clientes"
          value={totalClients}
          icon={Users}
          color="blue"
        />
        <StatCard
          label="Clientes Activos"
          value={activeClients}
          icon={UserCheck}
          color="green"
        />
        <StatCard
          label="Ingresos del Mes"
          value={`$${Number(monthlyRevenue).toLocaleString("es-MX")}`}
          icon={DollarSign}
          color="purple"
        />
        <StatCard
          label="PPPoE Activos"
          value={mikrotikConnected ? pppoeActive : "-"}
          icon={Wifi}
          color="cyan"
        />
      </div>

      {/* Onboarding card - show when 0 clients */}
      {totalClients === 0 && !loading && (
        <div className="rounded-2xl border border-[#006fff]/20 bg-gradient-to-r from-[#eff6ff] to-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#006fff]/10">
                <Server className="h-6 w-6 text-[#006fff]" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#0f172a]">
                  Ya tienes un MikroTik configurado?
                </h3>
                <p className="mt-1 text-sm text-[#475569]">
                  Importa tus clientes y configuracion existente en un clic.
                </p>
              </div>
            </div>
            <Link
              href="/onboarding"
              className="flex shrink-0 items-center gap-2 rounded-xl bg-[#006fff] px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#0057cc] hover:shadow-[#006fff]/30"
            >
              Importar red existente
            </Link>
          </div>
        </div>
      )}

      {/* Middle row: Network topology + System status */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Network Topology - 60% */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm lg:col-span-3">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#006fff]" />
              <h2 className="text-base font-semibold tracking-tight text-[#0f172a]">
                Topologia de Red
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#94a3b8]">
                {onlineNodes}/{totalNodes} en linea
              </span>
              <Link
                href="/red"
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-[#006fff] transition-colors hover:bg-[#eff6ff]"
              >
                Ver todo
              </Link>
            </div>
          </div>

          {nodes.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#94a3b8]">
              No hay nodos registrados
            </p>
          ) : (
            <div className="space-y-1">
              {nodes.map((node, idx) => {
                const isOnline =
                  (node.status ?? "").toUpperCase() === "ONLINE";
                const isDegraded =
                  (node.status ?? "").toUpperCase() === "DEGRADED";
                return (
                  <Link
                    key={node.id}
                    href={`/red/${node.id}`}
                    className="group flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200 hover:bg-[#f8f9fb]"
                  >
                    {/* Connection line indicator */}
                    <div className="relative flex flex-col items-center">
                      {idx > 0 && (
                        <div className="absolute -top-4 h-4 w-px bg-[#cbd5e1]" />
                      )}
                      <div
                        className={`h-3 w-3 rounded-full ${
                          isOnline
                            ? "bg-[#16a34a] status-dot-online"
                            : isDegraded
                              ? "bg-[#f59e0b]"
                              : "bg-[#dc2626]"
                        }`}
                      />
                      {idx < nodes.length - 1 && (
                        <div className="absolute -bottom-4 h-4 w-px bg-[#cbd5e1]" />
                      )}
                    </div>
                    <div className="flex flex-1 items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-[#0f172a]">
                          {node.name}
                        </span>
                        <span className="rounded-md bg-[#f5f7fa] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#475569] border border-[#e2e8f0]">
                          {node.type}
                        </span>
                      </div>
                      <span
                        className={`text-xs font-medium ${
                          isOnline
                            ? "text-[#16a34a]"
                            : isDegraded
                              ? "text-[#f59e0b]"
                              : "text-[#dc2626]"
                        }`}
                      >
                        {isOnline
                          ? "Online"
                          : isDegraded
                            ? "Degradado"
                            : "Offline"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* System Status - 40% */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-5 flex items-center gap-2">
            <Server className="h-4 w-4 text-[#006fff]" />
            <h2 className="text-base font-semibold tracking-tight text-[#0f172a]">
              Estado del Sistema
            </h2>
          </div>

          {mikrotikStatus ? (
            <div className="space-y-5">
              {/* CPU */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-[#475569]">
                    <Cpu className="h-3.5 w-3.5" />
                    CPU
                  </div>
                  <span className="text-xs font-mono font-medium text-[#0f172a]">
                    {mikrotikStatus.cpu ?? "0%"}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      cpuNum > 80
                        ? "bg-gradient-to-r from-[#dc2626] to-[#ef4444]"
                        : cpuNum > 50
                          ? "bg-gradient-to-r from-[#f59e0b] to-[#fbbf24]"
                          : "bg-gradient-to-r from-[#16a34a] to-[#4ade80]"
                    }`}
                    style={{ width: `${cpuNum}%` }}
                  />
                </div>
              </div>

              {/* Memory */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-[#475569]">
                    <HardDrive className="h-3.5 w-3.5" />
                    Memoria
                  </div>
                  <span className="text-xs font-mono font-medium text-[#0f172a]">
                    {mikrotikStatus.memory ?? "0%"}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      memNum > 80
                        ? "bg-gradient-to-r from-[#dc2626] to-[#ef4444]"
                        : memNum > 50
                          ? "bg-gradient-to-r from-[#f59e0b] to-[#fbbf24]"
                          : "bg-gradient-to-r from-[#16a34a] to-[#4ade80]"
                    }`}
                    style={{ width: `${memNum}%` }}
                  />
                </div>
              </div>

              {/* Uptime */}
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-[#475569]">
                  <Clock className="h-3.5 w-3.5" />
                  Uptime
                </div>
                <span className="text-xs font-mono font-medium text-[#0f172a]">
                  {mikrotikStatus.uptime ?? "-"}
                </span>
              </div>

              {/* Active Connections */}
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-[#475569]">
                  <Wifi className="h-3.5 w-3.5" />
                  Conexiones PPPoE
                </div>
                <span className="text-sm font-bold text-[#006fff]">
                  {pppoeActive}
                </span>
              </div>

              {/* Version */}
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <span className="text-xs text-[#475569]">RouterOS</span>
                <span className="text-xs font-mono text-[#94a3b8]">
                  {mikrotikStatus.version ?? "-"}
                </span>
              </div>
            </div>
          ) : !mikrotikLoaded ? (
            <div className="space-y-5">
              {/* CPU skeleton */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
              {/* Memory skeleton */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
              {/* Uptime skeleton */}
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
              {/* PPPoE skeleton */}
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-6 w-8" />
              </div>
              {/* Version skeleton */}
              <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8">
              <Server className="h-8 w-8 text-[#94a3b8]" />
              <p className="mt-3 text-xs text-[#94a3b8]">
                Sin conexion a MikroTik
              </p>
              <button
                onClick={fetchData}
                className="mt-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[#006fff] transition-colors hover:bg-[#eff6ff]"
              >
                <RefreshCw className="h-3 w-3" />
                Reintentar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: Recent Activity + Alerts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-[#16a34a]" />
              <h2 className="text-base font-semibold tracking-tight text-[#0f172a]">
                Actividad Reciente
              </h2>
            </div>
            <Link
              href="/pagos"
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-[#006fff] transition-colors hover:bg-[#eff6ff]"
            >
              Ver todo
            </Link>
          </div>
          <div className="space-y-1">
            {(recentPayments ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-[#94a3b8]">
                No hay actividad reciente
              </p>
            ) : (
              (recentPayments ?? []).slice(0, 5).map((payment, idx) => (
                <div
                  key={payment?.id ?? idx}
                  className="flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200 hover:bg-[#f8f9fb]"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f0fdf4]">
                    <DollarSign className="h-4 w-4 text-[#16a34a]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[#0f172a]">
                      <span className="font-medium">
                        ${(payment?.amount ?? 0).toLocaleString("es-MX")}
                      </span>
                      <span className="text-[#475569]">
                        {" "}
                        \u2014 {payment?.client?.name ?? "Cliente"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-[#94a3b8]">
                      {formatTimeAgo(
                        payment?.paidAt ?? payment?.createdAt ?? undefined
                      )}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Alerts */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-[#f59e0b]" />
              <h2 className="text-base font-semibold tracking-tight text-[#0f172a]">
                Alertas
              </h2>
              {unreadAlerts.length > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#dc2626] px-1.5 text-[10px] font-bold text-white">
                  {unreadAlerts.length}
                </span>
              )}
            </div>
            <Link
              href="/alertas"
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-[#006fff] transition-colors hover:bg-[#eff6ff]"
            >
              Ver todas
            </Link>
          </div>
          <div className="space-y-1">
            {unreadAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Bell className="h-8 w-8 text-[#94a3b8]" />
                <p className="mt-3 text-xs text-[#94a3b8]">
                  No hay alertas pendientes
                </p>
              </div>
            ) : (
              unreadAlerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 rounded-xl px-4 py-3 transition-all duration-200 hover:bg-[#f8f9fb]"
                >
                  <div
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      severityColors[alert.severity ?? ""] ??
                      severityColors.info
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#0f172a]">
                      {alert.message ?? "-"}
                    </p>
                    <p className="mt-0.5 text-xs text-[#94a3b8]">
                      {formatTimeAgo(alert.createdAt ?? undefined)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
