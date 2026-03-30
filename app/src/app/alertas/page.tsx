"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  Wifi,
  WifiOff,
  DollarSign,
  Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import Skeleton from "@/components/Skeleton";

interface Alert {
  id: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  node?: { id: string; name: string; type: string } | null;
}

const typeIcons: Record<string, React.ReactNode> = {
  LINK_DOWN: <WifiOff className="h-5 w-5 text-[#dc2626]" />,
  LINK_UP: <Wifi className="h-5 w-5 text-[#16a34a]" />,
  PAYMENT_DUE: <DollarSign className="h-5 w-5 text-[#f59e0b]" />,
  LOW_SIGNAL: <AlertTriangle className="h-5 w-5 text-[#f59e0b]" />,
  HIGH_USAGE: <AlertTriangle className="h-5 w-5 text-[#006fff]" />,
};

const typeBorderColors: Record<string, string> = {
  LINK_DOWN: "border-l-[#dc2626]",
  LINK_UP: "border-l-[#16a34a]",
  PAYMENT_DUE: "border-l-[#f59e0b]",
  LOW_SIGNAL: "border-l-[#f59e0b]",
  HIGH_USAGE: "border-l-[#006fff]",
};

const typeBgColors: Record<string, string> = {
  LINK_DOWN: "bg-[#fef2f2]",
  LINK_UP: "bg-[#f0fdf4]",
  PAYMENT_DUE: "bg-[#fffbeb]",
  LOW_SIGNAL: "bg-[#fffbeb]",
  HIGH_USAGE: "bg-[#eff6ff]",
};

export default function AlertasPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [deletingRead, setDeletingRead] = useState(false);

  const fetchAlerts = useCallback(() => {
    setLoading(true);
    fetch("/api/alerts")
      .then((r) => {
        if (!r.ok) throw new Error("Error al cargar alertas");
        return r.json();
      })
      .then((data) => {
        setAlerts(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const markAsRead = async (alertId: string) => {
    try {
      await fetch(`/api/alerts/${alertId}/read`, { method: "PUT" });
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, isRead: true } : a))
      );
    } catch {
      // silently fail
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch("/api/alerts/read-all", { method: "POST" });
      setAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));
    } catch {
      // silently fail
    }
  };

  const deleteReadAlerts = async () => {
    setDeletingRead(true);
    try {
      await fetch("/api/alerts/read-all", { method: "DELETE" });
      setAlerts((prev) => prev.filter((a) => !a.isRead));
    } catch {
      // silently fail
    } finally {
      setDeletingRead(false);
    }
  };

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

  const alertTypes = [
    "all",
    ...Array.from(new Set(alerts.map((a) => a.type).filter(Boolean))),
  ];
  const filtered =
    typeFilter === "all" ? alerts : alerts.filter((a) => a.type === typeFilter);
  const unreadCount = alerts.filter((a) => !a.isRead).length;
  const readCount = alerts.filter((a) => a.isRead).length;

  if (loading)
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-2 h-4 w-36" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-36 rounded-xl" />
            <Skeleton className="h-9 w-48 rounded-xl" />
          </div>
        </div>
        {/* Filter buttons */}
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-xl" />
          ))}
        </div>
        {/* Alert list */}
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-4 rounded-2xl border border-[#e2e8f0] border-l-4 border-l-[#e2e8f0] bg-white p-4"
            >
              <Skeleton className="mt-0.5 h-5 w-5 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <div className="mt-2 flex items-center gap-3">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-20 rounded-md" />
                </div>
              </div>
              <Skeleton className="h-7 w-24 shrink-0 rounded-xl" />
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
          <button
            onClick={() => {
              setError("");
              fetchAlerts();
            }}
            className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const typeLabels: Record<string, string> = {
    all: "Todas",
    LINK_DOWN: "Enlace caido",
    LINK_UP: "Enlace activo",
    PAYMENT_DUE: "Pago pendiente",
    LOW_SIGNAL: "Senal baja",
    HIGH_USAGE: "Alto uso",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
            Alertas
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            {unreadCount > 0
              ? `${unreadCount} alerta${unreadCount > 1 ? "s" : ""} sin leer`
              : "Todas las alertas leidas"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {readCount > 0 && (
            <button
              onClick={deleteReadAlerts}
              disabled={deletingRead}
              className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-transparent px-4 py-2 text-sm text-[#dc2626] transition-all duration-200 hover:bg-[#fef2f2] hover:text-[#dc2626] disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Limpiar leidas
            </button>
          )}
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-transparent px-4 py-2 text-sm text-[#475569] transition-all duration-200 hover:bg-[#f5f7fa] hover:text-[#0f172a]"
            >
              <CheckCircle className="h-4 w-4" />
              Marcar todas como leidas
            </button>
          )}
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {alertTypes.map((type) => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            className={`rounded-xl px-4 py-2 text-xs font-medium transition-all duration-200 ${
              typeFilter === type
                ? "bg-[#eff6ff] text-[#006fff] ring-1 ring-[#006fff]/30"
                : "bg-white text-[#94a3b8] hover:bg-[#f5f7fa] hover:text-[#475569]"
            }`}
          >
            {typeLabels[type] ?? type}
          </button>
        ))}
      </div>

      {/* Alert List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e2e8f0] bg-white py-20 shadow-sm">
            <Bell className="h-12 w-12 text-[#94a3b8]" />
            <p className="mt-4 text-sm text-[#94a3b8]">No hay alertas</p>
          </div>
        ) : (
          filtered.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-4 rounded-2xl border border-[#e2e8f0] border-l-4 p-4 transition-all duration-200 ${
                typeBorderColors[alert.type] ?? "border-l-[#006fff]"
              } ${
                typeBgColors[alert.type] ?? "bg-[#eff6ff]"
              } ${alert.isRead ? "opacity-50" : ""} hover:brightness-[0.98]`}
            >
              <div className="mt-0.5 shrink-0">
                {typeIcons[alert.type] ?? (
                  <Bell className="h-5 w-5 text-[#006fff]" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p
                      className={`text-sm ${
                        alert.isRead
                          ? "text-[#475569]"
                          : "font-medium text-[#0f172a]"
                      }`}
                    >
                      {alert.message ?? "-"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {alert.node && (
                        <span className="text-xs text-[#475569]">
                          {alert.node.name}
                        </span>
                      )}
                      <span className="text-xs text-[#94a3b8]">
                        {formatTimeAgo(alert.createdAt)}
                      </span>
                      {alert.type && (
                        <span className="rounded-md bg-[#f5f7fa] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#475569] border border-[#e2e8f0]">
                          {typeLabels[alert.type] ?? alert.type}
                        </span>
                      )}
                    </div>
                  </div>
                  {!alert.isRead && (
                    <button
                      onClick={() => markAsRead(alert.id)}
                      className="shrink-0 rounded-xl px-3 py-1.5 text-xs text-[#94a3b8] transition-all duration-200 hover:bg-white hover:text-[#0f172a]"
                    >
                      Marcar leida
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
